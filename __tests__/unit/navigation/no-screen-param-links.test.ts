/**
 * Guard for SBA-12: nothing may link into the tab shell with `screen`.
 * expo-router strips that param on every platform, so the link silently lands
 * on the Home feed. Use `tab` (bountyAppTabPath in
 * lib/navigation/bounty-app-tab.ts).
 */

import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../../..');
const SOURCE_DIRS = ['app', 'components', 'hooks', 'lib', 'providers', 'supabase/functions'];
const PATTERNS = [
  /bounty-app\?screen=/, // '/tabs/bounty-app?screen=wallet'
  /BOUNTY_APP\}\?screen=/, // `${ROUTES.TABS.BOUNTY_APP}?screen=…`
  /params:\s*\{\s*screen\s*:/, // { pathname: BOUNTY_APP, params: { screen: … } }
];

function sourceFiles(dir: string): string[] {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap(entry => {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sourceFiles(rel);
    return /\.(ts|tsx|js|jsx)$/.test(entry.name) ? [rel] : [];
  });
}

describe('links into the tab shell', () => {
  it('never name the tab with `screen`', () => {
    const offenders: string[] = [];
    for (const file of SOURCE_DIRS.flatMap(sourceFiles)) {
      const lines = fs.readFileSync(path.join(ROOT, file), 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (PATTERNS.some(p => p.test(line))) offenders.push(`${file}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
