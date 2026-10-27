/**
 * Guard: nothing re-enters the tab shell (app/tabs/bounty-app.tsx) while it
 * is mounted underneath. `router.push` to it stacks a second shell — feed
 * scrolled to the top, filters reset, a stale copy left below — and
 * `router.replace` to it does the same from any screen opened over the
 * shell. Go back to it with useReturnToTabShell
 * (lib/navigation/tab-shell-return.ts) instead.
 */

import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../../..');
const SOURCE_DIRS = ['app', 'components', 'hooks', 'lib', 'providers'];
const SHELL_LINK = /(push|replace|navigate)\(.*(bounty-app|BOUNTY_APP)/;

// Where a replace into the shell is right: no shell is mounted yet (the auth
// and onboarding gates hand over to it), or it follows a canGoBack() check
// that found nothing to pop.
const REPLACE_ALLOWED = new Set([
  'app/auth/sign-in-form.tsx',
  'app/auth/sign-up-form.tsx',
  'app/onboarding/index.tsx',
  'app/onboarding/username.tsx',
  'app/profile/[userId].tsx',
  'app/tabs/search.tsx',
]);

function sourceFiles(dir: string): string[] {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap(entry => {
    const rel = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sourceFiles(rel);
    return /\.(ts|tsx|js|jsx)$/.test(entry.name) ? [rel] : [];
  });
}

describe('links into the mounted tab shell', () => {
  it('never push, navigate or (outside the gates) replace to it', () => {
    const offenders: string[] = [];
    for (const file of SOURCE_DIRS.flatMap(sourceFiles)) {
      const lines = fs.readFileSync(path.join(ROOT, file), 'utf8').split('\n');
      lines.forEach((line, i) => {
        const match = SHELL_LINK.exec(line);
        if (!match) return;
        if (match[1] === 'replace' && REPLACE_ALLOWED.has(file)) return;
        offenders.push(`${file}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
