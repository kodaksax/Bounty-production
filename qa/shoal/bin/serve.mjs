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
import { createReadStream, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { loadConfig, REPO_ROOT, shoalHome } from './lib/env.mjs';
import { isNavigationRequest, mimeFor, resolveFile } from './lib/static-server.mjs';

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

const server = createServer((req, res) => {
  const navigation = isNavigationRequest(req);
  const file = resolveFile(outDir, req.url || '/', navigation);
  if (!file) {
    // Log asset misses loudly: silently 404ing a chunk produces a blank app, and a
    // swarm will report that as a product bug rather than a harness one.
    if (!navigation) console.warn('  404 asset: ' + req.url);
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
    return;
  }
  res.writeHead(200, {
    'content-type': mimeFor(file),
    'cache-control': 'no-store',
  });
  createReadStream(file).pipe(res);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      '\n  Port ' + port + ' is already in use -- most likely an earlier qa:shoal:web that was\n' +
        '  backgrounded and never stopped. Free it, or serve elsewhere with --port <n>.\n',
    );
    process.exit(1);
  }
  throw err;
});

server.listen(port, () => {
  console.log('\n  Bounty web app (static export, APP_ENV=' + appEnv + ')');
  console.log('  serving ' + outDir);
  console.log('  http://localhost:' + port + '\n');
  console.log('  Now, in another terminal:  npm run qa:shoal:smoke');
  console.log('  Stop with Ctrl+C (the port is released on exit).\n');
});

// Release the port deterministically instead of relying on the parent shell. Without
// this, a backgrounded server keeps :8090 held after the terminal that started it moves
// on, and the next run fails with EADDRINUSE.
let closing = false;
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => {
    if (closing) return;
    closing = true;
    console.log('\n  ' + sig + ' -- closing the server and releasing port ' + port + '.');
    server.close(() => process.exit(0));
    // Sockets held open by a browser would otherwise keep close() pending forever.
    server.closeAllConnections?.();
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
