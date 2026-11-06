import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { splitSql } from './sql-statements.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const files = [['/index.html', 'index.html', 'text/html; charset=utf-8'],
  ['/styles.css', 'styles.css', 'text/css; charset=utf-8'],
  ['/app.js', 'app.js', 'text/javascript; charset=utf-8']];
const assets = {};
for (const [path, name, type] of files) assets[path] = { body: await readFile(new URL(`../public/${name}`, import.meta.url), 'utf8'), type };
assets['/'] = assets['/index.html'];
const sql = [];
for (const name of ['0001_chat_messages.sql', '0002_runtime.sql', '0003_cleanup_indexes.sql']) {
  sql.push(...splitSql(await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8')));
}
await mkdir(new URL('../release/', import.meta.url), { recursive: true });
await build({
  absWorkingDir: root, entryPoints: ['src/dashboard-entry.js'], outfile: 'release/worker.js',
  bundle: true, format: 'esm', platform: 'browser', target: 'es2022', charset: 'utf8',
  banner: { js: '// LINE Archive — self-contained Cloudflare Dashboard deployment bundle.\n// Generated from src/ and public/. Contains no account credentials.' },
  plugins: [{ name: 'inline-dashboard-assets', setup(api) {
    api.onResolve({ filter: /^archive-(static-assets|schema)$/ }, (args) => ({ path: args.path, namespace: 'archive' }));
    api.onLoad({ filter: /.*/, namespace: 'archive' }, (args) => ({
      contents: `export default ${JSON.stringify(args.path === 'archive-schema' ? sql : assets)};`, loader: 'js',
    }));
  } }],
});
await writeFile(new URL('../release/database.sql', import.meta.url), `${sql.join(';\n\n')};\n`);
console.log(`Dashboard bundle prepared: release/worker.js (${sql.length} automatic initialization statements)`);
