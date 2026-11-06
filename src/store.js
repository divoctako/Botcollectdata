export const stmt = (env, sql, ...args) => {
  if (env._budget) env._budget.sql++;
  return env.DB.prepare(sql).bind(...args);
};
export const one = (env, sql, ...args) => stmt(env, sql, ...args).first();
export async function rows(env, sql, ...args) { return (await stmt(env, sql, ...args).all()).results; }
export const run = (env, sql, ...args) => stmt(env, sql, ...args).run();
export async function setting(env, key) { return (await one(env, 'SELECT value FROM settings WHERE key = ?', key))?.value ?? null; }
export const setSetting = (env, key, value) => run(env,
  'INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, String(value));

export async function acquireLease(env, name, ttl = 90_000) {
  const token = crypto.randomUUID();
  const now = Date.now();
  const result = await stmt(env, `INSERT INTO leases(name,token,expires_at_ms) VALUES (?,?,?)
    ON CONFLICT(name) DO UPDATE SET token=excluded.token, expires_at_ms=excluded.expires_at_ms
    WHERE leases.expires_at_ms < ? RETURNING token`, name, token, now + ttl, now).first();
  return result?.token === token ? token : null;
}
export const releaseLease = (env, name, token) => run(env, 'DELETE FROM leases WHERE name=? AND token=?', name, token);

export async function stats(env) {
  const pending = await one(env, `SELECT COUNT(*) AS count,
    SUM(CASE WHEN attempts > 0 THEN 1 ELSE 0 END) AS failed,
    MIN(received_at_ms) AS oldest FROM message_events WHERE sheets_synced_at_ms IS NULL`);
  const groups = await rows(env, `SELECT g.group_id,g.display_name,g.active,g.updated_at_ms,
    COALESCE(p.count,0) AS pending FROM chat_groups g LEFT JOIN
    (SELECT group_id,COUNT(*) AS count FROM message_events WHERE sheets_synced_at_ms IS NULL GROUP BY group_id) p
    ON p.group_id=g.group_id ORDER BY g.updated_at_ms DESC LIMIT 100`);
  const errors = await rows(env, `SELECT webhook_event_id,group_id,attempts,last_error,next_attempt_at_ms
    FROM message_events WHERE sheets_synced_at_ms IS NULL AND last_error IS NOT NULL
    ORDER BY received_at_ms LIMIT 10`);
  return {
    pending: pending.count, failed: pending.failed || 0, oldest: pending.oldest,
    groups, errors,
    syncedEvents: Number(await setting(env, 'synced_events') || 0),
    lastSyncAt: Number(await setting(env, 'last_sync_at') || 0) || null,
    lastMaintenanceAt: Number(await setting(env, 'last_maintenance_at') || 0) || null,
    indexSpreadsheetId: await setting(env, 'index_spreadsheet_id'),
    workbooks: await rows(env, 'SELECT month,spreadsheet_id FROM workbooks WHERE expired=0 ORDER BY month DESC LIMIT 14'),
  };
}
