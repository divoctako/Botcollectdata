import { base64url, utf8, signObject, readObject, encrypt, decrypt } from './crypto.js';
import { externalJson, HttpError } from './http.js';
import { setting, setSetting } from './store.js';

export const SCOPE = 'openid email profile https://www.googleapis.com/auth/drive.file';
const accessCache = new Map();
export function configuration(env) {
  return {
    google: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.OWNER_EMAIL
      && !env.OWNER_EMAIL.startsWith('replace-') && env.SESSION_SECRET?.length >= 32
      && env.TOKEN_ENCRYPTION_SECRET?.length >= 32),
    line: Boolean(env.LINE_CHANNEL_SECRET && env.LINE_CHANNEL_ACCESS_TOKEN),
  };
}
function cookieValue(request, name) {
  return request.headers.get('cookie')?.split(';').map((s) => s.trim()).find((s) => s.startsWith(`${name}=`))?.slice(name.length + 1);
}
function cookie(env, name, value, maxAge, path = '/') {
  return `${name}=${value}; Path=${path}; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${env.APP_URL.startsWith('https://') ? '; Secure' : ''}`;
}
export async function ownerSession(request, env) {
  const session = await readObject(cookieValue(request, 'archive_session'), env.SESSION_SECRET);
  return session?.purpose === 'session' && session.email === env.OWNER_EMAIL?.toLowerCase() ? session : null;
}
export async function requireOwner(request, env) {
  const session = await ownerSession(request, env);
  if (!session) throw new HttpError(401, 'กรุณาเข้าสู่ระบบด้วยบัญชี Google เจ้าของ');
  return session;
}
export async function startLogin(env) {
  if (!configuration(env).google) throw new HttpError(503, 'ยังไม่ได้ตั้งค่า Google OAuth และบัญชีเจ้าของ ดูคู่มือตั้งค่าระบบ');
  const nonce = base64url(crypto.getRandomValues(new Uint8Array(24)));
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const state = await signObject({ purpose: 'oauth', nonce, verifier, exp: Date.now() + 600_000 }, env.SESSION_SECRET);
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  const challenge = base64url(await crypto.subtle.digest('SHA-256', utf8(verifier)));
  url.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID, redirect_uri: `${env.APP_URL}/auth/callback`,
    response_type: 'code', scope: SCOPE, access_type: 'offline', prompt: 'consent',
    state: nonce, code_challenge: challenge, code_challenge_method: 'S256',
    login_hint: env.OWNER_EMAIL,
  }).toString();
  return new Response(null, { status: 302, headers: {
    location: url.toString(), 'set-cookie': cookie(env, 'archive_oauth', state, 600, '/auth'),
    'cache-control': 'no-store',
  } });
}
export async function finishLogin(request, env) {
  const url = new URL(request.url);
  const state = await readObject(cookieValue(request, 'archive_oauth'), env.SESSION_SECRET);
  if (!state || state.purpose !== 'oauth' || state.nonce !== url.searchParams.get('state')) {
    throw new HttpError(403, 'การเข้าสู่ระบบหมดอายุหรือ state ไม่ตรง กรุณาเริ่มใหม่');
  }
  const code = url.searchParams.get('code');
  if (!code) throw new HttpError(400, 'Google ไม่ได้ส่ง authorization code');
  const tokens = await externalJson('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: `${env.APP_URL}/auth/callback`,
      grant_type: 'authorization_code', code_verifier: state.verifier }),
  });
  const user = await externalJson('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { authorization: `Bearer ${tokens.access_token}` },
  });
  if (user.email_verified !== true || user.email?.toLowerCase() !== env.OWNER_EMAIL.toLowerCase()) {
    throw new HttpError(403, 'บัญชีนี้ไม่ได้รับอนุญาตให้เข้าระบบ');
  }
  if (!tokens.scope?.split(' ').includes('https://www.googleapis.com/auth/drive.file')) {
    throw new HttpError(403, 'ต้องอนุญาตสิทธิ์สร้างและจัดการไฟล์ของแอปเพื่อบันทึกข้อความ');
  }
  if (tokens.refresh_token) {
    await setSetting(env, 'google_refresh_token', await encrypt(tokens.refresh_token, env.TOKEN_ENCRYPTION_SECRET));
  } else if (!await setting(env, 'google_refresh_token')) {
    throw new HttpError(400, 'ไม่ได้รับ refresh token กรุณายกเลิกสิทธิ์แอปใน Google แล้วเชื่อมต่อใหม่');
  }
  await setSetting(env, 'google_owner_email', user.email.toLowerCase());
  accessCache.set(`${env.GOOGLE_CLIENT_ID}:${env.OWNER_EMAIL.toLowerCase()}`, { token: tokens.access_token, expires: Date.now() + (tokens.expires_in - 60) * 1000 });
  const session = await signObject({ purpose: 'session', email: user.email.toLowerCase(), exp: Date.now() + 8 * 3600_000 }, env.SESSION_SECRET);
  const headers = new Headers({ location: '/', 'cache-control': 'no-store' });
  headers.append('set-cookie', cookie(env, 'archive_session', session, 8 * 3600));
  headers.append('set-cookie', cookie(env, 'archive_oauth', '', 0, '/auth'));
  return new Response(null, { status: 302, headers });
}
export function logout(env) {
  return new Response(null, { status: 204, headers: { 'set-cookie': cookie(env, 'archive_session', '', 0), 'cache-control': 'no-store' } });
}
export async function googleToken(env) {
  const cacheKey = `${env.GOOGLE_CLIENT_ID}:${env.OWNER_EMAIL?.toLowerCase()}`;
  const cached = accessCache.get(cacheKey);
  if (cached?.expires > Date.now()) return cached.token;
  if (await setting(env, 'google_owner_email') !== env.OWNER_EMAIL?.toLowerCase()) {
    throw new Error('บัญชีเจ้าของเปลี่ยน กรุณาเชื่อมต่อ Google ใหม่');
  }
  const stored = await setting(env, 'google_refresh_token');
  if (!stored) throw new Error('ยังไม่ได้เชื่อมต่อ Google กรุณาเข้าสู่ระบบครั้งแรก');
  const refresh = await decrypt(stored, env.TOKEN_ENCRYPTION_SECRET);
  const result = await externalJson('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: refresh, grant_type: 'refresh_token' }),
  });
  accessCache.set(cacheKey, { token: result.access_token, expires: Date.now() + (result.expires_in - 60) * 1000 });
  return result.access_token;
}
