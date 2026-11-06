import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { database, testEnv, context } from './helpers.js';
import { ensureDashboardDatabase } from '../src/dashboard-bootstrap.js';
import { splitSql } from '../scripts/sql-statements.mjs';
import bundledWorker from '../release/worker.js';

const statements = ['0001_chat_messages.sql', '0002_runtime.sql', '0003_cleanup_indexes.sql']
  .flatMap((file) => splitSql(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8')));

test('Dashboard installation creates complete schema atomically and is repeatable', async () => {
  const db = database({ initialize: false });
  try {
    await Promise.all([ensureDashboardDatabase(db, statements), ensureDashboardDatabase(db, statements)]);
    await ensureDashboardDatabase(db, statements);
    assert.equal((await db.prepare("SELECT value FROM settings WHERE key='dashboard_schema_version'").first()).value, '3');
    const columns = (await db.prepare('PRAGMA table_info(message_events)').all()).results;
    assert.ok(columns.some((r) => r.name === 'last_error'));
    assert.ok(await db.prepare("SELECT name FROM sqlite_master WHERE name='ai_messages'").first());
  } finally { db.close(); }
});

test('Dashboard initializer leaves an existing unmarked database untouched', async () => {
  const db = database();
  try {
    await db.prepare("INSERT INTO settings VALUES ('keep','original')").run();
    await assert.rejects(() => ensureDashboardDatabase(db, statements), /มีตารางอยู่แล้ว/);
    assert.equal((await db.prepare("SELECT value FROM settings WHERE key='keep'").first()).value, 'original');
  } finally { db.close(); }
});

test('failed initialization rolls back instead of leaving half-created tables', async () => {
  const db = database({ initialize: false });
  try {
    await assert.rejects(() => ensureDashboardDatabase(db, [...statements, 'INVALID SQL']));
    assert.equal(await db.prepare("SELECT name FROM sqlite_master WHERE name='messages'").first(), null);
    await ensureDashboardDatabase(db, statements);
    assert.ok(await db.prepare("SELECT name FROM sqlite_master WHERE name='messages'").first());
  } finally { db.close(); }
});

test('copy-paste bundle serves actual frontend and API without ASSETS binding or imports', async () => {
  const env = testEnv(); env.DB.close(); env.DB = database({ initialize: false }); delete env.ASSETS;
  try {
    const page = await bundledWorker.fetch(new Request(`${env.APP_URL}/`), env, context());
    assert.equal(page.status, 200); assert.match(await page.text(), /ทุกบทสนทนา/);
    const css = await bundledWorker.fetch(new Request(`${env.APP_URL}/styles.css`), env, context());
    assert.match(css.headers.get('content-type'), /text\/css/);
    const js = await bundledWorker.fetch(new Request(`${env.APP_URL}/app.js`), env, context());
    assert.match(await js.text(), /\/api\/status/);
    const status = await bundledWorker.fetch(new Request(`${env.APP_URL}/api/status`), env, context());
    assert.equal((await status.json()).authenticated, false);
    const unknown = await bundledWorker.fetch(new Request(`${env.APP_URL}/missing`), env, context());
    assert.equal(unknown.status, 404);
    const missingDb = await bundledWorker.fetch(new Request(`${env.APP_URL}/`), { ...env, DB: undefined }, context());
    assert.equal(missingDb.status, 503); assert.match((await missingDb.json()).error, /binding ชื่อ DB/);
  } finally { env.DB.close(); }
});

test('SQL splitting preserves quoted semicolons and skips comment semicolons', () => {
  const sql = "-- comment;\nSELECT 'a;b'; /* ; */ SELECT 'it''s;ok';";
  assert.deepEqual(splitSql(sql), ["SELECT 'a;b'", "SELECT 'it''s;ok'"]);
});
