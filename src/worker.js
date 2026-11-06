import { json, secure, HttpError, requireSameOrigin } from './http.js';
import { configuration, ownerSession, requireOwner, startLogin, finishLogin, logout } from './auth.js';
import { webhook } from './line.js';
import { stats, run, setting } from './store.js';
import { drain } from './sync.js';
import { maintain } from './maintenance.js';
import { signObject, readObject } from './crypto.js';

async function wakeSync(env) {
  if (!env.SESSION_SECRET || !await setting(env, 'google_refresh_token')) return;
  const token = await signObject({ purpose: 'internal-drain', exp: Date.now() + 35_000 }, env.SESSION_SECRET);
  const response = await fetch(`${env.APP_URL}/api/internal/drain`, {
    method: 'POST', headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(24_000),
  });
  if (!response.ok) throw new Error('sync_dispatch_failed');
  await response.arrayBuffer();
}

async function route(request, env, ctx) {
  const url = new URL(request.url);
  if (url.pathname === '/webhooks/line' && request.method === 'POST') {
    const result = await webhook(request, env);
    ctx.waitUntil(wakeSync(env).catch(() => console.error('sync_dispatch_failed')));
    return json(result);
  }
  if (url.pathname === '/auth/google' && request.method === 'GET') return startLogin(env);
  if (url.pathname === '/auth/callback' && request.method === 'GET') return finishLogin(request, env);
  if (url.pathname === '/api/internal/drain' && request.method === 'POST') {
    const token = request.headers.get('authorization')?.replace(/^Bearer /, '');
    const signed = await readObject(token, env.SESSION_SECRET);
    if (signed?.purpose !== 'internal-drain') throw new HttpError(401, 'Unauthorized');
    return json(await drain(env));
  }
  if (url.pathname === '/api/status' && request.method === 'GET') {
    const session = await ownerSession(request, env);
    if (!session) return json({ authenticated: false, configuration: configuration(env) });
    return json({ authenticated: true, email: session.email, configuration: configuration(env),
      googleConnected: Boolean(await setting(env, 'google_refresh_token')),
      maintenanceError: await setting(env, 'maintenance_error'), setupError: await setting(env, 'setup_error'), ...await stats(env) });
  }
  if (url.pathname === '/api/retry' && request.method === 'POST') {
    await requireOwner(request, env);
    requireSameOrigin(request, env);
    await run(env, 'UPDATE message_events SET next_attempt_at_ms=0 WHERE sheets_synced_at_ms IS NULL');
    ctx.waitUntil(wakeSync(env).catch(() => console.error('sync_dispatch_failed')));
    return json({ queued: true }, 202);
  }
  if (url.pathname === '/auth/logout' && request.method === 'POST') {
    await requireOwner(request, env);
    requireSameOrigin(request, env);
    return logout(env);
  }
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/') || url.pathname.startsWith('/webhooks/')) {
    throw new HttpError(404, 'ไม่พบเส้นทางนี้');
  }
  return env.ASSETS.fetch(request);
}

export default {
  async fetch(request, env, ctx) {
    env = { ...env, _budget: { sql: 0 } };
    try { return secure(await route(request, env, ctx)); }
    catch (error) {
      if (!(error instanceof HttpError)) {
        // Do not log webhook contents, OAuth responses, emails or credentials.
        console.error(JSON.stringify({ type: 'request_failed', path: new URL(request.url).pathname }));
      }
      return secure(json({ error: error instanceof HttpError ? error.message : 'ระบบทำงานไม่สำเร็จ กรุณาลองใหม่' }, error.status && error instanceof HttpError ? error.status : 500));
    }
  },
  async scheduled(_controller, env, ctx) {
    env = { ...env, _budget: { sql: 0 } };
    ctx.waitUntil((async () => {
      if (!env.SESSION_SECRET || !await setting(env, 'google_refresh_token')) return;
      // Separate invocations keep each small batch below Workers Free D1 query limits.
      const end = Date.now() + 24_000;
      for (let i = 0; i < 6 && Date.now() < end; i++) {
        const token = await signObject({ purpose: 'internal-drain', exp: Date.now() + 35_000 }, env.SESSION_SECRET);
        const response = await fetch(`${env.APP_URL}/api/internal/drain`, {
          method: 'POST', headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(24_000),
        });
        if (!response.ok) break;
        const result = await response.json();
        if (!result.processed || result.busy) break;
      }
      await maintain(env);
    })().catch(() => console.error('scheduled_job_failed')));
  },
};
