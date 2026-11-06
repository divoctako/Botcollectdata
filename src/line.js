import { hmacKey, unbase64, utf8 } from './crypto.js';
import { HttpError, externalJson } from './http.js';
import { one, run, stmt } from './store.js';

export async function validLineSignature(raw, signature, secret) {
  if (!signature || !secret) return false;
  try {
    return await crypto.subtle.verify('HMAC', await hmacKey(secret), unbase64(signature), utf8(raw));
  } catch { return false; }
}
export function normalizeEvent(event, now = Date.now()) {
  if (!event || typeof event !== 'object') return null;
  if (event.source?.type !== 'group' || typeof event.source.groupId !== 'string') return null;
  const base = { groupId: event.source.groupId, senderId: event.source.userId ?? null, now };
  if (['join', 'leave'].includes(event.type)) return { ...base, type: event.type };
  let type;
  let messageId;
  let text = null;
  if (['message', 'messageEdited'].includes(event.type) && event.message?.type === 'text') {
    type = event.type === 'message' ? 'received' : 'edited';
    messageId = event.message.id;
    text = event.message.text;
    if (typeof text !== 'string' || text.length > 30_000) return null;
  } else if (event.type === 'unsend') {
    type = 'unsent'; messageId = event.unsend?.messageId;
  } else return null;
  if (!event.webhookEventId || typeof messageId !== 'string'
    || !Number.isSafeInteger(event.timestamp) || event.timestamp < 0) return null;
  return { ...base, type, messageId, text, eventId: event.webhookEventId,
    timestamp: event.timestamp, repliedTo: event.message?.quotedMessageId ?? null };
}

async function lineGet(env, path) {
  return externalJson(`https://api.line.me/v2/bot/${path}`, {
    headers: { authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}` },
    signal: AbortSignal.timeout(2500),
  });
}
async function groupName(env, groupId) {
  const existing = await one(env, 'SELECT * FROM chat_groups WHERE group_id=?', groupId);
  if (existing?.display_name && existing.updated_at_ms > Date.now() - 86400_000) return existing.display_name;
  try { return (await lineGet(env, `group/${encodeURIComponent(groupId)}/summary`)).groupName ?? existing?.display_name ?? null; }
  catch { return existing?.display_name ?? null; }
}
async function senderName(env, event) {
  if (!event.senderId) return null;
  const cached = await one(env, 'SELECT * FROM member_profiles WHERE group_id=? AND sender_id=?', event.groupId, event.senderId);
  if (cached?.expires_at_ms > Date.now()) return cached.display_name;
  let name = cached?.display_name ?? null;
  try {
    name = (await lineGet(env, `group/${encodeURIComponent(event.groupId)}/member/${encodeURIComponent(event.senderId)}`)).displayName ?? name;
  } catch { /* Missing/withdrawn profile consent must not drop the message. */ }
  await run(env, `INSERT INTO member_profiles VALUES (?,?,?,?) ON CONFLICT(group_id,sender_id)
    DO UPDATE SET display_name=excluded.display_name,expires_at_ms=excluded.expires_at_ms`,
  event.groupId, event.senderId, name, Date.now() + (name ? 86400_000 : 3600_000));
  return name;
}
export async function enrichOriginal(env, original) {
  if (!original || original.sender_display_name || !original.sender_id) return original;
  const name = await senderName(env, { groupId: original.group_id, senderId: original.sender_id });
  if (name) {
    await run(env, 'UPDATE messages SET sender_display_name=? WHERE group_id=? AND message_id=? AND sender_display_name IS NULL',
      name, original.group_id, original.message_id);
    return { ...original, sender_display_name: name };
  }
  return original;
}

async function ingestLargeBatch(env, events) {
  // Keep a legitimate multi-event LINE delivery under the Free plan's D1
  // query/bound-parameter limits. Profiles missing from cache resolve at sync.
  const statements = [];
  const groups = new Map();
  for (const event of events) groups.set(event.groupId, event);
  const groupList = [...groups.values()];
  for (let i = 0; i < groupList.length; i += 20) {
    const chunk = groupList.slice(i, i + 20);
    statements.push(stmt(env, `INSERT INTO chat_groups(group_id,active,updated_at_ms) VALUES
      ${chunk.map(() => '(?,?,?)').join(',')} ON CONFLICT(group_id) DO UPDATE SET
      active=excluded.active,updated_at_ms=excluded.updated_at_ms`,
    ...chunk.flatMap((e) => [e.groupId, e.type === 'leave' ? 0 : 1, e.now])));
  }
  const messages = events.filter((e) => e.type === 'received');
  for (let i = 0; i < messages.length; i += 12) {
    const chunk = messages.slice(i, i + 12);
    statements.push(stmt(env, `INSERT INTO messages
      (group_id,message_id,sender_id,sent_at_ms,received_at_ms,original_text,replied_to_message_id)
      VALUES ${chunk.map(() => '(?,?,?,?,?,?,?)').join(',')}
      ON CONFLICT(group_id,message_id) DO NOTHING`,
    ...chunk.flatMap((e) => [e.groupId, e.messageId, e.senderId, e.timestamp, e.now, e.text, e.repliedTo])));
  }
  const content = events.filter((e) => !['join', 'leave'].includes(e.type));
  for (let i = 0; i < content.length; i += 12) {
    const chunk = content.slice(i, i + 12);
    statements.push(stmt(env, `INSERT INTO message_events
      (webhook_event_id,group_id,message_id,event_type,event_at_ms,received_at_ms,text)
      VALUES ${chunk.map(() => '(?,?,?,?,?,?,?)').join(',')} ON CONFLICT(webhook_event_id) DO NOTHING`,
    ...chunk.flatMap((e) => [e.eventId, e.groupId, e.messageId, e.type, e.timestamp, e.now, e.text])));
  }
  if (statements.length) await env.DB.batch(statements);
}
export async function ingest(env, event) {
  if (event.type === 'leave') {
    await run(env, 'UPDATE chat_groups SET active=0,updated_at_ms=? WHERE group_id=?', event.now, event.groupId);
    return false;
  }
  const group = await one(env, 'SELECT * FROM chat_groups WHERE group_id=?', event.groupId);
  if (!group || event.type === 'join') {
    await run(env, `INSERT INTO chat_groups VALUES (?,?,1,?) ON CONFLICT(group_id)
      DO UPDATE SET display_name=COALESCE(excluded.display_name,chat_groups.display_name),active=1,updated_at_ms=excluded.updated_at_ms`,
    event.groupId, await groupName(env, event.groupId), event.now);
  }
  if (event.type === 'join') return false;
  const duplicate = await one(env, 'SELECT webhook_event_id FROM message_events WHERE webhook_event_id=?', event.eventId);
  if (duplicate) return false;
  const statements = [];
  if (event.type === 'received') {
    const name = await senderName(env, event);
    statements.push(stmt(env, `INSERT INTO messages
      (group_id,message_id,sender_id,sender_display_name,sent_at_ms,received_at_ms,original_text,replied_to_message_id)
      VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(group_id,message_id) DO NOTHING`,
    event.groupId, event.messageId, event.senderId, name, event.timestamp, event.now, event.text, event.repliedTo));
  }
  statements.push(stmt(env, `INSERT INTO message_events
    (webhook_event_id,group_id,message_id,event_type,event_at_ms,received_at_ms,text)
    VALUES (?,?,?,?,?,?,?) ON CONFLICT(webhook_event_id) DO NOTHING`,
  event.eventId, event.groupId, event.messageId, event.type, event.timestamp, event.now, event.text));
  await env.DB.batch(statements);
  return true;
}

export async function webhook(request, env) {
  if (!env.LINE_CHANNEL_SECRET) throw new HttpError(503, 'ยังไม่ได้ตั้งค่า LINE');
  if (Number(request.headers.get('content-length') || 0) > 1_000_000) throw new HttpError(413, 'Webhook ใหญ่เกินกำหนด');
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, 'ไม่มี webhook body');
  let size = 0;
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 1_000_000) { await reader.cancel(); throw new HttpError(413, 'Webhook ใหญ่เกินกำหนด'); }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  const raw = new TextDecoder('utf-8', { fatal: true }).decode(body);
  if (!await validLineSignature(raw, request.headers.get('x-line-signature'), env.LINE_CHANNEL_SECRET)) {
    throw new HttpError(401, 'ลายเซ็น LINE ไม่ถูกต้อง');
  }
  let payload;
  try { payload = JSON.parse(raw); } catch { throw new HttpError(400, 'JSON ไม่ถูกต้อง'); }
  if (!Array.isArray(payload.events) || payload.events.length > 100) throw new HttpError(400, 'รูปแบบ events ไม่ถูกต้อง');
  const cutoff = Date.now() - Number(env.RETENTION_DAYS || 365) * 86400_000;
  const events = payload.events.map((e) => normalizeEvent(e)).filter((e) => e && !(e.type === 'received' && e.timestamp < cutoff));
  if (events.length > 3) await ingestLargeBatch(env, events);
  else for (const event of events) await ingest(env, event);
  // Acknowledge only AFTER the durable D1 batch; failure => LINE redelivery.
  return { accepted: true };
}
