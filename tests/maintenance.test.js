import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { testEnv } from './helpers.js';
import { maintain } from '../src/maintenance.js';
import { one, run, setSetting, setting } from '../src/store.js';
import { thaiMonth } from '../src/projection.js';
import { GoogleSheets } from '../src/sheets.js';

const envs = [];
afterEach(() => { while (envs.length) envs.pop().DB.close(); });
async function setup() {
  const env = testEnv(); envs.push(env); await setSetting(env, 'google_refresh_token', 'fake'); return env;
}

test('retention clears only expired rows without shifting fixed coordinates or deleting pending recovery', async () => {
  const env = await setup();
  const cutoff = Date.now() - 365 * 86400_000;
  const month = thaiMonth(cutoff);
  await run(env, 'INSERT INTO workbooks(month,spreadsheet_id,created_at_ms) VALUES (?,?,?)', month, 'book', Date.now());
  await run(env, `INSERT INTO sheet_targets(month,group_id,kind,sheet_id,title,next_row) VALUES (?,?,?,?,?,?)`, month, 'g', 'messages', 1, 'group', 4);
  const old = Date.now() - 10 * 86400_000;
  for (const [id, synced] of [['completed', old], ['pending', null]]) {
    await run(env, `INSERT INTO message_events(webhook_event_id,group_id,message_id,event_type,event_at_ms,received_at_ms,text,sheets_synced_at_ms)
      VALUES (?,?,?,'received',?,?,?,?)`, id, 'g', id, old, old, 'เก็บไว้', synced);
    await run(env, 'INSERT INTO messages VALUES (?,?,?,?,?,?,?,?)', 'g', id, null, null, old, old, 'เก็บไว้', null);
  }
  const writes = [];
  await run(env, 'INSERT INTO sheet_rows VALUES (?,?,?,?,?,?)', 'g', 'history', 'pending', month, 2, old);
  await run(env, 'INSERT INTO sheet_rows VALUES (?,?,?,?,?,?)', 'g', 'history', 'completed', month, 3, old);
  await maintain(env, { google: {
    values: async () => [[cutoff - 1000], [cutoff + 1000]],
    batch: async (_id, requests) => writes.push(...requests),
  } });
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].repeatCell.range, { sheetId: 1, startRowIndex: 1, endRowIndex: 2 });
  assert.equal(writes[0].repeatCell.fields, 'userEnteredValue,note');
  assert.equal(await one(env, "SELECT * FROM message_events WHERE webhook_event_id='completed'"), null);
  assert.ok(await one(env, "SELECT * FROM message_events WHERE webhook_event_id='pending'"));
  assert.ok(await one(env, "SELECT * FROM messages WHERE message_id='pending'"));
  assert.equal(await one(env, "SELECT * FROM messages WHERE message_id='completed'"), null);
  assert.equal(await setting(env, 'maintenance_error'), '');
  assert.ok(await one(env, "SELECT * FROM sheet_rows WHERE reference_id='pending'"));
  assert.equal(await one(env, "SELECT * FROM sheet_rows WHERE reference_id='completed'"), null);
});

test('fully expired monthly files are trashed and failures are retryable', async () => {
  const env = await setup();
  await run(env, 'INSERT INTO workbooks(month,spreadsheet_id,created_at_ms) VALUES (?,?,?)', '2020-01', 'expired', 0);
  await maintain(env, { google: { api: async () => { throw new Error('Google unavailable'); } } });
  assert.equal((await one(env, 'SELECT * FROM workbooks')).expired, 0);
  assert.equal(await setting(env, 'maintenance_error'), 'Google unavailable');
  const calls = [];
  await maintain(env, { google: { api: async (...args) => { calls.push(args); return {}; } } });
  assert.equal((await one(env, 'SELECT * FROM workbooks')).expired, 1);
  assert.equal(calls[0][1], 'PATCH'); assert.deepEqual(calls[0][2], { trashed: true });
  assert.equal(await setting(env, 'maintenance_error'), '');
});

test('file discovery recovers a successful create whose HTTP response was lost', async () => {
  const env = await setup(); const sheets = new GoogleSheets(env);
  let created; let creates = 0;
  sheets.api = async (_url, method, body) => {
    if (method === 'POST') { created = { id: 'same-file', ...body }; creates++; throw new Error('Response lost'); }
    return { files: created ? [created] : [] };
  };
  await assert.rejects(() => sheets.file('month', 'Archive'));
  assert.equal(await sheets.file('month', 'Archive'), 'same-file');
  assert.equal(creates, 1);
});
