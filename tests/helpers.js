import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

export function database({ initialize = true } = {}) {
  const db = new DatabaseSync(':memory:');
  if (initialize) for (const name of ['0001_chat_messages.sql', '0002_runtime.sql', '0003_cleanup_indexes.sql']) {
    db.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
  }
  let queries = 0;
  const prepare = (sql, args = []) => ({
    bind: (...values) => prepare(sql, values),
    first: async (column) => { queries++; const row = db.prepare(sql).get(...args) ?? null; return column ? row?.[column] ?? null : row; },
    all: async () => { queries++; return { results: db.prepare(sql).all(...args), success: true }; },
    run: async () => { queries++; const result = db.prepare(sql).run(...args); return { meta: { changes: Number(result.changes) }, success: true }; },
  });
  return {
    prepare,
    batch: async (statements) => {
      db.exec('BEGIN');
      try { const results = []; for (const statement of statements) results.push(await statement.run()); db.exec('COMMIT'); return results; }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    exec: (sql) => db.exec(sql), close: () => db.close(),
    queryCount: () => queries, resetCount: () => { queries = 0; },
  };
}
export const testEnv = () => ({
  DB: database(), APP_URL: 'https://archive.example', OWNER_EMAIL: 'owner@example.com',
  SESSION_SECRET: 'test-session-secret-with-more-than-32-bytes',
  TOKEN_ENCRYPTION_SECRET: 'test-encryption-secret-with-more-than-32-bytes',
  LINE_CHANNEL_SECRET: 'line-secret', LINE_CHANNEL_ACCESS_TOKEN: 'not-real',
  GOOGLE_CLIENT_ID: 'client', GOOGLE_CLIENT_SECRET: 'secret', CACHE_DAYS: '7', RETENTION_DAYS: '365',
  ASSETS: { fetch: async () => new Response('static', { headers: { 'content-type': 'text/html' } }) },
});
export const context = () => {
  const pending = [];
  return { waitUntil: (promise) => pending.push(promise), finish: () => Promise.all(pending) };
};
