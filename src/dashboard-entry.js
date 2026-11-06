// Dashboard-only entry point. The packager inlines both virtual modules.
import worker from './worker.js';
import assets from 'archive-static-assets';
import statements from 'archive-schema';
import { ensureDashboardDatabase } from './dashboard-bootstrap.js';
import { json, secure } from './http.js';

function environment(env) {
  return { ...env, ASSETS: {
    async fetch(request) {
      const asset = assets[new URL(request.url).pathname];
      if (!asset || !['GET', 'HEAD'].includes(request.method)) return new Response('Not found', { status: 404 });
      return new Response(request.method === 'HEAD' ? null : asset.body, {
        headers: { 'content-type': asset.type, 'cache-control': 'no-cache' },
      });
    },
  } };
}

export default {
  async fetch(request, env, ctx) {
    try { await ensureDashboardDatabase(env.DB, statements); }
    catch (error) {
      // The setup messages contain no secret values or provider response bodies.
      const known = error.message.startsWith('ยังไม่ได้') || error.message.startsWith('ฐานข้อมูลนี้');
      return secure(json({ error: known ? error.message : 'เตรียมฐานข้อมูลไม่สำเร็จ ตรวจ D1 binding และโควตา แล้วลองใหม่' }, 503));
    }
    return worker.fetch(request, environment(env), ctx);
  },
  async scheduled(controller, env, ctx) {
    await ensureDashboardDatabase(env.DB, statements);
    return worker.scheduled(controller, environment(env), ctx);
  },
};
