/**
 * supabase/functions/_shared/generated/app-rules.js is the app's rules bundled
 * for Edge Functions (scripts/build-web-app-rules.mjs). It must match a fresh
 * build — so a change to lib/my-jobs or the lifecycle reaches the website —
 * and contain only pure modules (the script enforces its allow-list).
 */
import { spawnSync } from 'child_process';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..', '..');

it('the committed app-rules bundle is up to date and pure', () => {
  const run = spawnSync(process.execPath, [join(ROOT, 'scripts/build-web-app-rules.mjs'), '--check'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (run.status !== 0) throw new Error((run.stderr || run.stdout || 'bundle check failed').trim());
}, 30000);
