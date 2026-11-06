// LINE Archive — self-contained Cloudflare Dashboard deployment bundle.
// Generated from src/ and public/. Contains no account credentials.

// src/http.js
var HttpError = class extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
};
function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers }
  });
}
function secure(response) {
  const headers = new Headers(response.headers);
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "no-referrer");
  headers.set("x-frame-options", "DENY");
  headers.set("content-security-policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
async function externalJson(url, init = {}) {
  const response = await fetch(url, { ...init, signal: init.signal ?? AbortSignal.timeout(1e4) });
  if (!response.ok) {
    const error = new Error(`External API ${new URL(url).hostname}: HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response.status === 204 ? {} : response.json();
}
function requireSameOrigin(request, env) {
  if (request.headers.get("origin") !== new URL(env.APP_URL).origin) {
    throw new HttpError(403, "คำขอไม่ได้มาจากหน้าเว็บนี้");
  }
}

// src/crypto.js
var encoder = new TextEncoder();
var utf8 = (value) => encoder.encode(value);
function base64(bytes) {
  return btoa(Array.from(new Uint8Array(bytes), (n) => String.fromCharCode(n)).join(""));
}
var base64url = (bytes) => base64(bytes).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
function unbase64(value) {
  return Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), (c) => c.charCodeAt(0));
}
async function hmacKey(secret) {
  return crypto.subtle.importKey("raw", utf8(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
async function signObject(value, secret) {
  const payload = base64url(utf8(JSON.stringify(value)));
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(secret), utf8(payload));
  return `${payload}.${base64url(signature)}`;
}
async function readObject(token, secret, now = Date.now()) {
  if (!token || !secret) return null;
  try {
    const parts = token.split(".");
    if (parts.length !== 2) return null;
    if (!await crypto.subtle.verify("HMAC", await hmacKey(secret), unbase64(parts[1]), utf8(parts[0]))) return null;
    const data = JSON.parse(new TextDecoder().decode(unbase64(parts[0])));
    return Number.isFinite(data.exp) && data.exp > now ? data : null;
  } catch {
    return null;
  }
}
async function encryptionKey(secret) {
  return crypto.subtle.importKey("raw", await crypto.subtle.digest("SHA-256", utf8(secret)), "AES-GCM", false, ["encrypt", "decrypt"]);
}
async function encrypt(value, secret) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const body = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await encryptionKey(secret), utf8(value));
  return `${base64url(iv)}.${base64url(body)}`;
}
async function decrypt(value, secret) {
  const [iv, body] = value.split(".");
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unbase64(iv) }, await encryptionKey(secret), unbase64(body)));
}

// src/store.js
var stmt = (env, sql, ...args) => {
  if (env._budget) env._budget.sql++;
  return env.DB.prepare(sql).bind(...args);
};
var one = (env, sql, ...args) => stmt(env, sql, ...args).first();
async function rows(env, sql, ...args) {
  return (await stmt(env, sql, ...args).all()).results;
}
var run = (env, sql, ...args) => stmt(env, sql, ...args).run();
async function setting(env, key) {
  return (await one(env, "SELECT value FROM settings WHERE key = ?", key))?.value ?? null;
}
var setSetting = (env, key, value) => run(
  env,
  "INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
  key,
  String(value)
);
async function acquireLease(env, name, ttl = 9e4) {
  const token = crypto.randomUUID();
  const now = Date.now();
  const result = await stmt(env, `INSERT INTO leases(name,token,expires_at_ms) VALUES (?,?,?)
    ON CONFLICT(name) DO UPDATE SET token=excluded.token, expires_at_ms=excluded.expires_at_ms
    WHERE leases.expires_at_ms < ? RETURNING token`, name, token, now + ttl, now).first();
  return result?.token === token ? token : null;
}
var releaseLease = (env, name, token) => run(env, "DELETE FROM leases WHERE name=? AND token=?", name, token);
async function stats(env) {
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
    pending: pending.count,
    failed: pending.failed || 0,
    oldest: pending.oldest,
    groups,
    errors,
    syncedEvents: Number(await setting(env, "synced_events") || 0),
    lastSyncAt: Number(await setting(env, "last_sync_at") || 0) || null,
    lastMaintenanceAt: Number(await setting(env, "last_maintenance_at") || 0) || null,
    indexSpreadsheetId: await setting(env, "index_spreadsheet_id"),
    workbooks: await rows(env, "SELECT month,spreadsheet_id FROM workbooks WHERE expired=0 ORDER BY month DESC LIMIT 14")
  };
}

// src/auth.js
var SCOPE = "openid email profile https://www.googleapis.com/auth/drive.file";
var accessCache = /* @__PURE__ */ new Map();
function configuration(env) {
  return {
    google: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.OWNER_EMAIL && !env.OWNER_EMAIL.startsWith("replace-") && env.SESSION_SECRET?.length >= 32 && env.TOKEN_ENCRYPTION_SECRET?.length >= 32),
    line: Boolean(env.LINE_CHANNEL_SECRET && env.LINE_CHANNEL_ACCESS_TOKEN)
  };
}
function cookieValue(request, name) {
  return request.headers.get("cookie")?.split(";").map((s) => s.trim()).find((s) => s.startsWith(`${name}=`))?.slice(name.length + 1);
}
function cookie(env, name, value, maxAge, path = "/") {
  return `${name}=${value}; Path=${path}; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${env.APP_URL.startsWith("https://") ? "; Secure" : ""}`;
}
async function ownerSession(request, env) {
  const session = await readObject(cookieValue(request, "archive_session"), env.SESSION_SECRET);
  return session?.purpose === "session" && session.email === env.OWNER_EMAIL?.toLowerCase() ? session : null;
}
async function requireOwner(request, env) {
  const session = await ownerSession(request, env);
  if (!session) throw new HttpError(401, "กรุณาเข้าสู่ระบบด้วยบัญชี Google เจ้าของ");
  return session;
}
async function startLogin(env) {
  if (!configuration(env).google) throw new HttpError(503, "ยังไม่ได้ตั้งค่า Google OAuth และบัญชีเจ้าของ ดูคู่มือตั้งค่าระบบ");
  const nonce = base64url(crypto.getRandomValues(new Uint8Array(24)));
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const state = await signObject({ purpose: "oauth", nonce, verifier, exp: Date.now() + 6e5 }, env.SESSION_SECRET);
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  const challenge = base64url(await crypto.subtle.digest("SHA-256", utf8(verifier)));
  url.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: `${env.APP_URL}/auth/callback`,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
    state: nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
    login_hint: env.OWNER_EMAIL
  }).toString();
  return new Response(null, { status: 302, headers: {
    location: url.toString(),
    "set-cookie": cookie(env, "archive_oauth", state, 600, "/auth"),
    "cache-control": "no-store"
  } });
}
async function finishLogin(request, env) {
  const url = new URL(request.url);
  const state = await readObject(cookieValue(request, "archive_oauth"), env.SESSION_SECRET);
  if (!state || state.purpose !== "oauth" || state.nonce !== url.searchParams.get("state")) {
    throw new HttpError(403, "การเข้าสู่ระบบหมดอายุหรือ state ไม่ตรง กรุณาเริ่มใหม่");
  }
  const code = url.searchParams.get("code");
  if (!code) throw new HttpError(400, "Google ไม่ได้ส่ง authorization code");
  const tokens = await externalJson("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${env.APP_URL}/auth/callback`,
      grant_type: "authorization_code",
      code_verifier: state.verifier
    })
  });
  const user = await externalJson("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { authorization: `Bearer ${tokens.access_token}` }
  });
  if (user.email_verified !== true || user.email?.toLowerCase() !== env.OWNER_EMAIL.toLowerCase()) {
    throw new HttpError(403, "บัญชีนี้ไม่ได้รับอนุญาตให้เข้าระบบ");
  }
  if (!tokens.scope?.split(" ").includes("https://www.googleapis.com/auth/drive.file")) {
    throw new HttpError(403, "ต้องอนุญาตสิทธิ์สร้างและจัดการไฟล์ของแอปเพื่อบันทึกข้อความ");
  }
  if (tokens.refresh_token) {
    await setSetting(env, "google_refresh_token", await encrypt(tokens.refresh_token, env.TOKEN_ENCRYPTION_SECRET));
  } else if (!await setting(env, "google_refresh_token")) {
    throw new HttpError(400, "ไม่ได้รับ refresh token กรุณายกเลิกสิทธิ์แอปใน Google แล้วเชื่อมต่อใหม่");
  }
  await setSetting(env, "google_owner_email", user.email.toLowerCase());
  accessCache.set(`${env.GOOGLE_CLIENT_ID}:${env.OWNER_EMAIL.toLowerCase()}`, { token: tokens.access_token, expires: Date.now() + (tokens.expires_in - 60) * 1e3 });
  const session = await signObject({ purpose: "session", email: user.email.toLowerCase(), exp: Date.now() + 8 * 36e5 }, env.SESSION_SECRET);
  const headers = new Headers({ location: "/", "cache-control": "no-store" });
  headers.append("set-cookie", cookie(env, "archive_session", session, 8 * 3600));
  headers.append("set-cookie", cookie(env, "archive_oauth", "", 0, "/auth"));
  return new Response(null, { status: 302, headers });
}
function logout(env) {
  return new Response(null, { status: 204, headers: { "set-cookie": cookie(env, "archive_session", "", 0), "cache-control": "no-store" } });
}
async function googleToken(env) {
  const cacheKey = `${env.GOOGLE_CLIENT_ID}:${env.OWNER_EMAIL?.toLowerCase()}`;
  const cached = accessCache.get(cacheKey);
  if (cached?.expires > Date.now()) return cached.token;
  if (await setting(env, "google_owner_email") !== env.OWNER_EMAIL?.toLowerCase()) {
    throw new Error("บัญชีเจ้าของเปลี่ยน กรุณาเชื่อมต่อ Google ใหม่");
  }
  const stored = await setting(env, "google_refresh_token");
  if (!stored) throw new Error("ยังไม่ได้เชื่อมต่อ Google กรุณาเข้าสู่ระบบครั้งแรก");
  const refresh = await decrypt(stored, env.TOKEN_ENCRYPTION_SECRET);
  const result = await externalJson("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: refresh,
      grant_type: "refresh_token"
    })
  });
  accessCache.set(cacheKey, { token: result.access_token, expires: Date.now() + (result.expires_in - 60) * 1e3 });
  return result.access_token;
}

// src/line.js
async function validLineSignature(raw, signature, secret) {
  if (!signature || !secret) return false;
  try {
    return await crypto.subtle.verify("HMAC", await hmacKey(secret), unbase64(signature), utf8(raw));
  } catch {
    return false;
  }
}
function normalizeEvent(event, now = Date.now()) {
  if (!event || typeof event !== "object") return null;
  if (event.source?.type !== "group" || typeof event.source.groupId !== "string") return null;
  const base = { groupId: event.source.groupId, senderId: event.source.userId ?? null, now };
  if (["join", "leave"].includes(event.type)) return { ...base, type: event.type };
  let type;
  let messageId;
  let text = null;
  if (["message", "messageEdited"].includes(event.type) && event.message?.type === "text") {
    type = event.type === "message" ? "received" : "edited";
    messageId = event.message.id;
    text = event.message.text;
    if (typeof text !== "string" || text.length > 3e4) return null;
  } else if (event.type === "unsend") {
    type = "unsent";
    messageId = event.unsend?.messageId;
  } else return null;
  if (!event.webhookEventId || typeof messageId !== "string" || !Number.isSafeInteger(event.timestamp) || event.timestamp < 0) return null;
  return {
    ...base,
    type,
    messageId,
    text,
    eventId: event.webhookEventId,
    timestamp: event.timestamp,
    repliedTo: event.message?.quotedMessageId ?? null
  };
}
async function lineGet(env, path) {
  return externalJson(`https://api.line.me/v2/bot/${path}`, {
    headers: { authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}` },
    signal: AbortSignal.timeout(2500)
  });
}
async function groupName(env, groupId) {
  const existing = await one(env, "SELECT * FROM chat_groups WHERE group_id=?", groupId);
  if (existing?.display_name && existing.updated_at_ms > Date.now() - 864e5) return existing.display_name;
  try {
    return (await lineGet(env, `group/${encodeURIComponent(groupId)}/summary`)).groupName ?? existing?.display_name ?? null;
  } catch {
    return existing?.display_name ?? null;
  }
}
async function senderName(env, event) {
  if (!event.senderId) return null;
  const cached = await one(env, "SELECT * FROM member_profiles WHERE group_id=? AND sender_id=?", event.groupId, event.senderId);
  if (cached?.expires_at_ms > Date.now()) return cached.display_name;
  let name = cached?.display_name ?? null;
  try {
    name = (await lineGet(env, `group/${encodeURIComponent(event.groupId)}/member/${encodeURIComponent(event.senderId)}`)).displayName ?? name;
  } catch {
  }
  await run(
    env,
    `INSERT INTO member_profiles VALUES (?,?,?,?) ON CONFLICT(group_id,sender_id)
    DO UPDATE SET display_name=excluded.display_name,expires_at_ms=excluded.expires_at_ms`,
    event.groupId,
    event.senderId,
    name,
    Date.now() + (name ? 864e5 : 36e5)
  );
  return name;
}
async function enrichOriginal(env, original) {
  if (!original || original.sender_display_name || !original.sender_id) return original;
  const name = await senderName(env, { groupId: original.group_id, senderId: original.sender_id });
  if (name) {
    await run(
      env,
      "UPDATE messages SET sender_display_name=? WHERE group_id=? AND message_id=? AND sender_display_name IS NULL",
      name,
      original.group_id,
      original.message_id
    );
    return { ...original, sender_display_name: name };
  }
  return original;
}
async function ingestLargeBatch(env, events) {
  const statements = [];
  const groups = /* @__PURE__ */ new Map();
  for (const event of events) groups.set(event.groupId, event);
  const groupList = [...groups.values()];
  for (let i = 0; i < groupList.length; i += 20) {
    const chunk = groupList.slice(i, i + 20);
    statements.push(stmt(
      env,
      `INSERT INTO chat_groups(group_id,active,updated_at_ms) VALUES
      ${chunk.map(() => "(?,?,?)").join(",")} ON CONFLICT(group_id) DO UPDATE SET
      active=excluded.active,updated_at_ms=excluded.updated_at_ms`,
      ...chunk.flatMap((e) => [e.groupId, e.type === "leave" ? 0 : 1, e.now])
    ));
  }
  const messages = events.filter((e) => e.type === "received");
  for (let i = 0; i < messages.length; i += 12) {
    const chunk = messages.slice(i, i + 12);
    statements.push(stmt(
      env,
      `INSERT INTO messages
      (group_id,message_id,sender_id,sent_at_ms,received_at_ms,original_text,replied_to_message_id)
      VALUES ${chunk.map(() => "(?,?,?,?,?,?,?)").join(",")}
      ON CONFLICT(group_id,message_id) DO NOTHING`,
      ...chunk.flatMap((e) => [e.groupId, e.messageId, e.senderId, e.timestamp, e.now, e.text, e.repliedTo])
    ));
  }
  const content = events.filter((e) => !["join", "leave"].includes(e.type));
  for (let i = 0; i < content.length; i += 12) {
    const chunk = content.slice(i, i + 12);
    statements.push(stmt(
      env,
      `INSERT INTO message_events
      (webhook_event_id,group_id,message_id,event_type,event_at_ms,received_at_ms,text)
      VALUES ${chunk.map(() => "(?,?,?,?,?,?,?)").join(",")} ON CONFLICT(webhook_event_id) DO NOTHING`,
      ...chunk.flatMap((e) => [e.eventId, e.groupId, e.messageId, e.type, e.timestamp, e.now, e.text])
    ));
  }
  if (statements.length) await env.DB.batch(statements);
}
async function ingest(env, event) {
  if (event.type === "leave") {
    await run(env, "UPDATE chat_groups SET active=0,updated_at_ms=? WHERE group_id=?", event.now, event.groupId);
    return false;
  }
  const group = await one(env, "SELECT * FROM chat_groups WHERE group_id=?", event.groupId);
  if (!group || event.type === "join") {
    await run(
      env,
      `INSERT INTO chat_groups VALUES (?,?,1,?) ON CONFLICT(group_id)
      DO UPDATE SET display_name=COALESCE(excluded.display_name,chat_groups.display_name),active=1,updated_at_ms=excluded.updated_at_ms`,
      event.groupId,
      await groupName(env, event.groupId),
      event.now
    );
  }
  if (event.type === "join") return false;
  const duplicate = await one(env, "SELECT webhook_event_id FROM message_events WHERE webhook_event_id=?", event.eventId);
  if (duplicate) return false;
  const statements = [];
  if (event.type === "received") {
    const name = await senderName(env, event);
    statements.push(stmt(
      env,
      `INSERT INTO messages
      (group_id,message_id,sender_id,sender_display_name,sent_at_ms,received_at_ms,original_text,replied_to_message_id)
      VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(group_id,message_id) DO NOTHING`,
      event.groupId,
      event.messageId,
      event.senderId,
      name,
      event.timestamp,
      event.now,
      event.text,
      event.repliedTo
    ));
  }
  statements.push(stmt(
    env,
    `INSERT INTO message_events
    (webhook_event_id,group_id,message_id,event_type,event_at_ms,received_at_ms,text)
    VALUES (?,?,?,?,?,?,?) ON CONFLICT(webhook_event_id) DO NOTHING`,
    event.eventId,
    event.groupId,
    event.messageId,
    event.type,
    event.timestamp,
    event.now,
    event.text
  ));
  await env.DB.batch(statements);
  return true;
}
async function webhook(request, env) {
  if (!env.LINE_CHANNEL_SECRET) throw new HttpError(503, "ยังไม่ได้ตั้งค่า LINE");
  if (Number(request.headers.get("content-length") || 0) > 1e6) throw new HttpError(413, "Webhook ใหญ่เกินกำหนด");
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "ไม่มี webhook body");
  let size = 0;
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 1e6) {
      await reader.cancel();
      throw new HttpError(413, "Webhook ใหญ่เกินกำหนด");
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const raw = new TextDecoder("utf-8", { fatal: true }).decode(body);
  if (!await validLineSignature(raw, request.headers.get("x-line-signature"), env.LINE_CHANNEL_SECRET)) {
    throw new HttpError(401, "ลายเซ็น LINE ไม่ถูกต้อง");
  }
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new HttpError(400, "JSON ไม่ถูกต้อง");
  }
  if (!Array.isArray(payload.events) || payload.events.length > 100) throw new HttpError(400, "รูปแบบ events ไม่ถูกต้อง");
  const cutoff = Date.now() - Number(env.RETENTION_DAYS || 365) * 864e5;
  const events = payload.events.map((e) => normalizeEvent(e)).filter((e) => e && !(e.type === "received" && e.timestamp < cutoff));
  if (events.length > 3) await ingestLargeBatch(env, events);
  else for (const event of events) await ingest(env, event);
  return { accepted: true };
}

// src/projection.js
var MESSAGE_HEADERS = [
  "group_id",
  "message_id",
  "sender_id",
  "sender_display_name",
  "sent_at_ms",
  "sent_at_thai",
  "timezone",
  "original_text",
  "current_text",
  "replied_to_message_id",
  "message_status",
  "edited_at_ms",
  "unsent_at_ms",
  "version_count",
  "latest_edit_event_id"
];
var HISTORY_HEADERS = [
  "webhook_event_id",
  "group_id",
  "message_id",
  "event_type",
  "event_at_ms",
  "event_at_thai",
  "timezone",
  "text",
  "original_sent_at_ms"
];
function thaiTime(ms) {
  return new Date(Number(ms) + 7 * 36e5).toISOString().replace("Z", "+07:00");
}
var thaiMonth = (ms) => thaiTime(ms).slice(0, 7);
var toRow = (record, headers) => headers.map((key) => record[key] ?? "");
function fromRow(row, headers = MESSAGE_HEADERS) {
  if (!row?.[1]) return null;
  return Object.fromEntries(headers.map((key, i) => [key, row[i] ?? ""]));
}
function projectMessage(previous, original, event) {
  if (!previous && !original) return null;
  const record = previous ? { ...previous } : {
    ...original,
    current_text: original.original_text,
    message_status: "active",
    edited_at_ms: "",
    unsent_at_ms: "",
    version_count: 1,
    latest_edit_event_id: ""
  };
  record.sent_at_thai = thaiTime(record.sent_at_ms);
  record.timezone = "Asia/Bangkok";
  if (event.event_type === "edited") {
    record.version_count = Number(record.version_count) + 1;
    const previousTime = record.edited_at_ms === "" ? -1 : Number(record.edited_at_ms);
    if (event.event_at_ms > previousTime || event.event_at_ms === previousTime && event.webhook_event_id > record.latest_edit_event_id) {
      record.current_text = event.text;
      record.edited_at_ms = event.event_at_ms;
      record.latest_edit_event_id = event.webhook_event_id;
    }
    if (record.message_status !== "unsent") record.message_status = "edited";
  }
  if (event.event_type === "unsent") {
    record.message_status = "unsent";
    record.unsent_at_ms = Math.max(Number(record.unsent_at_ms || 0), event.event_at_ms);
  }
  return record;
}

// src/sheets.js
var ROOT = "https://sheets.googleapis.com/v4/spreadsheets";
var DRIVE = "https://www.googleapis.com/drive/v3/files";
var wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
var quote = (title) => `'${title.replaceAll("'", "''")}'`;
var qEscape = (value) => value.replaceAll("\\", "\\\\").replaceAll("'", "\\'");
var GoogleSheets = class {
  constructor(env, leaseToken) {
    this.env = env;
    this.leaseToken = leaseToken;
  }
  async api(url, method = "GET", body) {
    if (this.env._budget?.sql >= 34) {
      throw new Error("แบ่งงานต่อรอบถัดไปเพื่อรักษาโควตา Cloudflare Free");
    }
    if (method !== "GET") {
      if (this.leaseToken) {
        const now = Date.now();
        const lease = await one(this.env, `UPDATE leases SET expires_at_ms=?
          WHERE name='sheets' AND token=? AND expires_at_ms>? RETURNING token`, now + 9e4, this.leaseToken, now);
        if (!lease) throw new Error("หมดสิทธิ์การเขียนรอบนี้ ระบบจะลองใหม่");
      }
      const next = Number(await setting(this.env, "next_google_write_at") || 0);
      await wait(Math.max(0, Math.min(1500, next - Date.now())));
      await setSetting(this.env, "next_google_write_at", Date.now() + 1300);
    }
    const token = await googleToken(this.env);
    return externalJson(url, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      ...body === void 0 ? {} : { body: JSON.stringify(body) }
    });
  }
  async values(id, range) {
    return (await this.api(`${ROOT}/${id}/values/${encodeURIComponent(range)}`)).values || [];
  }
  async batch(id, requests) {
    return this.api(`${ROOT}/${id}:batchUpdate`, "POST", { requests });
  }
  cellRequest(target, row, values) {
    return { updateCells: {
      start: { sheetId: target.sheet_id, rowIndex: row - 1, columnIndex: 0 },
      rows: [{ values: values.map((value) => ({ userEnteredValue: typeof value === "number" ? { numberValue: value } : { stringValue: String(value ?? "") } })) }],
      fields: "userEnteredValue"
    } };
  }
  async findFile(key, mimeType = "application/vnd.google-apps.spreadsheet") {
    const namespace = this.env.ARCHIVE_NAMESPACE || new URL(this.env.APP_URL).origin;
    const q = `trashed=false and mimeType='${mimeType}' and appProperties has { key='archiveKey' and value='${qEscape(key)}' } and appProperties has { key='archiveNamespace' and value='${qEscape(namespace)}' }`;
    const response = await this.api(`${DRIVE}?${new URLSearchParams({ q, fields: "files(id,name)", pageSize: "10" })}`);
    return response.files?.[0]?.id;
  }
  async file(key, title, mimeType = "application/vnd.google-apps.spreadsheet", parent) {
    return await this.findFile(key, mimeType) || (await this.api(DRIVE, "POST", {
      name: title,
      mimeType,
      appProperties: { archiveKey: key, archiveNamespace: this.env.ARCHIVE_NAMESPACE || new URL(this.env.APP_URL).origin },
      ...parent ? { parents: [parent] } : {}
    })).id;
  }
  async index() {
    let id = await setting(this.env, "index_spreadsheet_id");
    if (id) return id;
    const folder = await this.file("line-archive-folder", "LINE Archive", "application/vnd.google-apps.folder");
    await setSetting(this.env, "folder_id", folder);
    id = await this.file("line-archive-index", "LINE Archive — สารบัญ", void 0, folder);
    const meta = await this.api(`${ROOT}/${id}?fields=sheets(properties)`);
    const first = meta.sheets?.[0]?.properties || { sheetId: 0, title: "สารบัญ" };
    await this.batch(id, [
      ...meta.sheets?.length ? [] : [{ addSheet: { properties: first } }],
      this.cellRequest({ sheet_id: first.sheetId }, 1, ["เดือน", "ลิงก์ Google Sheets", "เขตเวลา"])
    ]);
    await setSetting(this.env, "index_sheet_title", first.title);
    await setSetting(this.env, "index_spreadsheet_id", id);
    return id;
  }
  async workbook(month) {
    const existing = await one(this.env, "SELECT * FROM workbooks WHERE month=?", month);
    if (existing && !existing.expired) return existing.spreadsheet_id;
    if (existing?.expired) throw new Error("ข้อมูลเดือนนี้พ้นระยะเก็บแล้ว");
    const indexId = await this.index();
    const folder = await setting(this.env, "folder_id");
    const id = await this.file(`line-archive-${month}`, `LINE Archive ${month}`, void 0, folder);
    const title = await setting(this.env, "index_sheet_title");
    const current = await this.values(indexId, `${quote(title)}!A:C`);
    const position = current.findIndex((r) => r[0] === month);
    const meta = await this.api(`${ROOT}/${indexId}?fields=sheets(properties)`);
    const sheet = meta.sheets.find((s) => s.properties.title === title).properties;
    await this.batch(indexId, [this.cellRequest(
      { sheet_id: sheet.sheetId },
      position >= 0 ? position + 1 : Math.max(2, current.length + 1),
      [month, `https://docs.google.com/spreadsheets/d/${id}`, "Asia/Bangkok"]
    )]);
    await run(this.env, "INSERT INTO workbooks(month,spreadsheet_id,created_at_ms) VALUES (?,?,?) ON CONFLICT(month) DO NOTHING", month, id, Date.now());
    return id;
  }
  async target(month, groupId, kind) {
    const existing = await one(this.env, "SELECT * FROM sheet_targets WHERE month=? AND group_id=? AND kind=?", month, groupId, kind);
    if (existing) return existing;
    const id = await this.workbook(month);
    const group = await one(this.env, "SELECT display_name FROM chat_groups WHERE group_id=?", groupId);
    const name = (group?.display_name || "กลุ่ม").replace(/[\[\]:*?/\\]/g, " ").slice(0, 25);
    const title = `${kind === "history" ? "ประวัติ " : ""}${name} · ${groupId}`.slice(0, 100);
    const meta = await this.api(`${ROOT}/${id}?fields=sheets(properties)`);
    let sheet = (meta.sheets || []).find((s) => s.properties.title === title)?.properties;
    const headers = kind === "messages" ? MESSAGE_HEADERS : HISTORY_HEADERS;
    if (!sheet) {
      const used = new Set((meta.sheets || []).map((s) => s.properties.sheetId));
      let sheetId = 1;
      for (const c of `${groupId}/${kind}`) sheetId = Math.imul(sheetId, 31) + c.charCodeAt(0) >>> 1;
      while (used.has(sheetId)) sheetId += 1;
      sheet = { sheetId, title, gridProperties: { rowCount: 100, columnCount: headers.length, frozenRowCount: 1 } };
      await this.batch(id, [{ addSheet: { properties: sheet } }, this.cellRequest({ sheet_id: sheetId }, 1, headers), {
        repeatCell: {
          range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
          cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.85, green: 0.94, blue: 0.9 } } },
          fields: "userEnteredFormat"
        }
      }]);
    } else {
      await this.batch(id, [this.cellRequest({ sheet_id: sheet.sheetId }, 1, headers)]);
    }
    await run(
      this.env,
      `INSERT INTO sheet_targets(month,group_id,kind,sheet_id,title,capacity)
      VALUES (?,?,?,?,?,?) ON CONFLICT(month,group_id,kind) DO NOTHING`,
      month,
      groupId,
      kind,
      sheet.sheetId,
      title,
      sheet.gridProperties.rowCount
    );
    return one(this.env, "SELECT * FROM sheet_targets WHERE month=? AND group_id=? AND kind=?", month, groupId, kind);
  }
  async mapped(groupId, kind, referenceId) {
    return one(this.env, "SELECT * FROM sheet_rows WHERE group_id=? AND kind=? AND reference_id=?", groupId, kind, referenceId);
  }
  async remember(target, referenceId, rowNumber) {
    await run(
      this.env,
      `INSERT INTO sheet_rows(group_id,kind,reference_id,month,row_number,recorded_at_ms)
      VALUES (?,?,?,?,?,?) ON CONFLICT(group_id,kind,reference_id) DO NOTHING`,
      target.group_id,
      target.kind,
      referenceId,
      target.month,
      rowNumber,
      Date.now()
    );
    return this.mapped(target.group_id, target.kind, referenceId);
  }
  async allocate(target, referenceId) {
    const existing = await this.mapped(target.group_id, target.kind, referenceId);
    if (existing) return { ...existing, fresh: false };
    await this.env.DB.batch([
      stmt(
        this.env,
        `INSERT INTO sheet_rows(group_id,kind,reference_id,month,row_number,recorded_at_ms)
        SELECT group_id,kind,?,month,next_row,? FROM sheet_targets WHERE month=? AND group_id=? AND kind=?`,
        referenceId,
        Date.now(),
        target.month,
        target.group_id,
        target.kind
      ),
      stmt(this.env, "UPDATE sheet_targets SET next_row=next_row+1 WHERE month=? AND group_id=? AND kind=?", target.month, target.group_id, target.kind)
    ]);
    return { ...await this.mapped(target.group_id, target.kind, referenceId), fresh: true };
  }
  async findMessage(groupId, messageId, month) {
    const targets = await rows(this.env, `SELECT t.*, w.spreadsheet_id FROM sheet_targets t JOIN workbooks w ON w.month=t.month
      WHERE t.group_id=? AND t.kind='messages' AND w.expired=0 ${month ? "AND t.month=?" : ""}
      ORDER BY t.month DESC LIMIT 14`, ...[groupId, ...month ? [month] : []]);
    for (const target of targets) {
      const ids = await this.values(target.spreadsheet_id, `${quote(target.title)}!B2:B${Math.max(2, target.next_row - 1)}`);
      const index = ids.findIndex((r) => r[0] === messageId);
      if (index >= 0) return this.remember(target, messageId, index + 2);
    }
    return null;
  }
  async existingHistory(target, event) {
    const cached = await this.mapped(event.group_id, "history", event.webhook_event_id);
    if (cached) return { ...cached, fresh: false };
    if (event.event_at_ms < Date.now() - Number(this.env.CACHE_DAYS || 7) * 864e5) {
      const book = await one(this.env, "SELECT spreadsheet_id FROM workbooks WHERE month=?", target.month);
      const ids = await this.values(book.spreadsheet_id, `${quote(target.title)}!A2:A${Math.max(2, target.next_row - 1)}`);
      const index = ids.findIndex((r) => r[0] === event.webhook_event_id);
      if (index >= 0) return { ...await this.remember(target, event.webhook_event_id, index + 2), fresh: false };
    }
    return this.allocate(target, event.webhook_event_id);
  }
  async writeEvent(event) {
    const original = await enrichOriginal(this.env, await one(this.env, "SELECT * FROM messages WHERE group_id=? AND message_id=?", event.group_id, event.message_id));
    let location = await this.mapped(event.group_id, "messages", event.message_id);
    if (!location && (!original || original.sent_at_ms < Date.now() - Number(this.env.CACHE_DAYS || 7) * 864e5)) {
      location = await this.findMessage(event.group_id, event.message_id, original ? thaiMonth(original.sent_at_ms) : null);
    }
    if (!location && !original) throw new Error("รอข้อความต้นฉบับจาก LINE หรือไม่พบข้อความในชีต");
    const month = location?.month || thaiMonth(original.sent_at_ms);
    const bookId = await this.workbook(month);
    const currentTarget = await this.target(month, event.group_id, "messages");
    const historyTarget = await this.target(month, event.group_id, "history");
    if (!location) location = await this.allocate(currentTarget, event.message_id);
    const historyLocation = await this.existingHistory(historyTarget, event);
    const expansions = [[currentTarget, location], [historyTarget, historyLocation]].filter(([target, mapped]) => mapped.row_number > target.capacity);
    if (expansions.length) {
      await this.batch(bookId, expansions.map(([target, mapped]) => ({ updateSheetProperties: {
        properties: { sheetId: target.sheet_id, gridProperties: { rowCount: Math.ceil(mapped.row_number / 100) * 100 } },
        fields: "gridProperties.rowCount"
      } })));
      for (const [target, mapped] of expansions) {
        target.capacity = Math.ceil(mapped.row_number / 100) * 100;
        await run(
          this.env,
          "UPDATE sheet_targets SET capacity=? WHERE month=? AND group_id=? AND kind=?",
          target.capacity,
          target.month,
          target.group_id,
          target.kind
        );
      }
    }
    if (!historyLocation.fresh) {
      const history = await this.values(bookId, `${quote(historyTarget.title)}!A${historyLocation.row_number}:A${historyLocation.row_number}`);
      if (history[0]?.[0] === event.webhook_event_id) return;
    }
    const previous = location.fresh ? null : fromRow((await this.values(
      bookId,
      `${quote(currentTarget.title)}!A${location.row_number}:O${location.row_number}`
    ))[0]);
    const record = projectMessage(previous, original, event);
    if (!record) throw new Error("ไม่พบข้อความต้นฉบับสำหรับอัปเดตชีต");
    const cutoff = Date.now() - Number(this.env.RETENTION_DAYS || 365) * 864e5;
    if (Number(record.sent_at_ms) < cutoff) return;
    const requests = [];
    requests.push(this.cellRequest(currentTarget, location.row_number, toRow(record, MESSAGE_HEADERS)));
    requests.push(this.cellRequest(historyTarget, historyLocation.row_number, toRow({
      ...event,
      event_at_thai: thaiTime(event.event_at_ms),
      timezone: "Asia/Bangkok",
      original_sent_at_ms: Number(record.sent_at_ms)
    }, HISTORY_HEADERS)));
    await this.batch(bookId, requests);
  }
};

// src/sync.js
async function drain(env, options = {}) {
  if (!await setting(env, "google_refresh_token")) return { processed: 0, waitingForGoogle: true };
  const token = await acquireLease(env, "sheets");
  if (!token) return { processed: 0, busy: true };
  const deadline = Date.now() + 22e3;
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
          await sheets.target(month, group.group_id, "messages");
          await sheets.target(month, group.group_id, "history");
          await setSetting(env, "setup_error", "");
        } catch (error) {
          await setSetting(env, "setup_error", error.message.slice(0, 240));
        }
      }
    }
    for (const event of events) {
      if (Date.now() >= deadline) break;
      try {
        await sheets.writeEvent(event);
        const now = Date.now();
        await run(env, "UPDATE message_events SET sheets_synced_at_ms=?,last_error=NULL WHERE webhook_event_id=?", now, event.webhook_event_id);
        await setSetting(env, "last_sync_at", now);
        await run(env, `INSERT INTO settings(key,value) VALUES ('synced_events','1')
          ON CONFLICT(key) DO UPDATE SET value=CAST(CAST(value AS INTEGER)+1 AS TEXT)`);
        processed++;
      } catch (error) {
        const attempts = event.attempts + 1;
        const delay = Math.min(36e5, 15e3 * 2 ** Math.min(attempts, 8));
        await run(
          env,
          `UPDATE message_events SET attempts=?,last_error=?,next_attempt_at_ms=? WHERE webhook_event_id=?`,
          attempts,
          error.message.slice(0, 240),
          Date.now() + delay,
          event.webhook_event_id
        );
        if ([401, 403, 429].includes(error.status)) break;
      }
    }
    return { processed };
  } finally {
    await releaseLease(env, "sheets", token);
  }
}

// src/maintenance.js
async function maintain(env, options = {}) {
  if (!await setting(env, "google_refresh_token")) return;
  const lock = await acquireLease(env, "sheets");
  if (!lock) return;
  try {
    const now = Date.now();
    const cutoff = now - Number(env.RETENTION_DAYS || 365) * 864e5;
    const cacheCutoff = now - Number(env.CACHE_DAYS || 7) * 864e5;
    const google = options.google || new GoogleSheets(env, lock);
    const expired = await one(env, "SELECT * FROM workbooks WHERE expired=0 AND month < ? ORDER BY month LIMIT 1", thaiMonth(cutoff));
    if (expired) {
      await google.api(`https://www.googleapis.com/drive/v3/files/${expired.spreadsheet_id}`, "PATCH", { trashed: true });
      const index = await setting(env, "index_spreadsheet_id");
      const title = await setting(env, "index_sheet_title");
      if (index && title) {
        const records = await google.values(index, `'${title.replaceAll("'", "''")}'!A:C`);
        const position = records.findIndex((r) => r[0] === expired.month);
        if (position >= 0) {
          const meta = await google.api(`https://sheets.googleapis.com/v4/spreadsheets/${index}?fields=sheets(properties)`);
          const target = meta.sheets.find((s) => s.properties.title === title).properties;
          await google.batch(index, [google.cellRequest({ sheet_id: target.sheetId }, position + 1, [expired.month, "หมดอายุ — ย้ายไปถังขยะแล้ว", "Asia/Bangkok"])]);
        }
      }
      await run(env, "UPDATE workbooks SET expired=1 WHERE month=?", expired.month);
    } else {
      const targets = await rows(env, `SELECT t.*,w.spreadsheet_id FROM sheet_targets t JOIN workbooks w ON w.month=t.month
        WHERE t.month=? AND w.expired=0 ORDER BY t.group_id,t.kind`, thaiMonth(cutoff));
      if (targets.length) {
        let cursor = JSON.parse(await setting(env, "retention_cursor") || '{"target":0,"row":2}');
        if (cursor.month !== thaiMonth(cutoff)) cursor = { target: 0, row: 2, month: thaiMonth(cutoff) };
        const target = targets[cursor.target % targets.length];
        const end = Math.min(target.next_row - 1, cursor.row + 399);
        if (end >= cursor.row) {
          const column = target.kind === "messages" ? "E" : "I";
          const dates = await google.values(
            target.spreadsheet_id,
            `'${target.title.replaceAll("'", "''")}'!${column}${cursor.row}:${column}${end}`
          );
          const expiredRows = dates.flatMap((r, i) => r[0] !== "" && r[0] != null && Number(r[0]) < cutoff ? [cursor.row + i] : []);
          const ranges = [];
          for (const row of expiredRows) {
            const last = ranges.at(-1);
            if (last && last.endRowIndex === row - 1) last.endRowIndex = row;
            else ranges.push({ sheetId: target.sheet_id, startRowIndex: row - 1, endRowIndex: row });
          }
          if (ranges.length) await google.batch(target.spreadsheet_id, ranges.map((range) => ({
            repeatCell: { range, cell: {}, fields: "userEnteredValue,note" }
          })));
        }
        cursor.row = end + 1;
        if (cursor.row >= target.next_row) {
          cursor.row = 2;
          cursor.target = (cursor.target + 1) % targets.length;
        }
        await setSetting(env, "retention_cursor", JSON.stringify(cursor));
      }
    }
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
    await setSetting(env, "last_maintenance_at", now);
    await setSetting(env, "maintenance_error", "");
  } catch (error) {
    await setSetting(env, "maintenance_error", error.message.slice(0, 240));
  } finally {
    await releaseLease(env, "sheets", lock);
  }
}

// src/worker.js
async function wakeSync(env) {
  if (!env.SESSION_SECRET || !await setting(env, "google_refresh_token")) return;
  const token = await signObject({ purpose: "internal-drain", exp: Date.now() + 35e3 }, env.SESSION_SECRET);
  const response = await fetch(`${env.APP_URL}/api/internal/drain`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(24e3)
  });
  if (!response.ok) throw new Error("sync_dispatch_failed");
  await response.arrayBuffer();
}
async function route(request, env, ctx) {
  const url = new URL(request.url);
  if (url.pathname === "/webhooks/line" && request.method === "POST") {
    const result = await webhook(request, env);
    ctx.waitUntil(wakeSync(env).catch(() => console.error("sync_dispatch_failed")));
    return json(result);
  }
  if (url.pathname === "/auth/google" && request.method === "GET") return startLogin(env);
  if (url.pathname === "/auth/callback" && request.method === "GET") return finishLogin(request, env);
  if (url.pathname === "/api/internal/drain" && request.method === "POST") {
    const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
    const signed = await readObject(token, env.SESSION_SECRET);
    if (signed?.purpose !== "internal-drain") throw new HttpError(401, "Unauthorized");
    return json(await drain(env));
  }
  if (url.pathname === "/api/status" && request.method === "GET") {
    const session = await ownerSession(request, env);
    if (!session) return json({ authenticated: false, configuration: configuration(env) });
    return json({
      authenticated: true,
      email: session.email,
      configuration: configuration(env),
      googleConnected: Boolean(await setting(env, "google_refresh_token")),
      maintenanceError: await setting(env, "maintenance_error"),
      setupError: await setting(env, "setup_error"),
      ...await stats(env)
    });
  }
  if (url.pathname === "/api/retry" && request.method === "POST") {
    await requireOwner(request, env);
    requireSameOrigin(request, env);
    await run(env, "UPDATE message_events SET next_attempt_at_ms=0 WHERE sheets_synced_at_ms IS NULL");
    ctx.waitUntil(wakeSync(env).catch(() => console.error("sync_dispatch_failed")));
    return json({ queued: true }, 202);
  }
  if (url.pathname === "/auth/logout" && request.method === "POST") {
    await requireOwner(request, env);
    requireSameOrigin(request, env);
    return logout(env);
  }
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/") || url.pathname.startsWith("/webhooks/")) {
    throw new HttpError(404, "ไม่พบเส้นทางนี้");
  }
  return env.ASSETS.fetch(request);
}
var worker_default = {
  async fetch(request, env, ctx) {
    env = { ...env, _budget: { sql: 0 } };
    try {
      return secure(await route(request, env, ctx));
    } catch (error) {
      if (!(error instanceof HttpError)) {
        console.error(JSON.stringify({ type: "request_failed", path: new URL(request.url).pathname }));
      }
      return secure(json({ error: error instanceof HttpError ? error.message : "ระบบทำงานไม่สำเร็จ กรุณาลองใหม่" }, error.status && error instanceof HttpError ? error.status : 500));
    }
  },
  async scheduled(_controller, env, ctx) {
    env = { ...env, _budget: { sql: 0 } };
    ctx.waitUntil((async () => {
      if (!env.SESSION_SECRET || !await setting(env, "google_refresh_token")) return;
      const end = Date.now() + 24e3;
      for (let i = 0; i < 6 && Date.now() < end; i++) {
        const token = await signObject({ purpose: "internal-drain", exp: Date.now() + 35e3 }, env.SESSION_SECRET);
        const response = await fetch(`${env.APP_URL}/api/internal/drain`, {
          method: "POST",
          headers: { authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(24e3)
        });
        if (!response.ok) break;
        const result = await response.json();
        if (!result.processed || result.busy) break;
      }
      await maintain(env);
    })().catch(() => console.error("scheduled_job_failed")));
  }
};

// archive:archive-static-assets
var archive_static_assets_default = { "/index.html": { "body": '<!doctype html>\n<html lang="th">\n<head>\n  <meta charset="UTF-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  <meta name="theme-color" content="#101f1b">\n  <title>LINE Archive — บันทึกทุกบทสนทนา</title>\n  <link rel="stylesheet" href="/styles.css">\n  <script type="module" src="/app.js"><\/script>\n</head>\n<body>\n  <div class="shell">\n    <aside class="sidebar">\n      <a class="brand" href="/" aria-label="LINE Archive หน้าหลัก"><span class="brand-icon">L<span>↗</span></span><span>LINE <strong>Archive</strong><small>YOUR CONVERSATION LIBRARY</small></span></a>\n      <div class="workspace-label">พื้นที่ส่วนตัว</div>\n      <a href="#overview" class="nav-item active"><span aria-hidden="true">▦</span> ภาพรวม</a>\n      <a href="#groups" class="nav-item"><span aria-hidden="true">◉</span> กลุ่มสนทนา</a>\n      <a href="#workbooks" class="nav-item"><span aria-hidden="true">▤</span> คลัง Google Sheets</a>\n      <div class="sidebar-note"><span class="small-dot"></span><strong>ข้อความที่ค้นกลับมาได้</strong><p>เก็บบทสนทนาอย่างเป็นระเบียบ<br>พร้อมสำหรับการวิเคราะห์</p></div>\n      <div class="sidebar-bottom"><span class="avatar">P</span><div><strong>Personal workspace</strong><small>Cloudflare · Google Sheets</small></div></div>\n    </aside>\n    <main id="overview">\n      <header class="topbar"><div><span class="breadcrumb">พื้นที่ทำงาน</span><span class="slash">/</span><span>ภาพรวม</span></div><div class="topbar-right"><span class="time-label">เวลาประเทศไทย · UTC+7</span><a id="reconnect" href="/auth/google" class="text-button" hidden>เชื่อมต่อ Google ใหม่</a><button id="logout" class="text-button" hidden>ออกจากระบบ</button></div></header>\n      <section class="page-heading"><div><div class="eyebrow">CONVERSATION INTELLIGENCE</div><h1>ทุกบทสนทนา อยู่ในที่เดียว</h1><p>บันทึกข้อความจากกลุ่ม LINE ลง Google Sheets พร้อมค้นต่อได้เสมอ</p></div><span class="live-badge" id="connection-badge"><span class="small-dot"></span> กำลังตรวจสอบระบบ</span></section>\n      <div id="notice" class="notice" role="status" aria-live="polite" hidden></div>\n      <section id="login-panel" class="login-panel" hidden>\n        <div class="login-symbol">↗</div><div><div class="eyebrow">OWNER ACCESS</div><h2>เข้าสู่พื้นที่ของคุณ</h2><p id="login-description">เชื่อมต่อด้วย Google เพื่อเริ่มบันทึกและดูสถานะกลุ่มสนทนา<br>ระบบอนุญาตเฉพาะบัญชีเจ้าของที่กำหนดไว้</p></div><a id="login-link" class="button primary" href="/auth/google">เข้าสู่ระบบด้วย Google <span>↗</span></a>\n      </section>\n      <div id="dashboard" hidden>\n        <section class="stats-grid" aria-label="สถิติระบบ">\n          <article class="stat-card"><div class="stat-label">กลุ่มที่เชื่อมต่อ <span>◉</span></div><div class="stat-number" id="group-count">—</div><div class="stat-caption">กลุ่มที่มีบอตเข้าร่วม</div></article>\n          <article class="stat-card"><div class="stat-label">เหตุการณ์ที่บันทึกสำเร็จ <span>↗</span></div><div class="stat-number" id="synced-count">—</div><div class="stat-caption">รวมข้อความ การแก้ไข และยกเลิกส่ง</div></article>\n          <article class="stat-card"><div class="stat-label">รอบันทึกลงชีต <span>◷</span></div><div class="stat-number" id="pending-count">—</div><div class="stat-caption" id="pending-caption">เก็บไว้อย่างปลอดภัยเพื่อส่งต่อ</div></article>\n        </section>\n        <section class="sync-panel"><div class="sync-icon">⇄</div><div class="sync-copy"><h2 id="sync-title">พร้อมรับบทสนทนาใหม่</h2><p>บันทึกสำเร็จล่าสุด <span id="last-sync">—</span></p></div><div class="sync-actions"><button id="refresh" class="button secondary">↻ รีเฟรชสถานะ</button><button id="retry" class="button primary">ลองส่งรายการค้าง <span>↗</span></button></div></section>\n        <section id="groups" class="section-block"><div class="section-heading"><div><h2>กลุ่มสนทนา <span id="group-total" class="count-pill">0</span></h2><p>แต่ละกลุ่มมีแท็บของตัวเองในไฟล์ประจำเดือน</p></div><label class="search"><span aria-hidden="true">⌕</span><input id="group-search" type="search" placeholder="ค้นหาชื่อหรือรหัสกลุ่ม" aria-label="ค้นหากลุ่ม"></label></div>\n          <div class="table-wrap"><table><thead><tr><th>กลุ่ม LINE</th><th>สถานะบอต</th><th>รายการค้าง</th><th>เชื่อมต่อล่าสุด</th></tr></thead><tbody id="group-rows"></tbody></table><div id="groups-empty" class="empty-state" hidden><span>◉</span><h3>พร้อมสำหรับกลุ่มแรกของคุณ</h3><p>ตั้งค่า webhook และเชิญบอตเข้ากลุ่ม LINE<br>กลุ่มและข้อความใหม่จะแสดงที่นี่โดยอัตโนมัติ</p></div></div>\n        </section>\n        <section id="errors-panel" class="section-block" hidden><div class="section-heading"><div><h2>รายการที่ต้องตรวจสอบ</h2><p>ข้อมูลยังอยู่ในระบบและจะลองส่งใหม่อัตโนมัติ</p></div></div><ul id="error-list" class="error-list"></ul></section>\n        <section id="workbooks" class="section-block"><div class="section-heading"><div><h2>คลัง Google Sheets</h2><p>แยกไฟล์ตามเดือน · เวลาไทย · เก็บย้อนหลัง 365 วัน</p></div><a id="index-link" class="text-link" target="_blank" rel="noopener noreferrer" hidden>เปิดสารบัญทั้งหมด ↗</a></div><div id="workbook-list" class="workbook-grid"></div><div id="workbooks-empty" class="mini-empty" hidden>ไฟล์รายเดือนจะสร้างเมื่อบันทึกข้อความแรกสำเร็จ</div></section>\n      </div>\n      <section class="how-it-works"><span class="flow-label">เส้นทางของข้อความ</span><div><strong><span class="line-mark">L</span> LINE Group</strong><span>→</span><strong>Cloudflare Workers</strong><span>→</span><strong><span class="sheet-mark">▤</span> Google Sheets</strong></div><small>เขียนทันที · กันรายการซ้ำ · เก็บประวัติการแก้ไข</small></section>\n      <footer><span>LINE Archive <span class="footer-dot">·</span> พื้นที่เก็บบทสนทนาส่วนตัว</span><span id="last-refresh">ยังไม่ได้โหลดสถานะ</span></footer>\n    </main>\n  </div>\n</body>\n</html>\n', "type": "text/html; charset=utf-8" }, "/styles.css": { "body": ':root{color-scheme:light;--bg:#f7f8f5;--ink:#1c3029;--muted:#798780;--line:#e3e9e3;--green:#16834f;--light:#eaf4ec;--nav:#11251e;font-family:Inter,"Noto Sans Thai",Tahoma,system-ui,sans-serif;font-synthesis:none}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-size:14px;line-height:1.65}a{color:inherit;text-decoration:none}button,input{font:inherit}button,a.button{cursor:pointer}button:disabled{opacity:.5;cursor:wait}[hidden]{display:none!important}.shell{display:grid;grid-template-columns:244px minmax(0,1fr);min-height:100vh}.sidebar{background:var(--nav);color:#bbc9c1;position:fixed;inset:0 auto 0 0;width:244px;padding:34px 22px;display:flex;flex-direction:column}.brand{display:flex;align-items:center;gap:12px;color:#eef4ef;font-size:18px;letter-spacing:-.6px}.brand strong{font-weight:400}.brand small{display:block;font-size:8px;letter-spacing:1.3px;color:#8ca699;margin-top:1px}.brand-icon{width:39px;height:42px;background:#b8e4a4;color:#153525;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:800;position:relative}.brand-icon span{position:absolute;font-size:14px;right:6px;top:1px}.workspace-label{font-size:10px;color:#789284;margin:53px 14px 14px;letter-spacing:1px}.nav-item{padding:11px 14px;margin-bottom:7px;border-radius:8px;display:flex;align-items:center;gap:13px;font-size:13px}.nav-item span{font-size:19px;line-height:1}.nav-item.active{background:#284036;color:#d5edce}.nav-item:hover{background:#213a2e}.sidebar-note{margin:auto 9px 30px;border-top:1px solid #2d4237;padding-top:25px;font-size:11px;position:relative}.sidebar-note strong{font-size:12px;font-weight:500;color:#c6d5c9;margin-left:9px}.sidebar-note p{color:#7e9989;line-height:1.9}.small-dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:#99cf88;vertical-align:middle}.sidebar-bottom{border-top:1px solid #2d4237;padding-top:20px;display:flex;gap:10px;align-items:center;font-size:11px}.sidebar-bottom strong{display:block;color:#d5dfd8;font-weight:500}.sidebar-bottom small{font-size:9px;color:#7e9989}.avatar{display:grid;place-items:center;background:#314b3d;border:1px solid #42604c;border-radius:50%;width:32px;height:32px;color:#b6d6bd}main{grid-column:2;padding:0 46px;max-width:1600px;width:100%;margin:auto}.topbar{height:78px;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;font-size:11px}.breadcrumb{color:var(--muted)}.slash{margin:0 13px;color:#a3ada6}.topbar-right{display:flex;gap:20px;align-items:center}.time-label{color:#89978d;font-size:10px}.text-button{background:none;border:0;color:var(--muted);padding:5px}.page-heading{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:38px 0 30px}.eyebrow{font-size:9px;letter-spacing:2px;font-weight:600;color:#61856c;margin-bottom:9px}h1{font-size:28px;letter-spacing:-1px;font-weight:600;line-height:1.4;margin:0 0 7px}p{margin:0;color:var(--muted);font-size:12px}.live-badge{background:#edf4eb;border:1px solid #dbe7d7;border-radius:20px;white-space:nowrap;font-size:10px;padding:7px 13px;color:#5a7d54}.live-badge .small-dot{margin-right:6px;background:#6ba560}.stats-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px}.stat-card{background:#fff;border:1px solid var(--line);border-radius:12px;padding:22px 24px;position:relative}.stat-label{font-size:11px;color:#6a7970;display:flex;justify-content:space-between;align-items:center}.stat-label>span{display:grid;place-items:center;background:#f2f5ef;width:29px;height:29px;border-radius:7px;color:#789774;font-size:16px}.stat-number{font-size:38px;line-height:1.2;letter-spacing:-1px;padding:15px 0 10px;font-weight:500}.stat-caption{font-size:10px;color:#96a198}.sync-panel{margin:24px 0 35px;padding:20px 23px;background:#eef3e9;border:1px solid #dfe7d7;border-radius:12px;display:flex;gap:15px;align-items:center}.sync-icon{display:grid;place-items:center;font-size:24px;color:#668762;width:43px;height:43px;border:1px solid #d5e2ce;background:#e5eddd;border-radius:50%}.sync-copy{flex:1}h2{font-size:15px;font-weight:600;margin:0;letter-spacing:-.3px}.sync-copy h2{font-size:12px;margin-bottom:3px}.sync-copy p{font-size:10px}.sync-actions{display:flex;gap:9px}.button{display:inline-flex;align-items:center;justify-content:center;gap:16px;border:1px solid transparent;border-radius:7px;padding:10px 16px;font-size:11px;font-weight:500;white-space:nowrap;min-height:40px}.primary{background:#1e5139;color:#f4f9f2}.primary:hover{background:#2c694b}.secondary{background:#fcfdf9;border-color:#d9e1d3;color:#53694e}.secondary:hover{background:#fff}.section-block{margin:0 0 32px;scroll-margin-top:20px}.section-heading{display:flex;align-items:center;justify-content:space-between;gap:14px;margin:0 0 18px}.section-heading p{font-size:10px;margin-top:4px}.count-pill{display:inline-block;background:#e9eee5;border-radius:5px;padding:0 6px;color:#7a8d71;font-size:10px;margin-left:6px;vertical-align:middle}.search{display:flex;align-items:center;gap:9px;border:1px solid var(--line);border-radius:7px;background:#fff;padding:7px 12px;color:#8d9b90}.search span{font-size:20px;line-height:1}.search input{border:0;background:none;font-size:10px;width:175px;outline:none;color:var(--ink)}.table-wrap{border:1px solid var(--line);border-radius:10px;background:#fff;overflow:auto}table{width:100%;border-collapse:collapse;text-align:left;white-space:nowrap}th{font-size:10px;font-weight:400;color:#87948a;background:#fafbf8;padding:12px 20px;border-bottom:1px solid var(--line)}td{padding:16px 20px;font-size:11px;border-bottom:1px solid #edf0e9}tbody tr:last-child td{border-bottom:none}.group-title{font-size:12px;font-weight:500}.group-id{font-size:9px;color:#99a49c;margin-top:3px;font-family:ui-monospace,monospace}.group-avatar{height:33px;width:33px;border-radius:9px;display:grid;place-items:center;flex-shrink:0;font-size:13px;background:#edf1e6;color:#6f805b}.group-cell{display:flex;gap:12px;align-items:center}.status-pill{font-size:9px;border-radius:15px;padding:4px 9px;color:#578356;background:#edf6eb}.status-pill.offline{background:#f2f2ee;color:#8b958d}.subtle{color:#8a978b}.text-link{font-size:11px;color:#52784e}.workbook-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.workbook-card{background:#fff;border:1px solid var(--line);border-radius:9px;padding:19px;display:flex;align-items:center;gap:13px}.workbook-card:hover{border-color:#a9bf9f}.file-icon{font-size:24px;background:#edf5e8;color:#628957;display:grid;place-items:center;width:39px;height:43px;border-radius:8px}.file-copy{flex:1;min-width:0}.file-copy strong{display:block;font-size:12px;font-weight:500}.file-copy small{color:#95a08f;font-size:9px}.file-arrow{color:#a5b19d}.empty-state{text-align:center;padding:42px 20px}.empty-state>span{display:block;color:#7f9b72;font-size:30px;margin-bottom:10px}.empty-state h3{font-size:13px;margin:0 0 6px;font-weight:500}.empty-state p{font-size:11px;line-height:1.9}.mini-empty{border:1px dashed #d8e1d2;border-radius:9px;padding:25px;text-align:center;font-size:11px;color:#8a9985}.how-it-works{border-top:1px solid var(--line);padding:26px 0;display:flex;align-items:center;justify-content:space-between;gap:18px;color:#8b998b}.flow-label{font-size:10px}.how-it-works>div{display:flex;align-items:center;gap:17px;font-size:10px}.how-it-works strong{font-weight:500;color:#6d7e6a}.how-it-works small{font-size:9px}.line-mark{display:inline-grid;place-items:center;background:#6aaf69;color:#fff;border-radius:4px;width:17px;height:17px;margin-right:3px;font-size:10px}.sheet-mark{color:#699354;font-size:16px;vertical-align:middle}footer{border-top:1px solid var(--line);padding:18px 0 25px;display:flex;justify-content:space-between;font-size:9px;color:#9ba69a}.footer-dot{margin:0 8px}.notice{padding:13px 17px;border:1px solid #e5c99b;background:#fff8eb;border-radius:9px;font-size:12px;color:#856033;margin-bottom:20px;overflow-wrap:anywhere}.login-panel{display:flex;gap:22px;align-items:center;background:#fff;border:1px solid var(--line);border-radius:12px;padding:32px;margin-bottom:34px}.login-panel>div:nth-child(2){flex:1}.login-panel h2{font-size:20px;margin-bottom:8px}.login-panel p{line-height:1.9}.login-symbol{width:62px;height:70px;border-radius:15px;background:#e5efdd;display:grid;place-items:center;font-size:36px;color:#547c47}.error-list{padding:0;list-style:none;background:#fff;border:1px solid var(--line);border-radius:9px}.error-list li{padding:15px 20px;border-bottom:1px solid var(--line);font-size:11px;overflow-wrap:anywhere}.error-list li:last-child{border-bottom:0}.error-list small{display:block;color:#94a08f;font-size:10px;margin-top:4px}:focus-visible{outline:3px solid #8cba7b;outline-offset:3px}html{scroll-behavior:smooth}@media(min-width:1600px){main{padding:0 70px}}@media(max-width:1100px){.shell{grid-template-columns:195px minmax(0,1fr)}.sidebar{width:195px;padding:28px 16px}.brand{font-size:15px}.brand small{font-size:6px}main{padding:0 25px}.page-heading{align-items:flex-start}.page-heading h1{font-size:23px}.live-badge{font-size:9px}.sync-panel{flex-wrap:wrap}.sync-actions{margin-left:auto}.workbook-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.how-it-works{flex-wrap:wrap}.stat-card{padding:18px}.time-label{display:none}}@media(max-width:720px){.shell{display:block}.sidebar{position:static;width:100%;padding:17px 20px;display:block}.brand{font-size:18px}.brand-icon{height:34px;width:34px;font-size:23px}.brand small{font-size:7px}.workspace-label,.nav-item,.sidebar-note,.sidebar-bottom{display:none}main{padding:0 19px}.topbar{height:53px}.page-heading{padding:25px 0 23px;display:block}.page-heading h1{font-size:23px}.page-heading p{font-size:11px}.live-badge{display:inline-block;margin-top:16px}.stats-grid{gap:8px}.stat-card{padding:13px 10px;border-radius:8px}.stat-label{font-size:9px;min-height:30px}.stat-label>span{display:none}.stat-number{font-size:29px;padding:8px 0}.stat-caption{font-size:8px;line-height:1.7}.sync-panel{padding:17px;gap:12px;margin:17px 0 28px}.sync-actions{margin-left:0;display:flex;width:100%;justify-content:flex-end}.button{padding:9px 12px;font-size:10px}.section-heading{align-items:flex-start;flex-wrap:wrap}.section-heading h2{font-size:14px}.search{width:100%}.search input{width:100%}th,td{padding:12px}.workbook-grid{grid-template-columns:1fr}.how-it-works{gap:10px}.how-it-works>div{gap:9px;font-size:9px}.how-it-works>small{width:100%}.login-panel{padding:22px;display:block}.login-panel .button{margin-top:20px}.login-symbol{width:42px;height:45px;font-size:25px;margin-bottom:18px}footer{display:block;line-height:2}footer>span{display:block}}\n', "type": "text/css; charset=utf-8" }, "/app.js": { "body": "const $ = (id) => document.getElementById(id);\nconst date = (value) => value ? new Intl.DateTimeFormat('th-TH', {\n  timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',\n}).format(new Date(Number(value))) : 'ยังไม่มีข้อมูล';\nconst number = (value) => new Intl.NumberFormat('th-TH').format(value || 0);\nlet current;\nlet retrying = false;\nlet loading = false;\nfunction element(tag, className, text) {\n  const item = document.createElement(tag);\n  if (className) item.className = className;\n  if (text !== undefined) item.textContent = text;\n  return item;\n}\nfunction notice(message) { $('notice').textContent = message; $('notice').hidden = !message; }\nfunction renderGroups() {\n  const search = $('group-search').value.trim().toLocaleLowerCase();\n  const groups = current.groups.filter((g) => `${g.display_name || ''} ${g.group_id}`.toLocaleLowerCase().includes(search));\n  $('group-rows').replaceChildren();\n  $('groups-empty').hidden = groups.length > 0;\n  if (search && !groups.length) {\n    $('groups-empty').querySelector('h3').textContent = 'ไม่พบกลุ่มที่ตรงกับคำค้น';\n    $('groups-empty').querySelector('p').textContent = 'ลองค้นหาด้วยชื่อหรือรหัสกลุ่มอื่น';\n  } else if (!groups.length) {\n    $('groups-empty').querySelector('h3').textContent = 'พร้อมสำหรับกลุ่มแรกของคุณ';\n    $('groups-empty').querySelector('p').textContent = 'ตั้งค่า webhook และเชิญบอตเข้ากลุ่ม LINE กลุ่มและข้อความใหม่จะแสดงที่นี่โดยอัตโนมัติ';\n  }\n  for (const group of groups) {\n    const row = element('tr');\n    const cell = element('td');\n    const groupCell = element('div', 'group-cell');\n    groupCell.append(element('span', 'group-avatar', (group.display_name || 'L').slice(0, 1)));\n    const copy = element('div');\n    copy.append(element('div', 'group-title', group.display_name || 'กลุ่ม LINE'), element('div', 'group-id', group.group_id));\n    groupCell.append(copy); cell.append(groupCell); row.append(cell);\n    const status = element('td');\n    status.append(element('span', `status-pill${group.active ? '' : ' offline'}`, group.active ? '● เชื่อมต่อแล้ว' : 'บอตออกจากกลุ่มแล้ว'));\n    row.append(status, element('td', 'subtle', number(group.pending)), element('td', 'subtle', date(group.updated_at_ms)));\n    $('group-rows').append(row);\n  }\n}\nfunction render(data) {\n  current = data;\n  $('login-panel').hidden = data.authenticated;\n  $('dashboard').hidden = !data.authenticated;\n  $('logout').hidden = !data.authenticated;\n  $('reconnect').hidden = !data.authenticated || data.demo;\n  $('connection-badge').replaceChildren(element('span', 'small-dot'), document.createTextNode(data.authenticated && data.configuration.line ? ' ระบบพร้อมรับข้อความ' : ' รอเชื่อมต่อระบบ'));\n  $('last-refresh').textContent = `อัปเดตสถานะ ${date(Date.now())}`;\n  if (!data.authenticated) {\n    $('login-link').hidden = !data.configuration.google;\n    if (!data.configuration.google) $('login-description').textContent = 'ยังไม่ได้ตั้งค่า Google OAuth และบัญชีเจ้าของ โปรดทำตาม README ในโปรเจกต์ก่อนเปิดใช้งาน ระบบยังไม่รับสิทธิ์เข้าถึงข้อมูลของคุณ';\n    return;\n  }\n  $('group-count').textContent = number(data.groups.filter((g) => g.active).length);\n  $('group-total').textContent = number(data.groups.length);\n  $('synced-count').textContent = number(data.syncedEvents);\n  $('pending-count').textContent = number(data.pending);\n  $('pending-caption').textContent = data.failed ? `${number(data.failed)} รายการกำลังรอลองส่งใหม่` : 'ข้อความใหม่จะถูกเขียนลงชีตทันที';\n  $('last-sync').textContent = date(data.lastSyncAt);\n  $('sync-title').textContent = data.pending ? `มี ${number(data.pending)} รายการกำลังรอบันทึก` : 'พร้อมรับบทสนทนาใหม่';\n  $('retry').disabled = retrying || !data.pending;\n  $('index-link').hidden = !data.indexSpreadsheetId;\n  if (data.indexSpreadsheetId) $('index-link').href = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(data.indexSpreadsheetId)}`;\n  renderGroups();\n  $('workbook-list').replaceChildren();\n  $('workbooks-empty').hidden = data.workbooks.length > 0;\n  for (const workbook of data.workbooks) {\n    const card = element('a', 'workbook-card');\n    card.href = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(workbook.spreadsheet_id)}`;\n    card.target = '_blank'; card.rel = 'noopener noreferrer';\n    const copy = element('div', 'file-copy');\n    copy.append(element('strong', '', `LINE Archive ${workbook.month}`), element('small', '', 'ข้อความและประวัติแยกตามกลุ่ม'));\n    card.append(element('span', 'file-icon', '▤'), copy, element('span', 'file-arrow', '↗'));\n    $('workbook-list').append(card);\n  }\n  $('errors-panel').hidden = !data.errors.length;\n  $('error-list').replaceChildren();\n  for (const error of data.errors) {\n    const item = element('li', '', error.last_error);\n    item.append(element('small', '', `${error.group_id} · ลองแล้ว ${number(error.attempts)} ครั้ง · รอบถัดไป ${date(error.next_attempt_at_ms)}`));\n    $('error-list').append(item);\n  }\n  if (data.demo) notice('โหมดตัวอย่างหน้าจอ — ข้อมูลจำลอง ไม่มีการเชื่อมต่อ LINE หรือ Google และไม่มีการบันทึกข้อมูลจริง');\n  else if (!data.configuration.line) notice('ยังไม่ได้ตั้งค่า LINE Channel Secret หรือ Channel Access Token โปรดตั้งค่าก่อนเชิญบอตเข้ากลุ่ม');\n  else if (data.maintenanceError) notice(`งานดูแลข้อมูลต้องตรวจสอบ: ${data.maintenanceError}`);\n  else if (data.setupError) notice(`การเตรียมชีตจะลองใหม่อัตโนมัติ: ${data.setupError}`);\n}\nasync function load() {\n  if (loading) return;\n  loading = true;\n  try {\n    const response = await fetch('/api/status', { cache: 'no-store' });\n    const data = await response.json();\n    if (!response.ok) throw new Error(data.error || 'โหลดสถานะไม่สำเร็จ');\n    notice(''); render(data);\n  } catch (error) {\n    notice(error.message || 'เชื่อมต่อระบบไม่สำเร็จ กรุณาลองอีกครั้ง');\n    $('connection-badge').textContent = 'เชื่อมต่อระบบไม่สำเร็จ';\n  } finally { loading = false; }\n}\n$('refresh').addEventListener('click', load);\n$('group-search').addEventListener('input', renderGroups);\n$('retry').addEventListener('click', async () => {\n  retrying = true; $('retry').disabled = true;\n  try {\n    const response = await fetch('/api/retry', { method: 'POST' });\n    const data = await response.json();\n    if (!response.ok) throw new Error(data.error);\n    notice('เริ่มลองส่งรายการค้างแล้ว ระบบจะทยอยส่งต่ออัตโนมัติ ดูผลได้จากจำนวนรายการค้าง');\n    setTimeout(load, 2500);\n  } catch (error) { notice(error.message || 'ลองส่งใหม่ไม่สำเร็จ'); }\n  finally { retrying = false; $('retry').disabled = !current?.pending; }\n});\n$('logout').addEventListener('click', async () => {\n  const response = await fetch('/auth/logout', { method: 'POST' });\n  if (response.ok) { current = null; await load(); }\n  else notice('ออกจากระบบไม่สำเร็จ กรุณาลองใหม่');\n});\ndocument.querySelectorAll('.nav-item').forEach((link) => link.addEventListener('click', () => {\n  document.querySelectorAll('.nav-item').forEach((item) => item.classList.toggle('active', item === link));\n}));\nload();\nsetInterval(() => { if (!document.hidden && current?.authenticated) load(); }, 30_000);\n", "type": "text/javascript; charset=utf-8" }, "/": { "body": '<!doctype html>\n<html lang="th">\n<head>\n  <meta charset="UTF-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  <meta name="theme-color" content="#101f1b">\n  <title>LINE Archive — บันทึกทุกบทสนทนา</title>\n  <link rel="stylesheet" href="/styles.css">\n  <script type="module" src="/app.js"><\/script>\n</head>\n<body>\n  <div class="shell">\n    <aside class="sidebar">\n      <a class="brand" href="/" aria-label="LINE Archive หน้าหลัก"><span class="brand-icon">L<span>↗</span></span><span>LINE <strong>Archive</strong><small>YOUR CONVERSATION LIBRARY</small></span></a>\n      <div class="workspace-label">พื้นที่ส่วนตัว</div>\n      <a href="#overview" class="nav-item active"><span aria-hidden="true">▦</span> ภาพรวม</a>\n      <a href="#groups" class="nav-item"><span aria-hidden="true">◉</span> กลุ่มสนทนา</a>\n      <a href="#workbooks" class="nav-item"><span aria-hidden="true">▤</span> คลัง Google Sheets</a>\n      <div class="sidebar-note"><span class="small-dot"></span><strong>ข้อความที่ค้นกลับมาได้</strong><p>เก็บบทสนทนาอย่างเป็นระเบียบ<br>พร้อมสำหรับการวิเคราะห์</p></div>\n      <div class="sidebar-bottom"><span class="avatar">P</span><div><strong>Personal workspace</strong><small>Cloudflare · Google Sheets</small></div></div>\n    </aside>\n    <main id="overview">\n      <header class="topbar"><div><span class="breadcrumb">พื้นที่ทำงาน</span><span class="slash">/</span><span>ภาพรวม</span></div><div class="topbar-right"><span class="time-label">เวลาประเทศไทย · UTC+7</span><a id="reconnect" href="/auth/google" class="text-button" hidden>เชื่อมต่อ Google ใหม่</a><button id="logout" class="text-button" hidden>ออกจากระบบ</button></div></header>\n      <section class="page-heading"><div><div class="eyebrow">CONVERSATION INTELLIGENCE</div><h1>ทุกบทสนทนา อยู่ในที่เดียว</h1><p>บันทึกข้อความจากกลุ่ม LINE ลง Google Sheets พร้อมค้นต่อได้เสมอ</p></div><span class="live-badge" id="connection-badge"><span class="small-dot"></span> กำลังตรวจสอบระบบ</span></section>\n      <div id="notice" class="notice" role="status" aria-live="polite" hidden></div>\n      <section id="login-panel" class="login-panel" hidden>\n        <div class="login-symbol">↗</div><div><div class="eyebrow">OWNER ACCESS</div><h2>เข้าสู่พื้นที่ของคุณ</h2><p id="login-description">เชื่อมต่อด้วย Google เพื่อเริ่มบันทึกและดูสถานะกลุ่มสนทนา<br>ระบบอนุญาตเฉพาะบัญชีเจ้าของที่กำหนดไว้</p></div><a id="login-link" class="button primary" href="/auth/google">เข้าสู่ระบบด้วย Google <span>↗</span></a>\n      </section>\n      <div id="dashboard" hidden>\n        <section class="stats-grid" aria-label="สถิติระบบ">\n          <article class="stat-card"><div class="stat-label">กลุ่มที่เชื่อมต่อ <span>◉</span></div><div class="stat-number" id="group-count">—</div><div class="stat-caption">กลุ่มที่มีบอตเข้าร่วม</div></article>\n          <article class="stat-card"><div class="stat-label">เหตุการณ์ที่บันทึกสำเร็จ <span>↗</span></div><div class="stat-number" id="synced-count">—</div><div class="stat-caption">รวมข้อความ การแก้ไข และยกเลิกส่ง</div></article>\n          <article class="stat-card"><div class="stat-label">รอบันทึกลงชีต <span>◷</span></div><div class="stat-number" id="pending-count">—</div><div class="stat-caption" id="pending-caption">เก็บไว้อย่างปลอดภัยเพื่อส่งต่อ</div></article>\n        </section>\n        <section class="sync-panel"><div class="sync-icon">⇄</div><div class="sync-copy"><h2 id="sync-title">พร้อมรับบทสนทนาใหม่</h2><p>บันทึกสำเร็จล่าสุด <span id="last-sync">—</span></p></div><div class="sync-actions"><button id="refresh" class="button secondary">↻ รีเฟรชสถานะ</button><button id="retry" class="button primary">ลองส่งรายการค้าง <span>↗</span></button></div></section>\n        <section id="groups" class="section-block"><div class="section-heading"><div><h2>กลุ่มสนทนา <span id="group-total" class="count-pill">0</span></h2><p>แต่ละกลุ่มมีแท็บของตัวเองในไฟล์ประจำเดือน</p></div><label class="search"><span aria-hidden="true">⌕</span><input id="group-search" type="search" placeholder="ค้นหาชื่อหรือรหัสกลุ่ม" aria-label="ค้นหากลุ่ม"></label></div>\n          <div class="table-wrap"><table><thead><tr><th>กลุ่ม LINE</th><th>สถานะบอต</th><th>รายการค้าง</th><th>เชื่อมต่อล่าสุด</th></tr></thead><tbody id="group-rows"></tbody></table><div id="groups-empty" class="empty-state" hidden><span>◉</span><h3>พร้อมสำหรับกลุ่มแรกของคุณ</h3><p>ตั้งค่า webhook และเชิญบอตเข้ากลุ่ม LINE<br>กลุ่มและข้อความใหม่จะแสดงที่นี่โดยอัตโนมัติ</p></div></div>\n        </section>\n        <section id="errors-panel" class="section-block" hidden><div class="section-heading"><div><h2>รายการที่ต้องตรวจสอบ</h2><p>ข้อมูลยังอยู่ในระบบและจะลองส่งใหม่อัตโนมัติ</p></div></div><ul id="error-list" class="error-list"></ul></section>\n        <section id="workbooks" class="section-block"><div class="section-heading"><div><h2>คลัง Google Sheets</h2><p>แยกไฟล์ตามเดือน · เวลาไทย · เก็บย้อนหลัง 365 วัน</p></div><a id="index-link" class="text-link" target="_blank" rel="noopener noreferrer" hidden>เปิดสารบัญทั้งหมด ↗</a></div><div id="workbook-list" class="workbook-grid"></div><div id="workbooks-empty" class="mini-empty" hidden>ไฟล์รายเดือนจะสร้างเมื่อบันทึกข้อความแรกสำเร็จ</div></section>\n      </div>\n      <section class="how-it-works"><span class="flow-label">เส้นทางของข้อความ</span><div><strong><span class="line-mark">L</span> LINE Group</strong><span>→</span><strong>Cloudflare Workers</strong><span>→</span><strong><span class="sheet-mark">▤</span> Google Sheets</strong></div><small>เขียนทันที · กันรายการซ้ำ · เก็บประวัติการแก้ไข</small></section>\n      <footer><span>LINE Archive <span class="footer-dot">·</span> พื้นที่เก็บบทสนทนาส่วนตัว</span><span id="last-refresh">ยังไม่ได้โหลดสถานะ</span></footer>\n    </main>\n  </div>\n</body>\n</html>\n', "type": "text/html; charset=utf-8" } };

// archive:archive-schema
var archive_schema_default = ["CREATE TABLE messages (\n    group_id TEXT NOT NULL CHECK (length(group_id) > 0),\n    message_id TEXT NOT NULL CHECK (length(message_id) > 0),\n    sender_id TEXT,\n    sender_display_name TEXT,\n    sent_at_ms INTEGER NOT NULL CHECK (sent_at_ms >= 0),\n    received_at_ms INTEGER NOT NULL CHECK (received_at_ms >= 0),\n    original_text TEXT NOT NULL,\n    replied_to_message_id TEXT,\n    PRIMARY KEY (group_id, message_id)\n)", "CREATE INDEX messages_group_sent ON messages(group_id, sent_at_ms)", "CREATE TABLE message_events (\n    webhook_event_id TEXT PRIMARY KEY NOT NULL CHECK (length(webhook_event_id) > 0),\n    group_id TEXT NOT NULL CHECK (length(group_id) > 0),\n    message_id TEXT NOT NULL CHECK (length(message_id) > 0),\n    event_type TEXT NOT NULL CHECK (event_type IN ('received', 'edited', 'unsent')),\n    event_at_ms INTEGER NOT NULL CHECK (event_at_ms >= 0),\n    received_at_ms INTEGER NOT NULL CHECK (received_at_ms >= 0),\n    text TEXT,\n    sheets_synced_at_ms INTEGER CHECK (sheets_synced_at_ms >= 0),\n    CHECK (\n        (event_type IN ('received', 'edited') AND text IS NOT NULL)\n        OR (event_type = 'unsent' AND text IS NULL)\n    )\n)", "CREATE INDEX events_message_time\n    ON message_events(group_id, message_id, event_type, event_at_ms, webhook_event_id)", "CREATE INDEX events_pending\n    ON message_events(received_at_ms) WHERE sheets_synced_at_ms IS NULL", "CREATE VIEW message_current AS\nSELECT\n    m.group_id,\n    m.message_id,\n    m.sender_id,\n    m.sender_display_name,\n    m.sent_at_ms,\n    strftime('%Y-%m-%dT%H:%M:%f', m.sent_at_ms / 1000.0,\n             'unixepoch', '+7 hours') || '+07:00' AS sent_at_thai,\n    'Asia/Bangkok' AS timezone,\n    m.received_at_ms,\n    m.original_text,\n    COALESCE((\n        SELECT e.text FROM message_events e\n        WHERE e.group_id = m.group_id AND e.message_id = m.message_id\n          AND e.event_type = 'edited'\n        ORDER BY e.event_at_ms DESC, e.webhook_event_id DESC LIMIT 1\n    ), m.original_text) AS current_text,\n    m.replied_to_message_id,\n    CASE\n        WHEN EXISTS (\n            SELECT 1 FROM message_events e\n            WHERE e.group_id = m.group_id AND e.message_id = m.message_id\n              AND e.event_type = 'unsent'\n        ) THEN 'unsent'\n        WHEN EXISTS (\n            SELECT 1 FROM message_events e\n            WHERE e.group_id = m.group_id AND e.message_id = m.message_id\n              AND e.event_type = 'edited'\n        ) THEN 'edited'\n        ELSE 'active'\n    END AS message_status,\n    (SELECT MAX(e.event_at_ms) FROM message_events e\n     WHERE e.group_id = m.group_id AND e.message_id = m.message_id\n       AND e.event_type = 'edited') AS edited_at_ms,\n    (SELECT MAX(e.event_at_ms) FROM message_events e\n     WHERE e.group_id = m.group_id AND e.message_id = m.message_id\n       AND e.event_type = 'unsent') AS unsent_at_ms,\n    1 + (SELECT COUNT(*) FROM message_events e\n         WHERE e.group_id = m.group_id AND e.message_id = m.message_id\n           AND e.event_type = 'edited') AS version_count\nFROM messages m", "CREATE VIEW ai_messages AS\nSELECT group_id, message_id, sender_id, sender_display_name,\n       sent_at_ms, sent_at_thai, timezone, current_text,\n       replied_to_message_id, message_status, edited_at_ms, version_count\nFROM message_current\nWHERE message_status <> 'unsent'", "CREATE VIEW message_history AS\nSELECT e.webhook_event_id, e.group_id, e.message_id,\n       e.event_type, e.event_at_ms,\n       strftime('%Y-%m-%dT%H:%M:%f', e.event_at_ms / 1000.0,\n                'unixepoch', '+7 hours') || '+07:00' AS event_at_thai,\n       'Asia/Bangkok' AS timezone,\n       e.text, e.received_at_ms, e.sheets_synced_at_ms\nFROM message_events e", "CREATE TABLE settings (\n    key TEXT PRIMARY KEY NOT NULL,\n    value TEXT NOT NULL\n)", "CREATE TABLE chat_groups (\n    group_id TEXT PRIMARY KEY NOT NULL,\n    display_name TEXT,\n    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),\n    updated_at_ms INTEGER NOT NULL\n)", "CREATE TABLE member_profiles (\n    group_id TEXT NOT NULL,\n    sender_id TEXT NOT NULL,\n    display_name TEXT,\n    expires_at_ms INTEGER NOT NULL,\n    PRIMARY KEY (group_id, sender_id)\n)", "CREATE TABLE workbooks (\n    month TEXT PRIMARY KEY NOT NULL,\n    spreadsheet_id TEXT NOT NULL,\n    created_at_ms INTEGER NOT NULL,\n    expired INTEGER NOT NULL DEFAULT 0 CHECK (expired IN (0, 1))\n)", "CREATE TABLE sheet_targets (\n    month TEXT NOT NULL,\n    group_id TEXT NOT NULL,\n    kind TEXT NOT NULL CHECK (kind IN ('messages', 'history')),\n    sheet_id INTEGER NOT NULL,\n    title TEXT NOT NULL,\n    next_row INTEGER NOT NULL DEFAULT 2,\n    capacity INTEGER NOT NULL DEFAULT 100,\n    PRIMARY KEY (month, group_id, kind),\n    UNIQUE (month, sheet_id)\n)", "CREATE TABLE sheet_rows (\n    group_id TEXT NOT NULL,\n    kind TEXT NOT NULL CHECK (kind IN ('messages', 'history')),\n    reference_id TEXT NOT NULL,\n    month TEXT NOT NULL,\n    row_number INTEGER NOT NULL,\n    recorded_at_ms INTEGER NOT NULL,\n    PRIMARY KEY (group_id, kind, reference_id)\n)", "CREATE TABLE leases (\n    name TEXT PRIMARY KEY NOT NULL,\n    token TEXT NOT NULL,\n    expires_at_ms INTEGER NOT NULL\n)", "ALTER TABLE message_events ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0", "ALTER TABLE message_events ADD COLUMN next_attempt_at_ms INTEGER NOT NULL DEFAULT 0", "ALTER TABLE message_events ADD COLUMN last_error TEXT", "DROP INDEX events_pending", "CREATE INDEX events_pending ON message_events(next_attempt_at_ms, received_at_ms)\n    WHERE sheets_synced_at_ms IS NULL", "CREATE INDEX events_completed ON message_events(sheets_synced_at_ms)\n    WHERE sheets_synced_at_ms IS NOT NULL", "CREATE INDEX messages_received ON messages(received_at_ms)", "CREATE INDEX sheet_rows_recorded ON sheet_rows(recorded_at_ms)", "CREATE INDEX profiles_expiry ON member_profiles(expires_at_ms)"];

// src/dashboard-bootstrap.js
var ready = /* @__PURE__ */ new WeakMap();
var requiredTables = [
  "messages",
  "message_events",
  "settings",
  "chat_groups",
  "member_profiles",
  "workbooks",
  "sheet_targets",
  "sheet_rows",
  "leases"
];
async function initialized(db) {
  const tables = (await db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).results.map((r) => r.name);
  if (!tables.includes("settings")) return false;
  const marker = await db.prepare("SELECT value FROM settings WHERE key='dashboard_schema_version'").first();
  if (marker?.value === "3" && requiredTables.every((name) => tables.includes(name))) return true;
  return false;
}
async function initialize(db, statements) {
  if (await initialized(db)) return;
  const tables = (await db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).results.map((r) => r.name);
  if (requiredTables.some((name) => tables.includes(name))) {
    throw new Error("ฐานข้อมูลนี้มีตารางอยู่แล้วแต่ไม่ใช่ชุด Dashboard ที่พร้อมใช้ กรุณาเลือกฐาน D1 ใหม่ที่ว่าง โดยไม่ลบข้อมูลเดิม");
  }
  try {
    await db.batch([
      ...statements.map((sql) => db.prepare(sql)),
      db.prepare("INSERT INTO settings(key,value) VALUES ('dashboard_schema_version','3')")
    ]);
  } catch (error) {
    if (!await initialized(db)) throw error;
  }
}
async function ensureDashboardDatabase(db, statements) {
  if (!db?.prepare) throw new Error("ยังไม่ได้เชื่อม D1 binding ชื่อ DB ในหน้า Bindings ของ Worker");
  let pending = ready.get(db);
  if (!pending) {
    pending = initialize(db, statements);
    ready.set(db, pending);
  }
  try {
    await pending;
  } catch (error) {
    ready.delete(db);
    throw error;
  }
}

// src/dashboard-entry.js
function environment(env) {
  return { ...env, ASSETS: {
    async fetch(request) {
      const asset = archive_static_assets_default[new URL(request.url).pathname];
      if (!asset || !["GET", "HEAD"].includes(request.method)) return new Response("Not found", { status: 404 });
      return new Response(request.method === "HEAD" ? null : asset.body, {
        headers: { "content-type": asset.type, "cache-control": "no-cache" }
      });
    }
  } };
}
var dashboard_entry_default = {
  async fetch(request, env, ctx) {
    try {
      await ensureDashboardDatabase(env.DB, archive_schema_default);
    } catch (error) {
      const known = error.message.startsWith("ยังไม่ได้") || error.message.startsWith("ฐานข้อมูลนี้");
      return secure(json({ error: known ? error.message : "เตรียมฐานข้อมูลไม่สำเร็จ ตรวจ D1 binding และโควตา แล้วลองใหม่" }, 503));
    }
    return worker_default.fetch(request, environment(env), ctx);
  },
  async scheduled(controller, env, ctx) {
    await ensureDashboardDatabase(env.DB, archive_schema_default);
    return worker_default.scheduled(controller, environment(env), ctx);
  }
};
export {
  dashboard_entry_default as default
};
