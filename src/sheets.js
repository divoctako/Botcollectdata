import { googleToken } from './auth.js';
import { externalJson } from './http.js';
import { one, rows, run, setting, setSetting, stmt } from './store.js';
import { MESSAGE_HEADERS, HISTORY_HEADERS, fromRow, toRow, thaiTime, thaiMonth, projectMessage } from './projection.js';
import { enrichOriginal } from './line.js';

const ROOT = 'https://sheets.googleapis.com/v4/spreadsheets';
const DRIVE = 'https://www.googleapis.com/drive/v3/files';
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const quote = (title) => `'${title.replaceAll("'", "''")}'`;
const qEscape = (value) => value.replaceAll('\\', '\\\\').replaceAll("'", "\\'");

export class GoogleSheets {
  constructor(env, leaseToken) { this.env = env; this.leaseToken = leaseToken; }
  async api(url, method = 'GET', body) {
    if (this.env._budget?.sql >= 34) {
      throw new Error('แบ่งงานต่อรอบถัดไปเพื่อรักษาโควตา Cloudflare Free');
    }
    if (method !== 'GET') {
      if (this.leaseToken) {
        const now = Date.now();
        const lease = await one(this.env, `UPDATE leases SET expires_at_ms=?
          WHERE name='sheets' AND token=? AND expires_at_ms>? RETURNING token`, now + 90_000, this.leaseToken, now);
        if (!lease) throw new Error('หมดสิทธิ์การเขียนรอบนี้ ระบบจะลองใหม่');
      }
      // All writers share the sync lease. Persist throttle across isolates/runs.
      const next = Number(await setting(this.env, 'next_google_write_at') || 0);
      await wait(Math.max(0, Math.min(1500, next - Date.now())));
      await setSetting(this.env, 'next_google_write_at', Date.now() + 1300);
    }
    const token = await googleToken(this.env);
    return externalJson(url, {
      method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  async values(id, range) {
    return (await this.api(`${ROOT}/${id}/values/${encodeURIComponent(range)}`)).values || [];
  }
  async batch(id, requests) { return this.api(`${ROOT}/${id}:batchUpdate`, 'POST', { requests }); }
  cellRequest(target, row, values) {
    return { updateCells: {
      start: { sheetId: target.sheet_id, rowIndex: row - 1, columnIndex: 0 },
      rows: [{ values: values.map((value) => ({ userEnteredValue:
        typeof value === 'number' ? { numberValue: value } : { stringValue: String(value ?? '') } })) }],
      fields: 'userEnteredValue',
    } };
  }
  async findFile(key, mimeType = 'application/vnd.google-apps.spreadsheet') {
    const namespace = this.env.ARCHIVE_NAMESPACE || new URL(this.env.APP_URL).origin;
    const q = `trashed=false and mimeType='${mimeType}' and appProperties has { key='archiveKey' and value='${qEscape(key)}' } and appProperties has { key='archiveNamespace' and value='${qEscape(namespace)}' }`;
    const response = await this.api(`${DRIVE}?${new URLSearchParams({ q, fields: 'files(id,name)', pageSize: '10' })}`);
    return response.files?.[0]?.id;
  }
  async file(key, title, mimeType = 'application/vnd.google-apps.spreadsheet', parent) {
    return await this.findFile(key, mimeType) || (await this.api(DRIVE, 'POST', {
      name: title, mimeType, appProperties: { archiveKey: key, archiveNamespace: this.env.ARCHIVE_NAMESPACE || new URL(this.env.APP_URL).origin }, ...(parent ? { parents: [parent] } : {}),
    })).id;
  }
  async index() {
    let id = await setting(this.env, 'index_spreadsheet_id');
    if (id) return id;
    const folder = await this.file('line-archive-folder', 'LINE Archive', 'application/vnd.google-apps.folder');
    await setSetting(this.env, 'folder_id', folder);
    id = await this.file('line-archive-index', 'LINE Archive — สารบัญ', undefined, folder);
    const meta = await this.api(`${ROOT}/${id}?fields=sheets(properties)`);
    const first = meta.sheets?.[0]?.properties || { sheetId: 0, title: 'สารบัญ' };
    await this.batch(id, [...(meta.sheets?.length ? [] : [{ addSheet: { properties: first } }]),
      this.cellRequest({ sheet_id: first.sheetId }, 1, ['เดือน', 'ลิงก์ Google Sheets', 'เขตเวลา'])]);
    await setSetting(this.env, 'index_sheet_title', first.title);
    await setSetting(this.env, 'index_spreadsheet_id', id);
    return id;
  }
  async workbook(month) {
    const existing = await one(this.env, 'SELECT * FROM workbooks WHERE month=?', month);
    if (existing && !existing.expired) return existing.spreadsheet_id;
    if (existing?.expired) throw new Error('ข้อมูลเดือนนี้พ้นระยะเก็บแล้ว');
    const indexId = await this.index();
    const folder = await setting(this.env, 'folder_id');
    const id = await this.file(`line-archive-${month}`, `LINE Archive ${month}`, undefined, folder);
    // Index first; if response is lost, find the month before retrying.
    const title = await setting(this.env, 'index_sheet_title');
    const current = await this.values(indexId, `${quote(title)}!A:C`);
    const position = current.findIndex((r) => r[0] === month);
    const meta = await this.api(`${ROOT}/${indexId}?fields=sheets(properties)`);
    const sheet = meta.sheets.find((s) => s.properties.title === title).properties;
    await this.batch(indexId, [this.cellRequest({ sheet_id: sheet.sheetId }, position >= 0 ? position + 1 : Math.max(2, current.length + 1),
      [month, `https://docs.google.com/spreadsheets/d/${id}`, 'Asia/Bangkok'])]);
    await run(this.env, 'INSERT INTO workbooks(month,spreadsheet_id,created_at_ms) VALUES (?,?,?) ON CONFLICT(month) DO NOTHING', month, id, Date.now());
    return id;
  }
  async target(month, groupId, kind) {
    const existing = await one(this.env, 'SELECT * FROM sheet_targets WHERE month=? AND group_id=? AND kind=?', month, groupId, kind);
    if (existing) return existing;
    const id = await this.workbook(month);
    const group = await one(this.env, 'SELECT display_name FROM chat_groups WHERE group_id=?', groupId);
    const name = (group?.display_name || 'กลุ่ม').replace(/[\[\]:*?/\\]/g, ' ').slice(0, 25);
    const title = `${kind === 'history' ? 'ประวัติ ' : ''}${name} · ${groupId}`.slice(0, 100);
    const meta = await this.api(`${ROOT}/${id}?fields=sheets(properties)`);
    let sheet = (meta.sheets || []).find((s) => s.properties.title === title)?.properties;
    const headers = kind === 'messages' ? MESSAGE_HEADERS : HISTORY_HEADERS;
    if (!sheet) {
      const used = new Set((meta.sheets || []).map((s) => s.properties.sheetId));
      let sheetId = 1;
      for (const c of `${groupId}/${kind}`) sheetId = (Math.imul(sheetId, 31) + c.charCodeAt(0)) >>> 1;
      while (used.has(sheetId)) sheetId += 1;
      sheet = { sheetId, title, gridProperties: { rowCount: 100, columnCount: headers.length, frozenRowCount: 1 } };
      await this.batch(id, [{ addSheet: { properties: sheet } }, this.cellRequest({ sheet_id: sheetId }, 1, headers), {
        repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
          cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.85, green: 0.94, blue: 0.90 } } },
          fields: 'userEnteredFormat' },
      }]);
    } else {
      await this.batch(id, [this.cellRequest({ sheet_id: sheet.sheetId }, 1, headers)]);
    }
    await run(this.env, `INSERT INTO sheet_targets(month,group_id,kind,sheet_id,title,capacity)
      VALUES (?,?,?,?,?,?) ON CONFLICT(month,group_id,kind) DO NOTHING`,
    month, groupId, kind, sheet.sheetId, title, sheet.gridProperties.rowCount);
    return one(this.env, 'SELECT * FROM sheet_targets WHERE month=? AND group_id=? AND kind=?', month, groupId, kind);
  }
  async mapped(groupId, kind, referenceId) {
    return one(this.env, 'SELECT * FROM sheet_rows WHERE group_id=? AND kind=? AND reference_id=?', groupId, kind, referenceId);
  }
  async remember(target, referenceId, rowNumber) {
    await run(this.env, `INSERT INTO sheet_rows(group_id,kind,reference_id,month,row_number,recorded_at_ms)
      VALUES (?,?,?,?,?,?) ON CONFLICT(group_id,kind,reference_id) DO NOTHING`,
    target.group_id, target.kind, referenceId, target.month, rowNumber, Date.now());
    return this.mapped(target.group_id, target.kind, referenceId);
  }
  async allocate(target, referenceId) {
    const existing = await this.mapped(target.group_id, target.kind, referenceId);
    if (existing) return { ...existing, fresh: false };
    // sync lease serializes allocation, and this D1 batch commits atomically.
    await this.env.DB.batch([
      stmt(this.env, `INSERT INTO sheet_rows(group_id,kind,reference_id,month,row_number,recorded_at_ms)
        SELECT group_id,kind,?,month,next_row,? FROM sheet_targets WHERE month=? AND group_id=? AND kind=?`,
      referenceId, Date.now(), target.month, target.group_id, target.kind),
      stmt(this.env, 'UPDATE sheet_targets SET next_row=next_row+1 WHERE month=? AND group_id=? AND kind=?', target.month, target.group_id, target.kind),
    ]);
    return { ...await this.mapped(target.group_id, target.kind, referenceId), fresh: true };
  }
  async findMessage(groupId, messageId, month) {
    const targets = await rows(this.env, `SELECT t.*, w.spreadsheet_id FROM sheet_targets t JOIN workbooks w ON w.month=t.month
      WHERE t.group_id=? AND t.kind='messages' AND w.expired=0 ${month ? 'AND t.month=?' : ''}
      ORDER BY t.month DESC LIMIT 14`, ...[groupId, ...(month ? [month] : [])]);
    for (const target of targets) {
      const ids = await this.values(target.spreadsheet_id, `${quote(target.title)}!B2:B${Math.max(2, target.next_row - 1)}`);
      const index = ids.findIndex((r) => r[0] === messageId);
      if (index >= 0) return this.remember(target, messageId, index + 2);
    }
    return null;
  }
  async existingHistory(target, event) {
    const cached = await this.mapped(event.group_id, 'history', event.webhook_event_id);
    if (cached) return { ...cached, fresh: false };
    if (event.event_at_ms < Date.now() - Number(this.env.CACHE_DAYS || 7) * 86400_000) {
      const book = await one(this.env, 'SELECT spreadsheet_id FROM workbooks WHERE month=?', target.month);
      const ids = await this.values(book.spreadsheet_id, `${quote(target.title)}!A2:A${Math.max(2, target.next_row - 1)}`);
      const index = ids.findIndex((r) => r[0] === event.webhook_event_id);
      if (index >= 0) return { ...await this.remember(target, event.webhook_event_id, index + 2), fresh: false };
    }
    return this.allocate(target, event.webhook_event_id);
  }
  async writeEvent(event) {
    const original = await enrichOriginal(this.env, await one(this.env, 'SELECT * FROM messages WHERE group_id=? AND message_id=?', event.group_id, event.message_id));
    let location = await this.mapped(event.group_id, 'messages', event.message_id);
    // Cold lookups are only for old redeliveries or updates outside the cache.
    if (!location && (!original || original.sent_at_ms < Date.now() - Number(this.env.CACHE_DAYS || 7) * 86400_000)) {
      location = await this.findMessage(event.group_id, event.message_id, original ? thaiMonth(original.sent_at_ms) : null);
    }
    if (!location && !original) throw new Error('รอข้อความต้นฉบับจาก LINE หรือไม่พบข้อความในชีต');
    const month = location?.month || thaiMonth(original.sent_at_ms);
    const bookId = await this.workbook(month);
    const currentTarget = await this.target(month, event.group_id, 'messages');
    const historyTarget = await this.target(month, event.group_id, 'history');
    if (!location) location = await this.allocate(currentTarget, event.message_id);
    const historyLocation = await this.existingHistory(historyTarget, event);
    // Expand before reading a persisted coordinate. A previous attempt may have
    // reserved row 101 and failed before expanding Google's 100-row grid.
    const expansions = [[currentTarget, location], [historyTarget, historyLocation]]
      .filter(([target, mapped]) => mapped.row_number > target.capacity);
    if (expansions.length) {
      await this.batch(bookId, expansions.map(([target, mapped]) => ({ updateSheetProperties: {
        properties: { sheetId: target.sheet_id, gridProperties: { rowCount: Math.ceil(mapped.row_number / 100) * 100 } },
        fields: 'gridProperties.rowCount',
      } })));
      for (const [target, mapped] of expansions) {
        target.capacity = Math.ceil(mapped.row_number / 100) * 100;
        await run(this.env, 'UPDATE sheet_targets SET capacity=? WHERE month=? AND group_id=? AND kind=?',
          target.capacity, target.month, target.group_id, target.kind);
      }
    }
    if (!historyLocation.fresh) {
      const history = await this.values(bookId, `${quote(historyTarget.title)}!A${historyLocation.row_number}:A${historyLocation.row_number}`);
      if (history[0]?.[0] === event.webhook_event_id) return;
    }
    const previous = location.fresh ? null : fromRow((await this.values(bookId,
      `${quote(currentTarget.title)}!A${location.row_number}:O${location.row_number}`))[0]);
    const record = projectMessage(previous, original, event);
    if (!record) throw new Error('ไม่พบข้อความต้นฉบับสำหรับอัปเดตชีต');
    const cutoff = Date.now() - Number(this.env.RETENTION_DAYS || 365) * 86400_000;
    if (Number(record.sent_at_ms) < cutoff) return;
    const requests = [];
    requests.push(this.cellRequest(currentTarget, location.row_number, toRow(record, MESSAGE_HEADERS)));
    requests.push(this.cellRequest(historyTarget, historyLocation.row_number, toRow({ ...event,
      event_at_thai: thaiTime(event.event_at_ms), timezone: 'Asia/Bangkok', original_sent_at_ms: Number(record.sent_at_ms),
    }, HISTORY_HEADERS)));
    // Both tabs are updated in a SINGLE atomic Sheets request.
    await this.batch(bookId, requests);
  }
}
