/**
 * Guardrail: no two expo-router route files may resolve to the same URL.
 *
 * Route groups like `(admin)` add no URL segment, so `app/(admin)/bounty/[id]`
 * silently shadowed `app/bounty/[id]` in production — every bounty
 * notification tap opened the admin console (admins) or bounced to the feed
 * (everyone else). expo-router only throws for this in some configurations,
 * so enforce it here. See GitHub #809 / #812.
 */
import fs from 'fs';
import path from 'path';

const APP_DIR = path.resolve(__dirname, '../../app');
const ROUTE_EXT = /\.(tsx|ts|jsx|js)$/;
// Directories under app/ that hold shared code rather than routes.
const NON_ROUTE_DIRS = new Set(['components', 'hooks', 'services']);

function walk(dir: string, rel: string[] = []): string[][] {
  const out: string[][] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (rel.length === 0 && NON_ROUTE_DIRS.has(entry.name)) continue;
      out.push(...walk(path.join(dir, entry.name), [...rel, entry.name]));
    } else if (ROUTE_EXT.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      out.push([...rel, entry.name]);
    }
  }
  return out;
}

/** URL a route file answers, or null for layouts / API / non-route files. */
function urlFor(parts: string[]): string | null {
  const file = parts[parts.length - 1].replace(ROUTE_EXT, '');
  if (file.startsWith('_') || file.includes('+api') || file.startsWith('+')) return null;
  // Platform-specific variants (foo.web.tsx) intentionally share a URL.
  if (/\.(ios|android|web|native)$/.test(file)) return null;
  const segments = [...parts.slice(0, -1), file]
    .filter((seg) => !(seg.startsWith('(') && seg.endsWith(')')))
    .map((seg) => seg.replace(/^\[\.\.\.[^\]]+\]$/, '*').replace(/^\[[^\]]+\]$/, ':param'));
  if (segments[segments.length - 1] === 'index') segments.pop();
  return '/' + segments.join('/');
}

describe('expo-router route URLs', () => {
  it('has no two route files answering the same URL', () => {
    const byUrl = new Map<string, string[]>();
    for (const parts of walk(APP_DIR)) {
      const url = urlFor(parts);
      if (!url) continue;
      byUrl.set(url, [...(byUrl.get(url) ?? []), parts.join('/')]);
    }
    const collisions = [...byUrl.entries()].filter(([, files]) => files.length > 1);
    expect(collisions).toEqual([]);
  });

  it('keeps the public bounty entry point and the admin console on distinct URLs', () => {
    expect(fs.existsSync(path.join(APP_DIR, 'bounty/[id]/index.tsx'))).toBe(true);
    expect(fs.existsSync(path.join(APP_DIR, '(admin)'))).toBe(false);
    expect(fs.existsSync(path.join(APP_DIR, 'admin/bounty/[id]/index.tsx'))).toBe(true);
  });
});
