// Visual QA only: localhost-only server, no credentials and no external APIs.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, sep } from 'node:path';

const root = fileURLToPath(new URL('../public/', import.meta.url));
let pending = 3;
const groups = [
  { group_id: 'C_example_design', display_name: 'ทีมออกแบบ · ตัวอย่าง', active: 1 },
  { group_id: 'C_example_friends', display_name: 'เพื่อนวันหยุด · ตัวอย่าง', active: 1 },
  { group_id: 'C_example_planning', display_name: 'วางแผนทริป · ตัวอย่าง', active: 1 },
];
createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://127.0.0.1:8788').pathname;
  if (pathname === '/api/status') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      demo: true, authenticated: true, email: 'demo@example.com', configuration: { google: true, line: true },
      googleConnected: true, pending, failed: 0, syncedEvents: 1284, lastSyncAt: Date.now() - 60_000,
      groups: groups.map((g, i) => ({ ...g, pending: i === 0 ? pending : 0, updated_at_ms: Date.now() - (i + 1) * 86400_000 })),
      workbooks: [], indexSpreadsheetId: null, errors: [],
    })); return;
  }
  if (pathname === '/api/retry' && req.method === 'POST') {
    pending = 0;
    res.writeHead(202, { 'content-type': 'application/json' }); res.end('{"queued":true}'); return;
  }
  const path = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
  if (!path.startsWith(root.endsWith(sep) ? root : `${root}${sep}`)) { res.writeHead(403); res.end(); return; }
  try {
    const content = await readFile(path);
    const mime = path.endsWith('.css') ? 'text/css' : path.endsWith('.js') ? 'text/javascript' : 'text/html';
    res.writeHead(200, { 'content-type': `${mime}; charset=utf-8`, 'cache-control': 'no-store' });
    res.end(content);
  } catch { res.writeHead(404); res.end(); }
}).listen(8788, '127.0.0.1', () => console.log('Demo UI (sample data only): http://127.0.0.1:8788'));
