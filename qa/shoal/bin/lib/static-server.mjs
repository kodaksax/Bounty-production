/**
 * Request resolution for the static-export server (bin/serve.mjs).
 *
 * Extracted so it can be unit-tested. The rule it encodes is not cosmetic: an SPA
 * fallback that answers ASSET requests with index.html makes the browser evaluate HTML as
 * JavaScript. In an expo-router app that surfaces as
 *
 *     Cannot destructure property 'ErrorBoundary' of 'undefined' as it is undefined
 *
 * on the next navigation, with a dead "Try Again" button -- indistinguishable from a
 * catastrophic application bug, and duly reported as one by two swarm agents before the
 * cause was traced back to the harness. Assets that miss must 404.
 */
import { existsSync, statSync } from 'node:fs';
import path, { extname } from 'node:path';

/**
 * A navigation is a top-level document request. `Sec-Fetch-Mode: navigate` is the precise
 * signal in Chromium; the extension/Accept check is the fallback for clients that omit it.
 */
export function isNavigationRequest(req) {
  const headers = req.headers ?? {};
  if (headers['sec-fetch-mode'] === 'navigate') return true;
  if (headers['sec-fetch-dest'] === 'document') return true;
  const path = (req.url || '/').split('?')[0];
  const ext = extname(path).toLowerCase();
  return (ext === '' || ext === '.html') && String(headers.accept || '').includes('text/html');
}

/**
 * Resolve a request path against a static export.
 *
 * Order: exact file -> `<route>.html` -> `<route>/index.html` -> (navigations only) the
 * SPA shell, so client-side-only routes such as /screens/CreateBounty still work.
 * Returns null when nothing matches, which the caller must turn into a 404.
 *
 * `fs` is injectable purely so tests can describe an export tree without touching disk.
 */
export function resolveFile(outDir, urlPath, isNavigation, fs = { existsSync, statSync }, p = path) {
  let clean;
  try {
    clean = decodeURIComponent(String(urlPath).split('?')[0].split('#')[0]);
  } catch {
    return null; // malformed percent-encoding
  }
  const rel = p.normalize(clean).replace(/^([/\\])+/, '');

  // Containment, not string-matching, is the real property: `path.normalize` behaves
  // differently per platform (win32 clamps '/../x' to '\x' while posix keeps '../x', so a
  // `.includes('..')` check fires on one and not the other), so verify every candidate
  // actually resolves inside outDir. `p` is injectable so both implementations are
  // testable from a single CI runner -- see test/static-server.test.mjs.
  const root = p.resolve(outDir);
  const within = (candidate) => {
    const abs = p.resolve(candidate);
    return abs === root || abs.startsWith(root + p.sep);
  };

  const isFile = (candidate) => within(candidate) && fs.existsSync(candidate) && fs.statSync(candidate).isFile();
  for (const c of [p.join(outDir, rel), p.join(outDir, rel + '.html'), p.join(outDir, rel, 'index.html')]) {
    if (isFile(c)) return c;
  }
  if (isNavigation) {
    const index = p.join(outDir, 'index.html');
    if (isFile(index)) return index;
  }
  return null;
}

export const MIME = {
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

export function mimeFor(file) {
  return MIME[extname(file).toLowerCase()] ?? 'application/octet-stream';
}
