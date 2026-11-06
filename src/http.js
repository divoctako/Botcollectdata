export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

export function secure(response) {
  const headers = new Headers(response.headers);
  headers.set('x-content-type-options', 'nosniff');
  headers.set('referrer-policy', 'no-referrer');
  headers.set('x-frame-options', 'DENY');
  headers.set('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export async function externalJson(url, init = {}) {
  const response = await fetch(url, { ...init, signal: init.signal ?? AbortSignal.timeout(10_000) });
  if (!response.ok) {
    // Never expose provider response bodies containing user data or credentials.
    const error = new Error(`External API ${new URL(url).hostname}: HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response.status === 204 ? {} : response.json();
}

export function requireSameOrigin(request, env) {
  if (request.headers.get('origin') !== new URL(env.APP_URL).origin) {
    throw new HttpError(403, 'คำขอไม่ได้มาจากหน้าเว็บนี้');
  }
}
