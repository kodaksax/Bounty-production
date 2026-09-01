#!/usr/bin/env node
/**
 * Serve the Bounty web app for a Shoal swarm to attack.
 *
 * Default path is a STATIC EXPORT (`expo export --platform web`) served by a small file
 * server, rather than the Metro dev server, for three reasons:
 *
 *  1. `expo start --web` is not reliable here: on Windows it crashes with EMFILE during
 *     source-map generation for the static-render bundle after ~8 minutes of bundling.
 *     The export path does not generate those source maps and completes.
 *  2. A swarm of N browsers all pulling a dev bundle makes Metro the bottleneck and adds
 *     rebuild noise to findings. A pre-built export is served in milliseconds.
 *  3. It is what CI can cache and re-serve, so local and CI runs test the same bytes.
 *
 * The app is configured `web.output: "static"` (app.json), so the export contains a real
 * .html per route plus the client bundle; the fallback below keeps client-side routing
 * working for routes that were not prerendered.
 *
 *   node qa/shoal/bin/serve.mjs [--port 8090] [--app-env staging] [--skip-build]
 *                               [--max-workers <n>] [--no-ssg] [--dev]
 */
import { spawnSync } from 'node:child_process';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { loadConfig, REPO_ROOT, shoalHome } from './lib/env.mjs';

const argv = process.argv.slice(2);
const has = (f) => argv.includes('--' + f);
const opt = (f, fallback) => {
  const i = argv.indexOf('--' + f);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const config = loadConfig();
const port = Number(opt('port', '8090'));
const appEnv = opt('app-env', process.env.APP_ENV || 'staging');

if (has('dev')) {
  // Escape hatch: the Metro dev server, for iterating on the app itself.
  const r = spawnSync(
    'npx',
    ['expo', 'start', '--web', '--port', String(port)],
    { cwd: REPO_ROOT, stdio: 'inherit', shell: true, env: { ...process.env, APP_ENV: appEnv } },
  );
  process.exit(r.status ?? 0);
}

const outDir = join(shoalHome(config), 'web-export');

if (!has('skip-build')) {
  console.log('\n  exporting the web app (APP_ENV=' + appEnv + ') -> ' + outDir);
  console.log('  first run bundles the whole graph and takes several minutes.\n');
  // --source-maps defaults to false for `expo export`, which is what keeps this off the
  // code path that crashes `expo start --web` with EMFILE here. --max-workers lowers the
  // bundler's file-handle pressure further if a machine still hits it.
  const exportArgs = ['expo', 'export', '--platform', 'web', '--output-dir', outDir, '--clear'];
  const maxWorkers = opt('max-workers');
  if (maxWorkers) exportArgs.push('--max-workers', maxWorkers);
  if (has('no-ssg')) exportArgs.push('--no-ssg');

  const r = spawnSync('npx', exportArgs, {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, APP_ENV: appEnv },
  });
  if (r.status !== 0) {
    console.error('\n  expo export failed. Serve an existing export with --skip-build.\n');
    process.exit(r.status ?? 1);
  }
}

if (!existsSync(join(outDir, 'index.html'))) {
  console.error('\n  No export at ' + outDir + '. Drop --skip-build to build one.\n');
  process.exit(1);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

/** Resolve a request path against a static export: file, route.html, route/index.html, SPA root. */
function resolveFile(urlPath) {
  const clean = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  // Refuse to escape the export directory.
  const rel = normalize(clean).replace(/^([/\\])+/, '');
  if (rel.includes('..')) return null;

  const candidates = [
    join(outDir, rel),
    join(outDir, rel + '.html'),
    join(outDir, rel, 'index.html'),
    join(outDir, 'index.html'),
  ];
  for (const c of candidates) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

createServer((req, res) => {
  const file = resolveFile(req.url || '/');
  if (!file) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
    return;
  }
  res.writeHead(200, {
    'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'cache-control': 'no-store',
  });
  createReadStream(file).pipe(res);
}).listen(port, () => {
  console.log('\n  Bounty web app (static export, APP_ENV=' + appEnv + ')');
  console.log('  serving ' + outDir);
  console.log('  http://localhost:' + port + '\n');
  console.log('  Now, in another terminal:  npm run qa:shoal:smoke\n');
});
