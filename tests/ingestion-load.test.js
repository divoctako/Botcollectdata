import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { base64, hmacKey, utf8 } from '../src/crypto.js';
import { testEnv, context } from './helpers.js';
import { one } from '../src/store.js';

test('ingestion smoke: 10,000 synthetic texts across 50 groups, not an edge/quota capacity guarantee', async () => {
  const env = testEnv();
  try {
    const key = await hmacKey(env.LINE_CHANNEL_SECRET);
    for (let batch = 0; batch < 100; batch++) {
      const events = Array.from({ length: 100 }, (_, offset) => {
        const id = batch * 100 + offset;
        return { type: 'message', timestamp: Date.now(), webhookEventId: `load-${id}`,
          source: { type: 'group', groupId: `C_${id % 50}`, userId: `U_${id % 100}` },
          message: { id: `message-${id}`, type: 'text', text: `ข้อความทดสอบ ${id}` } };
      });
      const body = JSON.stringify({ events });
      const signature = base64(await crypto.subtle.sign('HMAC', key, utf8(body)));
      const ctx = context(); env.DB.resetCount();
      const result = await worker.fetch(new Request(`${env.APP_URL}/webhooks/line`, {
        method: 'POST', body, headers: { 'x-line-signature': signature },
      }), env, ctx);
      assert.equal(result.status, 200); await ctx.finish();
      assert.ok(env.DB.queryCount() < 50);
    }
    assert.equal((await one(env, 'SELECT COUNT(*) AS count FROM messages')).count, 10_000);
    assert.equal((await one(env, 'SELECT COUNT(*) AS count FROM message_events')).count, 10_000);
    assert.equal((await one(env, 'SELECT COUNT(*) AS count FROM chat_groups')).count, 50);
  } finally { env.DB.close(); }
});
