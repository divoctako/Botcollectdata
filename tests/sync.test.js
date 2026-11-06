import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { testEnv } from './helpers.js';
import { GoogleSheets } from '../src/sheets.js';
import { drain } from '../src/sync.js';
import { ingest, normalizeEvent } from '../src/line.js';
import { one, run, setSetting, acquireLease, releaseLease } from '../src/store.js';
import { thaiMonth } from '../src/projection.js';

const envs = [];
afterEach(() => { while (envs.length) envs.pop().DB.close(); });
async function fixture() {
  const env = testEnv(); envs.push(env);
  await setSetting(env, 'google_refresh_token', 'fake-not-used');
  await run(env, 'INSERT INTO chat_groups VALUES (?,?,1,?)', 'g', 'ทีมทดสอบ', Date.now());
  await run(env, 'INSERT INTO member_profiles VALUES (?,?,?,?)', 'g', 'u', 'เอ', Date.now() + 86400_000);
  const month = thaiMonth(Date.now());
  await run(env, 'INSERT INTO workbooks(month,spreadsheet_id,created_at_ms) VALUES (?,?,?)', month, 'book', Date.now());
  for (const [kind, id, title] of [['messages', 1, 'current'], ['history', 2, 'history']]) {
    await run(env, 'INSERT INTO sheet_targets(month,group_id,kind,sheet_id,title) VALUES (?,?,?,?,?)', month, 'g', kind, id, title);
  }
  const sheets = new GoogleSheets(env);
  const cells = new Map(); const capacities = new Map([[1, 100], [2, 100]]);
  let writes = 0; let loseResponse = false;
  sheets.api = async (url, method = 'GET', body) => {
    if (method === 'POST' && url.endsWith(':batchUpdate')) {
      writes++;
      for (const request of body.requests) {
        if (request.updateSheetProperties) {
          const { sheetId, gridProperties } = request.updateSheetProperties.properties;
          capacities.set(sheetId, gridProperties.rowCount);
        }
        if (!request.updateCells) continue;
        const { start, rows } = request.updateCells;
        const values = rows[0].values.map((cell) => cell.userEnteredValue.stringValue ?? cell.userEnteredValue.numberValue);
        cells.set(`${start.sheetId}:${start.rowIndex + 1}`, values);
        // Text always uses stringValue, even for formulas or numeric-looking IDs.
        if (start.sheetId === 1) assert.equal(rows[0].values[1].userEnteredValue.stringValue, '9007199254740993');
      }
      if (loseResponse) { loseResponse = false; throw new Error('Simulated response lost AFTER Sheets commit'); }
      return {};
    }
    const range = decodeURIComponent(url.split('/values/')[1]);
    const match = range.match(/^'(current|history)'!([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
    assert.ok(match, range);
    const [, title, col, start, , end] = match;
    const id = title === 'current' ? 1 : 2;
    if (Number(end) > capacities.get(id)) throw new Error('Requested range exceeds grid limits');
    const values = [];
    for (let row = Number(start); row <= Number(end); row++) {
      const value = cells.get(`${id}:${row}`);
      values.push(value ? col === 'B' ? [value[1]] : col === 'A' && title === 'history' && range.match(/:A\d+$/) ? [value[0]] : value : []);
    }
    return { values };
  };
  const send = async (id, type = 'message', text = '=SUM(1,2)', timestamp = Date.now()) => ingest(env, normalizeEvent({
    type, webhookEventId: id, timestamp, source: { type: 'group', groupId: 'g', userId: 'u' },
    message: { type: 'text', id: '9007199254740993', text }, unsend: { messageId: '9007199254740993' },
  }));
  return { env, sheets, cells, send, writes: () => writes, loseNextResponse: () => { loseResponse = true; } };
}

test('lost Sheets response retries the SAME rows without duplicating history or version counts', async () => {
  const f = await fixture(); await f.send('initial'); f.loseNextResponse();
  await drain(f.env, { sheets: f.sheets });
  assert.equal((await one(f.env, 'SELECT * FROM message_events')).sheets_synced_at_ms, null);
  assert.equal(f.cells.size, 2); assert.equal(f.writes(), 1);
  await run(f.env, 'UPDATE message_events SET next_attempt_at_ms=0');
  await drain(f.env, { sheets: f.sheets });
  assert.equal(f.writes(), 1); assert.equal(f.cells.size, 2);
  assert.ok((await one(f.env, 'SELECT * FROM message_events')).sheets_synced_at_ms);
  await f.send('edit', 'messageEdited', 'แก้ไขแล้ว');
  await drain(f.env, { sheets: f.sheets });
  assert.equal(f.cells.get('1:2')[8], 'แก้ไขแล้ว');
  assert.equal(f.cells.get('1:2')[13], 2);
  assert.equal(f.cells.size, 3);
  await f.send('unsend', 'unsend'); await drain(f.env, { sheets: f.sheets });
  assert.equal(f.cells.get('1:2')[10], 'unsent'); assert.equal(f.cells.get('1:2')[8], 'แก้ไขแล้ว');
  assert.equal(f.cells.size, 4);
});

test('sync cannot overlap, and failure remains durable with retry backoff', async () => {
  const f = await fixture(); await f.send('initial');
  const token = await acquireLease(f.env, 'sheets');
  assert.equal((await drain(f.env, { sheets: f.sheets })).busy, true);
  assert.equal(f.writes(), 0); await releaseLease(f.env, 'sheets', token);
  const failed = { writeEvent: async () => { const error = new Error('External API: HTTP 429'); error.status = 429; throw error; } };
  await drain(f.env, { sheets: failed });
  const event = await one(f.env, 'SELECT * FROM message_events');
  assert.equal(event.attempts, 1); assert.equal(event.sheets_synced_at_ms, null);
  assert.ok(event.next_attempt_at_ms > Date.now());
  assert.equal(await acquireLease(f.env, 'sheets') !== null, true);
});

test('cold updates use the archived row after D1 cache pruning', async () => {
  const f = await fixture(); await f.send('initial'); await drain(f.env, { sheets: f.sheets });
  await run(f.env, 'DELETE FROM messages'); await run(f.env, 'DELETE FROM message_events'); await run(f.env, 'DELETE FROM sheet_rows');
  await f.send('late-edit', 'messageEdited', 'แก้หลังล้าง cache');
  await drain(f.env, { sheets: f.sheets });
  assert.equal(f.cells.get('1:2')[8], 'แก้หลังล้าง cache'); assert.equal(f.cells.get('1:2')[13], 2);
  assert.equal((await one(f.env, "SELECT next_row FROM sheet_targets WHERE kind='messages'")).next_row, 3);
});

test('a normal small sync batch stays inside 50 D1 queries per invocation', async () => {
  const f = await fixture(); await f.send('initial'); await f.send('edit', 'messageEdited', 'แก้ไข');
  f.env.DB.resetCount(); await drain(f.env, { sheets: f.sheets });
  assert.ok(f.env.DB.queryCount() <= 50, `D1 queries: ${f.env.DB.queryCount()}`);
});

test('retry expands reserved coordinates before reading after an interrupted grid expansion', async () => {
  const f = await fixture();
  await run(f.env, 'UPDATE sheet_targets SET next_row=101');
  await f.send('initial'); f.loseNextResponse();
  await drain(f.env, { sheets: f.sheets });
  assert.equal((await one(f.env, 'SELECT * FROM message_events')).sheets_synced_at_ms, null);
  await run(f.env, 'UPDATE message_events SET next_attempt_at_ms=0');
  await drain(f.env, { sheets: f.sheets });
  assert.ok((await one(f.env, 'SELECT * FROM message_events')).sheets_synced_at_ms);
  assert.equal(f.cells.get('1:101')[8], '=SUM(1,2)');
  assert.equal(f.cells.get('2:101')[0], 'initial');
  assert.equal(f.cells.size, 2);
});

test('a joined group gets both tabs even before its first text', async () => {
  const f = await fixture();
  await run(f.env, 'DELETE FROM sheet_targets');
  const calls = [];
  await drain(f.env, { sheets: { target: async (...args) => calls.push(args) } });
  assert.deepEqual(calls.map((c) => c[2]), ['messages', 'history']);
  assert.equal(calls[0][1], 'g');
});
