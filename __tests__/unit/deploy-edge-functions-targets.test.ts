/**
 * The "Determine which functions to deploy" step of
 * .github/workflows/deploy-edge-functions.yml, run for real against a
 * throwaway git repository.
 *
 * Two gaps it guards (2026-10-20 production readiness audit):
 *   1. A push whose deploy failed (e.g. the RLS gate was red) left its
 *      functions undeployed forever: the next push diffed only its own
 *      commits. The step must diff from the last successful deploy.
 *   2. A change under supabase/functions/_shared/ redeployed nothing, so
 *      shared code never reached the functions importing it.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const WORKFLOW = path.join(__dirname, '..', '..', '.github', 'workflows', 'deploy-edge-functions.yml');

/** The step's `run: |` body, de-indented. */
function targetsStepScript(): string {
  const lines = fs.readFileSync(WORKFLOW, 'utf8').split(/\r?\n/);
  const idLine = lines.findIndex((l) => /^\s+id: targets\s*$/.test(l));
  if (idLine < 0) throw new Error('targets step not found');
  const runLine = lines.findIndex((l, i) => i > idLine && /^\s+run: \|\s*$/.test(l));
  const indent = lines[runLine].search(/\S/);
  const body: string[] = [];
  for (let i = runLine + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() && l.search(/\S/) <= indent) break;
    body.push(l);
  }
  const strip = Math.min(...body.filter((l) => l.trim()).map((l) => l.search(/\S/)));
  return body.map((l) => l.slice(strip)).join('\n');
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function write(root: string, rel: string, content: string) {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

function commitAll(root: string, msg: string): string {
  git(root, 'add', '-A');
  git(root, '-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-q', '-m', msg);
  return git(root, 'rev-parse', 'HEAD');
}

/** Run the step as a push event. `lastOk` is what the stubbed `gh api` reports. */
function runStep(root: string, before: string, sha: string, lastOk: string, discovered: string): string {
  const script = targetsStepScript()
    .replace(/\$\{\{ github\.event\.inputs\.functions \}\}/g, '')
    .replace(/\$\{\{ github\.event_name \}\}/g, 'push')
    .replace(/\$\{\{ github\.event\.before \}\}/g, before)
    .replace(/\$\{\{ github\.sha \}\}/g, sha)
    .replace(/\$\{\{ github\.repository \}\}/g, 'owner/repo')
    .replace(/\$\{\{ needs\.verify\.outputs\.functions \}\}/g, discovered);
  expect(script).not.toMatch(/\$\{\{/);
  const out = path.join(root, '.github-output');
  fs.writeFileSync(out, '');
  const file = path.join(root, '.step.sh');
  fs.writeFileSync(file, `set -e\ngh() { echo "${lastOk}"; }\n${script}\n`);
  execFileSync('bash', [file], { cwd: root, encoding: 'utf8', env: { ...process.env, GITHUB_OUTPUT: out } });
  const line = fs.readFileSync(out, 'utf8').split('\n').find((l) => l.startsWith('targets='));
  return (line ?? '').slice('targets='.length).trim().split(/\s+/).filter(Boolean).sort().join(' ');
}

describe('deploy-edge-functions: which functions a push redeploys', () => {
  let root: string;
  let base: string;
  const discovered = 'alpha beta gamma';

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-targets-'));
    git(root, 'init', '-q');
    git(root, 'config', 'core.autocrlf', 'false');
    write(root, 'supabase/functions/_shared/util.ts', 'export const u = 1;\n');
    write(root, 'supabase/functions/_shared/wrapper.ts', "import { u } from './util.ts';\nexport const w = u;\n");
    write(root, 'supabase/functions/alpha/index.ts', "import { u } from '../_shared/util.ts';\n");
    write(root, 'supabase/functions/beta/index.ts', "import { w } from '../_shared/wrapper.ts';\n");
    write(root, 'supabase/functions/gamma/index.ts', 'export {};\n');
    base = commitAll(root, 'base');
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('redeploys only the function directory a push changed', () => {
    write(root, 'supabase/functions/gamma/index.ts', 'export const g = 2;\n');
    const sha = commitAll(root, 'gamma');
    expect(runStep(root, base, sha, base, discovered)).toBe('gamma');
  });

  it('redeploys every importer of a changed _shared module, including through another shared module', () => {
    write(root, 'supabase/functions/_shared/util.ts', 'export const u = 2;\n');
    const sha = commitAll(root, 'shared only');
    expect(runStep(root, base, sha, base, discovered)).toBe('alpha beta');
  });

  it('still ships functions from an earlier push whose deploy failed', () => {
    write(root, 'supabase/functions/alpha/index.ts', "import { u } from '../_shared/util.ts';\nexport const a = u;\n");
    const failedPush = commitAll(root, 'alpha (deploy failed)');
    write(root, 'supabase/functions/gamma/index.ts', 'export const g = 3;\n');
    const sha = commitAll(root, 'gamma');
    // Last successful deploy is `base`, before the failed push.
    expect(runStep(root, failedPush, sha, base, discovered)).toBe('alpha gamma');
  });

  it('falls back to the push diff when the last successful deploy is unknown', () => {
    write(root, 'supabase/functions/alpha/index.ts', 'export const a = 1;\n');
    const first = commitAll(root, 'alpha');
    write(root, 'supabase/functions/gamma/index.ts', 'export const g = 4;\n');
    const sha = commitAll(root, 'gamma');
    expect(runStep(root, first, sha, '', discovered)).toBe('gamma');
  });

  it('drops a function directory that no longer exists', () => {
    write(root, 'supabase/functions/delta/index.ts', 'export {};\n');
    const sha = commitAll(root, 'delta (not in the discovered list)');
    expect(runStep(root, base, sha, base, discovered)).toBe('');
  });
});
