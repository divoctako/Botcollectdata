import { GoogleSheets } from './sheets.js';
import { acquireLease, releaseLease, one, rows, run, setting, setSetting } from './store.js';
import { thaiMonth } from './projection.js';

export async function drain(env, options = {}) {
  if (!await setting(env, 'google_refresh_token')) return { processed: 0, waitingForGoogle: true };
  const token = await acquireLease(env, 'sheets');
  if (!token) return { processed: 0, busy: true };
  const deadline = Date.now() + 22_000;
  const sheets = options.sheets || new GoogleSheets(env, token);
  let processed = 0;
  try {
    const events = await rows(env, `SELECT * FROM message_events WHERE sheets_synced_at_ms IS NULL
      AND next_attempt_at_ms <= ? ORDER BY received_at_ms, event_at_ms LIMIT 2`, Date.now());
    if (!events.length) {
      const month = thaiMonth(Date.now());
      const group = await one(env, `SELECT g.group_id FROM chat_groups g WHERE active=1 AND
        (SELECT COUNT(*) FROM sheet_targets t WHERE t.group_id=g.group_id AND t.month=?) < 2 LIMIT 1`, month);
      if (group) {
        try {
          await sheets.target(month, group.group_id, 'messages');
          await sheets.target(month, group.group_id, 'history');
          await setSetting(env, 'setup_error', '');
        } catch (error) { await setSetting(env, 'setup_error', error.message.slice(0, 240)); }
      }
    }
    for (const event of events) {
      if (Date.now() >= deadline) break;
      try {
        await sheets.writeEvent(event);
        const now = Date.now();
        await run(env, 'UPDATE message_events SET sheets_synced_at_ms=?,last_error=NULL WHERE webhook_event_id=?', now, event.webhook_event_id);
        await setSetting(env, 'last_sync_at', now);
        await run(env, `INSERT INTO settings(key,value) VALUES ('synced_events','1')
          ON CONFLICT(key) DO UPDATE SET value=CAST(CAST(value AS INTEGER)+1 AS TEXT)`);
        processed++;
      } catch (error) {
        const attempts = event.attempts + 1;
        const delay = Math.min(3600_000, 15_000 * 2 ** Math.min(attempts, 8));
        await run(env, `UPDATE message_events SET attempts=?,last_error=?,next_attempt_at_ms=? WHERE webhook_event_id=?`,
          attempts, error.message.slice(0, 240), Date.now() + delay, event.webhook_event_id);
        if ([401, 403, 429].includes(error.status)) break;
      }
    }
    return { processed };
  } finally { await releaseLease(env, 'sheets', token); }
}
