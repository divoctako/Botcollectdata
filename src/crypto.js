const encoder = new TextEncoder();
export const utf8 = (value) => encoder.encode(value);
export function base64(bytes) {
  return btoa(Array.from(new Uint8Array(bytes), (n) => String.fromCharCode(n)).join(''));
}
export const base64url = (bytes) => base64(bytes).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
export function unbase64(value) {
  return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), (c) => c.charCodeAt(0));
}
export async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', utf8(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
export async function signObject(value, secret) {
  const payload = base64url(utf8(JSON.stringify(value)));
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret), utf8(payload));
  return `${payload}.${base64url(signature)}`;
}
export async function readObject(token, secret, now = Date.now()) {
  if (!token || !secret) return null;
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    if (!await crypto.subtle.verify('HMAC', await hmacKey(secret), unbase64(parts[1]), utf8(parts[0]))) return null;
    const data = JSON.parse(new TextDecoder().decode(unbase64(parts[0])));
    return Number.isFinite(data.exp) && data.exp > now ? data : null;
  } catch { return null; }
}
async function encryptionKey(secret) {
  return crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256', utf8(secret)), 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function encrypt(value, secret) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const body = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await encryptionKey(secret), utf8(value));
  return `${base64url(iv)}.${base64url(body)}`;
}
export async function decrypt(value, secret) {
  const [iv, body] = value.split('.');
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unbase64(iv) }, await encryptionKey(secret), unbase64(body)));
}
