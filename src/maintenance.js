import { GoogleSheets } from './sheets.js';
import { acquireLease, releaseLease, one, rows, run, setting, setSetting } from './store.js';
import { thaiMonth } from './projection.js';

export async function maintain(env, options = {}) {
  if (!await setting(env, 'google_refresh_token')) return;
  const lock = await acquireLease(env, 'sheets');
  if (!lock) return;
  try {
    const now = Date.now();
    const cutoff = now - Number(env.RETENTION_DAYS || 365) * 86400_000;
    const cacheCutoff = now - Number(env.CACHE_DAYS || 7) * 86400_000;
    const google = options.google || new GoogleSheets(env, lock);
    // One Google maintenance step per invocation; cursors resume next minute.
    const expired = await one(env, 'SELECT * FROM workbooks WHERE expired=0 AND month < ? ORDER BY month LIMIT 1', thaiMonth(cutoff));
    if (expired) {
      await google.api(`https://www.googleapis.com/drive/v3/files/${expired.spreadsheet_id}`, 'PATCH', { trashed: true });
      const index = await setting(env, 'index_spreadsheet_id');
      const title = await setting(env, 'index_sheet_title');
      if (index && title) {
        const records = await google.values(index, `'${title.replaceAll("'", "''")}'!A:C`);
        const position = records.findIndex((r) => r[0] === expired.month);
        if (position >= 0) {
          const meta = await google.api(`https://sheets.googleapis.com/v4/spreadsheets/${index}?fields=sheets(properties)`);
          const target = meta.sheets.find((s) => s.properties.title === title).properties;
          await google.batch(index, [google.cellRequest({ sheet_id: target.sheetId }, position + 1, [expired.month, 'หมดอายุ — ย้ายไปถังขยะแล้ว', 'Asia/Bangkok'])]);
        }
      }
      await run(env, 'UPDATE workbooks SET expired=1 WHERE month=?', expired.month);
    } else {
      // For the oldest partial month, clear expired content without shifting row IDs.
      const targets = await rows(env, `SELECT t.*,w.spreadsheet_id FROM sheet_targets t JOIN workbooks w ON w.month=t.month
        WHERE t.month=? AND w.expired=0 ORDER BY t.group_id,t.kind`, thaiMonth(cutoff));
      if (targets.length) {
        let cursor = JSON.parse(await setting(env, 'retention_cursor') || '{"target":0,"row":2}');
        if (cursor.month !== thaiMonth(cutoff)) cursor = { target: 0, row: 2, month: thaiMonth(cutoff) };
        const target = targets[cursor.target % targets.length];
        const end = Math.min(target.next_row - 1, cursor.row + 399);
        if (end >= cursor.row) {
          const column = target.kind === 'messages' ? 'E' : 'I';
          const dates = await google.values(target.spreadsheet_id,
            `'${target.title.replaceAll("'", "''")}'!${column}${cursor.row}:${column}${end}`);
          const expiredRows = dates.flatMap((r, i) => r[0] !== '' && r[0] != null && Number(r[0]) < cutoff ? [cursor.row + i] : []);
          const ranges = [];
          for (const row of expiredRows) {
            const last = ranges.at(-1);
            if (last && last.endRowIndex === row - 1) last.endRowIndex = row;
            else ranges.push({ sheetId: target.sheet_id, startRowIndex: row - 1, endRowIndex: row });
          }
          if (ranges.length) await google.batch(target.spreadsheet_id, ranges.map((range) => ({
            repeatCell: { range, cell: {}, fields: 'userEnteredValue,note' },
          })));
        }
        cursor.row = end + 1;
        if (cursor.row >= target.next_row) { cursor.row = 2; cursor.target = (cursor.target + 1) % targets.length; }
        await setSetting(env, 'retention_cursor', JSON.stringify(cursor));
      }
    }
    // Bound D1 deletion per minute; never delete an unacknowledged event.
    await run(env, `DELETE FROM message_events WHERE webhook_event_id IN
      (SELECT webhook_event_id FROM message_events WHERE sheets_synced_at_ms < ? LIMIT 100)`, cacheCutoff);
    await run(env, `DELETE FROM messages WHERE rowid IN (SELECT m.rowid FROM messages m
      WHERE received_at_ms < ? AND NOT EXISTS (SELECT 1 FROM message_events e
        WHERE e.group_id=m.group_id AND e.message_id=m.message_id) LIMIT 100)`, cacheCutoff);
    await run(env, `DELETE FROM sheet_rows WHERE rowid IN (SELECT r.rowid FROM sheet_rows r
      WHERE recorded_at_ms < ?
        AND (r.kind <> 'history' OR NOT EXISTS (SELECT 1 FROM message_events e
          WHERE e.webhook_event_id=r.reference_id AND e.sheets_synced_at_ms IS NULL))
        AND (r.kind <> 'messages' OR NOT EXISTS (SELECT 1 FROM message_events e
          WHERE e.group_id=r.group_id AND e.message_id=r.reference_id AND e.sheets_synced_at_ms IS NULL))
      LIMIT 200)`, cacheCutoff);
    await run(env, `DELETE FROM member_profiles WHERE rowid IN (SELECT rowid FROM member_profiles WHERE expires_at_ms < ? LIMIT 100)`, cacheCutoff);
    await setSetting(env, 'last_maintenance_at', now);
    await setSetting(env, 'maintenance_error', '');
  } catch (error) {
    await setSetting(env, 'maintenance_error', error.message.slice(0, 240));
  } finally { await releaseLease(env, 'sheets', lock); }
}
