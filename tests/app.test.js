import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { base64, hmacKey, signObject, utf8, encrypt, decrypt, readObject } from '../src/crypto.js';
import { testEnv, context } from './helpers.js';
import { normalizeEvent, ingest } from '../src/line.js';
import { one, run, setting, setSetting } from '../src/store.js';
import { projectMessage, thaiTime } from '../src/projection.js';
import { startLogin } from '../src/auth.js';

const envs = [];
function env() { const value = testEnv(); envs.push(value); return value; }
afterEach(() => { while (envs.length) envs.pop().DB.close(); });
const textEvent = (extra = {}) => ({ type: 'message', timestamp: Date.now(), webhookEventId: 'e1',
  source: { type: 'group', groupId: 'g1', userId: 'u1' }, message: { id: '9007199254740993', type: 'text', text: '=IMPORTXML("private")', quotedMessageId: 'before-bot' }, ...extra });
async function seedProfiles(e) {
  await run(e, 'INSERT INTO chat_groups VALUES (?,?,1,?)', 'g1', 'ทดสอบ', Date.now());
  await run(e, 'INSERT INTO member_profiles VALUES (?,?,?,?)', 'g1', 'u1', 'คุณเอ', Date.now() + 86400_000);
}

test('LINE signature rejects forged webhook and accepts an empty verification event', async () => {
  const e = env(); const ctx = context();
  let response = await worker.fetch(new Request(`${e.APP_URL}/webhooks/line`, { method: 'POST', body: '{"events":[]}' }), e, ctx);
  assert.equal(response.status, 401);
  const body = JSON.stringify({ events: [] });
  const signature = base64(await crypto.subtle.sign('HMAC', await hmacKey(e.LINE_CHANNEL_SECRET), utf8(body)));
  response = await worker.fetch(new Request(`${e.APP_URL}/webhooks/line`, { method: 'POST', body, headers: { 'x-line-signature': signature } }), e, ctx);
  assert.equal(response.status, 200); await ctx.finish();
});

test('signed Thai webhook is durable before acknowledgement and redelivery does not duplicate it', async () => {
  const e = env(); await seedProfiles(e); const ctx = context();
  const body = JSON.stringify({ events: [textEvent()] });
  const signature = base64(await crypto.subtle.sign('HMAC', await hmacKey(e.LINE_CHANNEL_SECRET), utf8(body)));
  for (let i = 0; i < 2; i++) {
    const response = await worker.fetch(new Request(`${e.APP_URL}/webhooks/line`, { method: 'POST', body, headers: { 'x-line-signature': signature } }), e, ctx);
    assert.equal(response.status, 200);
  }
  await ctx.finish();
  const row = await one(e, 'SELECT * FROM messages');
  assert.equal(row.sender_display_name, 'คุณเอ'); assert.equal(row.replied_to_message_id, 'before-bot');
  assert.equal(row.original_text, '=IMPORTXML("private")');
  assert.equal((await one(e, 'SELECT COUNT(*) AS n FROM message_events')).n, 1);
});

test('non-text and one-to-one events are ignored', () => {
  assert.equal(normalizeEvent(textEvent({ message: { type: 'image', id: '1' } })), null);
  assert.equal(normalizeEvent(textEvent({ source: { type: 'user', userId: '1' } })), null);
});

test('out-of-order edits and unsend preserve original identity and source time', async () => {
  const e = env(); await seedProfiles(e);
  await ingest(e, normalizeEvent(textEvent({ type: 'messageEdited', webhookEventId: 'e2', message: { type: 'text', id: '9007199254740993', text: 'ใหม่' } })));
  await ingest(e, normalizeEvent(textEvent()));
  await ingest(e, normalizeEvent({ ...textEvent(), type: 'unsend', webhookEventId: 'e3', unsend: { messageId: '9007199254740993' } }));
  const result = await one(e, 'SELECT * FROM message_current');
  assert.equal(result.current_text, 'ใหม่'); assert.equal(result.message_status, 'unsent');
  assert.equal(result.version_count, 2); assert.equal(result.sender_id, 'u1');
});

test('status is private, only owner sessions work, and mutations require same origin', async () => {
  const e = env(); const ctx = context();
  let result = await (await worker.fetch(new Request(`${e.APP_URL}/api/status`), e, ctx)).json();
  assert.equal(result.authenticated, false); assert.equal(result.groups, undefined);
  const other = await signObject({ purpose: 'session', email: 'other@example.com', exp: Date.now() + 60_000 }, e.SESSION_SECRET);
  result = await (await worker.fetch(new Request(`${e.APP_URL}/api/status`, { headers: { cookie: `archive_session=${other}` } }), e, ctx)).json();
  assert.equal(result.authenticated, false);
  const token = await signObject({ purpose: 'session', email: e.OWNER_EMAIL, exp: Date.now() + 60_000 }, e.SESSION_SECRET);
  let response = await worker.fetch(new Request(`${e.APP_URL}/api/retry`, { method: 'POST', headers: { cookie: `archive_session=${token}`, origin: 'https://evil.example' } }), e, ctx);
  assert.equal(response.status, 403);
  response = await worker.fetch(new Request(`${e.APP_URL}/api/retry`, { method: 'POST', headers: { cookie: `archive_session=${token}`, origin: e.APP_URL } }), e, ctx);
  assert.equal(response.status, 202); await ctx.finish();
  response = await worker.fetch(new Request(`${e.APP_URL}/api/status`, { headers: { cookie: `archive_session=${token}` } }), e, ctx);
  result = await response.json(); assert.equal(result.authenticated, true); assert.equal(result.email, e.OWNER_EMAIL);
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
});

test('OAuth state has PKCE and expires, token encryption detects tampering', async () => {
  const e = env(); const response = await startLogin(e);
  const url = new URL(response.headers.get('location'));
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.equal(url.searchParams.get('redirect_uri'), `${e.APP_URL}/auth/callback`);
  const token = response.headers.get('set-cookie').split(';')[0].split('=')[1];
  const state = await readObject(token, e.SESSION_SECRET);
  assert.equal(state.nonce, url.searchParams.get('state')); assert.ok(state.verifier);
  assert.equal(await readObject(token, e.SESSION_SECRET, Date.now() + 700_000), null);
  const encrypted = await encrypt('refresh-secret', e.TOKEN_ENCRYPTION_SECRET);
  assert.equal(await decrypt(encrypted, e.TOKEN_ENCRYPTION_SECRET), 'refresh-secret');
  await assert.rejects(() => decrypt(`${encrypted.slice(0, -4)}AAAA`, e.TOKEN_ENCRYPTION_SECRET));
  const invalid = await worker.fetch(new Request(`${e.APP_URL}/auth/callback?state=forged&code=fake`), e, context());
  assert.equal(invalid.status, 403); assert.equal(await setting(e, 'google_refresh_token'), null);
});

test('projection uses event time, maintains one identity and keeps unsent text', () => {
  const original = { group_id: 'g', message_id: 'm', sent_at_ms: 64_800_123, original_text: 'เดิม' };
  let current = projectMessage(null, original, { event_type: 'edited', event_at_ms: 200, webhook_event_id: 'e2', text: 'ใหม่สุด' });
  current = projectMessage(current, original, { event_type: 'edited', event_at_ms: 100, webhook_event_id: 'e1', text: 'เก่ากว่า' });
  current = projectMessage(current, original, { event_type: 'unsent', event_at_ms: 300 });
  assert.equal(current.current_text, 'ใหม่สุด'); assert.equal(current.version_count, 3); assert.equal(current.message_status, 'unsent');
  assert.equal(thaiTime(original.sent_at_ms), '1970-01-02T01:00:00.123+07:00');
});

test('a 100-event webhook is stored in bounded SQL batches and remains idempotent', async () => {
  const e = env(); const ctx = context();
  const events = Array.from({ length: 100 }, (_, i) => textEvent({ webhookEventId: `bulk-${i}`,
    source: { type: 'group', groupId: `g${i}`, userId: `u${i}` }, message: { type: 'text', id: `${i}`, text: `ข้อความ ${i}` } }));
  const body = JSON.stringify({ events });
  const signature = base64(await crypto.subtle.sign('HMAC', await hmacKey(e.LINE_CHANNEL_SECRET), utf8(body)));
  for (let i = 0; i < 2; i++) {
    e.DB.resetCount();
    const response = await worker.fetch(new Request(`${e.APP_URL}/webhooks/line`, { method: 'POST', body, headers: { 'x-line-signature': signature } }), e, ctx);
    assert.equal(response.status, 200); await ctx.finish();
    assert.ok(e.DB.queryCount() < 50, `D1 query count ${e.DB.queryCount()}`);
  }
  assert.equal((await one(e, 'SELECT COUNT(*) AS n FROM messages')).n, 100);
  assert.equal((await one(e, 'SELECT COUNT(*) AS n FROM message_events')).n, 100);
});

test('Google callback denies a non-owner and does not save their refresh token', async (t) => {
  const e = env();
  const start = await startLogin(e);
  const url = new URL(start.headers.get('location'));
  const cookie = start.headers.get('set-cookie').split(';')[0];
  t.mock.method(globalThis, 'fetch', async (url) => Response.json(String(url).includes('/userinfo')
    ? { email: 'stranger@example.com', email_verified: true }
    : { access_token: 'fake', refresh_token: 'must-not-store', scope: 'openid email' }));
  const response = await worker.fetch(new Request(`${e.APP_URL}/auth/callback?state=${url.searchParams.get('state')}&code=stub`, { headers: { cookie } }), e, context());
  assert.equal(response.status, 403);
  assert.equal(await setting(e, 'google_refresh_token'), null);
});
