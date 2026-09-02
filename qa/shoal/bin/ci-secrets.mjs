#!/usr/bin/env node
/**
 * Inventory and upload the GitHub Actions secrets that .github/workflows/shoal.yml needs.
 *
 * Setting eleven secrets by hand means eleven chances to paste the wrong value into the
 * wrong name -- and one of them is a service-role key. This reads each value from the
 * place it already lives (`.env.staging`, your shell) and pipes it straight into
 * `gh secret set`, so no secret is ever displayed, logged, or put on a clipboard.
 *
 *   node qa/shoal/bin/ci-secrets.mjs list            # what is needed, what resolves (masked)
 *   node qa/shoal/bin/ci-secrets.mjs set --dry-run   # the exact gh commands, no values
 *   node qa/shoal/bin/ci-secrets.mjs set             # upload them
 *
 * Nothing here writes a secret to disk.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, expectedRefForAppEnv, REPO_ROOT } from './lib/env.mjs';

const argv = process.argv.slice(2);
const cmd = argv.find((a) => !a.startsWith('--')) ?? 'list';
const has = (f) => argv.includes('--' + f);
const opt = (f, fallback) => {
  const i = argv.indexOf('--' + f);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

if (!['list', 'set'].includes(cmd)) {
  console.error('  Usage: node qa/shoal/bin/ci-secrets.mjs <list|set> [--repo owner/name] [--dry-run]');
  process.exit(1);
}

const config = loadConfig();
const STAGING_REF = expectedRefForAppEnv('staging');

/** Read a KEY=value out of an env file without importing dotenv or mutating process.env. */
function fromEnvFile(file, key) {
  const p = join(REPO_ROOT, file);
  if (!existsSync(p)) return undefined;
  const line = readFileSync(p, 'utf8')
    .split(/\r?\n/)
    .find((l) => l.startsWith(key + '='));
  if (!line) return undefined;
  const v = line.slice(key.length + 1).trim().replace(/^["']|["']$/g, '');
  return v || undefined;
}

/**
 * The staging Postgres URL in pooler form.
 *
 * `.env.staging`'s DATABASE_URL points at db.<ref>.supabase.co, which Supabase has
 * retired and which no longer resolves. The password in it is still correct, so rebuild
 * the working URL around it rather than asking anyone to retype a password.
 */
function stagingDatabaseUrl() {
  const explicit = process.env.BOUNTY_SHOAL_DATABASE_URL;
  if (explicit) return explicit;
  const raw = fromEnvFile('.env.staging', 'DATABASE_URL');
  if (!raw) return undefined;
  let password;
  try {
    password = decodeURIComponent(new URL(raw).password);
  } catch {
    return undefined;
  }
  // A placeholder is not a password. Uploading one produces a secret that fails at
  // runtime in CI, which is far more expensive to diagnose than a missing secret.
  if (!password || /^[<{].*[>}]$/.test(password) || /PASSWORD|CHANGEME|TODO/i.test(password)) {
    return undefined;
  }
  // If the file names a different project than staging, its password is not staging's --
  // pairing it with the staging ref would build a URL that authenticates against nothing.
  const named = raw.match(/([a-z]{20})\.supabase\.co/);
  if (named && named[1] !== STAGING_REF) return undefined;
  const region = process.env.BOUNTY_SHOAL_DB_REGION || 'aws-1-us-east-2';
  return (
    'postgresql://postgres.' + STAGING_REF + ':' + encodeURIComponent(password) +
    '@' + region + '.pooler.supabase.com:5432/postgres'
  );
}

const SECRETS = [
  {
    name: 'SHOAL_ANTHROPIC_API_KEY',
    why: 'Drives the swarm. CI cannot use --provider subscription (that needs a Claude Code login on the runner).',
    source: 'ANTHROPIC_API_KEY in your shell, or console.anthropic.com',
    value: () => process.env.ANTHROPIC_API_KEY || process.env.SHOAL_ANTHROPIC_API_KEY,
    secret: true,
  },
  {
    name: 'SHOAL_STAGING_SUPABASE_URL',
    why: 'Baked into the web export the swarm attacks.',
    source: '.env.staging EXPO_PUBLIC_SUPABASE_URL',
    value: () => fromEnvFile('.env.staging', 'EXPO_PUBLIC_SUPABASE_URL'),
    secret: false,
  },
  {
    name: 'SHOAL_STAGING_SUPABASE_ANON_KEY',
    why: 'Baked into the web export.',
    source: '.env.staging SUPABASE_ANON_KEY',
    value: () => fromEnvFile('.env.staging', 'SUPABASE_ANON_KEY'),
    secret: true,
  },
  {
    name: 'SHOAL_STAGING_STRIPE_PUBLISHABLE_KEY',
    why: 'Baked into the export. MUST be pk_test_ -- the guard refuses a live key.',
    source: '.env.staging EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY',
    value: () => fromEnvFile('.env.staging', 'EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY'),
    secret: true,
    check: (v) => (v.startsWith('pk_test_') ? null : 'NOT a test key -- refusing to upload'),
  },
  {
    name: 'SHOAL_STAGING_SERVICE_ROLE_KEY',
    why: 'seed.mjs creates the test auth users with it.',
    source: '.env.staging SUPABASE_SERVICE_ROLE_KEY',
    value: () => fromEnvFile('.env.staging', 'SUPABASE_SERVICE_ROLE_KEY'),
    secret: true,
  },
  {
    name: 'SHOAL_STAGING_DATABASE_URL',
    why: 'Oracles + seeding. Pooler form -- the direct host is dead.',
    source: 'rebuilt from .env.staging DATABASE_URL (password reused, host corrected)',
    value: stagingDatabaseUrl,
    secret: true,
    check: (v) =>
      v.includes(STAGING_REF) ? null : 'does not name the staging project ' + STAGING_REF,
  },
  {
    name: 'SHOAL_TEST_EMAIL',
    why: 'Poster-side test account.',
    source: 'BOUNTY_SHOAL_TEST_EMAIL (from seed.mjs accounts)',
    value: () => process.env.BOUNTY_SHOAL_TEST_EMAIL,
    secret: false,
  },
  {
    name: 'SHOAL_TEST_PASSWORD',
    why: 'Poster-side test account.',
    source: 'BOUNTY_SHOAL_TEST_PASSWORD (from seed.mjs accounts)',
    value: () => process.env.BOUNTY_SHOAL_TEST_PASSWORD,
    secret: true,
  },
  {
    name: 'SHOAL_HUNTER_EMAIL',
    why: 'Hunter-side test account.',
    source: 'BOUNTY_SHOAL_HUNTER_EMAIL (from seed.mjs accounts)',
    value: () => process.env.BOUNTY_SHOAL_HUNTER_EMAIL,
    secret: false,
  },
  {
    name: 'SHOAL_HUNTER_PASSWORD',
    why: 'Hunter-side test account.',
    source: 'BOUNTY_SHOAL_HUNTER_PASSWORD (from seed.mjs accounts)',
    value: () => process.env.BOUNTY_SHOAL_HUNTER_PASSWORD,
    secret: true,
  },
  {
    name: 'SHOAL_POSTER_ID',
    why: 'Only the race job uses this, and that job is if:false. Set it when you enable race testing.',
    source: 'BOUNTY_SHOAL_POSTER_ID (from seed.mjs accounts)',
    value: () => process.env.BOUNTY_SHOAL_POSTER_ID,
    secret: false,
    optional: true,
  },
];

const mask = (v, isSecret) =>
  !v ? '' : isSecret ? v.slice(0, 4) + '…(' + v.length + ' chars)' : v;

const resolved = SECRETS.map((s) => {
  const value = s.value();
  const problem = value && s.check ? s.check(value) : null;
  return { ...s, value, problem };
});

if (cmd === 'list') {
  console.log('\n  GitHub Actions secrets for .github/workflows/shoal.yml');
  console.log('  repo: ' + (opt('repo') ?? 'kodaksax/Bounty-production') + '\n');
  for (const s of resolved) {
    const state = s.problem
      ? 'PROBLEM: ' + s.problem
      : s.value
        ? 'ready  ' + mask(s.value, s.secret)
        : s.optional
          ? 'not set (optional)'
          : 'MISSING';
    console.log('  ' + (s.problem || (!s.value && !s.optional) ? '✗' : '✓') + ' ' + s.name);
    console.log('      ' + state);
    console.log('      ' + s.why);
    console.log('      source: ' + s.source + '\n');
  }
  const missing = resolved.filter((s) => !s.value && !s.optional);
  if (missing.length) {
    console.log('  ' + missing.length + ' missing. For the test-account values, run:');
    console.log('    node qa/shoal/bin/seed.mjs accounts --env staging');
    console.log('  then export what it prints and re-run this.\n');
  } else {
    console.log('  All required secrets resolve. Upload them with:');
    console.log('    node qa/shoal/bin/ci-secrets.mjs set\n');
  }
  process.exit(0);
}

// --- set ------------------------------------------------------------------
const repo = opt('repo', 'kodaksax/Bounty-production');

const blocked = resolved.filter((s) => s.problem);
if (blocked.length) {
  console.error('\n  Refusing to upload -- fix these first:\n');
  for (const s of blocked) console.error('    ' + s.name + ': ' + s.problem);
  console.error('');
  process.exit(1);
}
const missing = resolved.filter((s) => !s.value && !s.optional);
if (missing.length && !has('dry-run') && !has('partial')) {
  console.error('\n  Missing required values: ' + missing.map((s) => s.name).join(', '));
  console.error('  Run `node qa/shoal/bin/ci-secrets.mjs list` for where each comes from.');
  console.error('\n  To upload the ones that ARE ready and come back for the rest:');
  console.error('    node qa/shoal/bin/ci-secrets.mjs set --partial\n');
  process.exit(1);
}
if (missing.length && has('partial')) {
  // Deliberate partial upload. Say plainly what the workflow still cannot do, so a
  // half-configured repo is not mistaken for a working one.
  console.warn('\n  --partial: uploading without ' + missing.map((s) => s.name).join(', ') + '.');
  console.warn('  Scenarios needing those secrets will fail until they are set.\n');
}

if (!has('dry-run')) {
  try {
    execFileSync('gh', ['auth', 'status'], { stdio: 'ignore' });
  } catch {
    console.error('\n  gh is not logged in. Run:  gh auth login\n');
    process.exit(1);
  }
}

const upload = resolved.filter((s) => s.value);
console.log('\n  ' + (has('dry-run') ? 'Would upload' : 'Uploading') + ' ' + upload.length + ' secrets to ' + repo + '\n');

for (const s of upload) {
  if (has('dry-run')) {
    console.log('    gh secret set ' + s.name + ' --repo ' + repo + '  < <value from ' + s.source + '>');
    continue;
  }
  // Value goes in on stdin so it never appears in argv, a process list, or shell history.
  const r = spawnSync('gh', ['secret', 'set', s.name, '--repo', repo], {
    input: s.value,
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  console.log('    ' + (r.status === 0 ? '✓' : '✗') + ' ' + s.name);
  if (r.status !== 0) process.exitCode = 1;
}

if (has('dry-run')) {
  console.log('\n  (--dry-run: nothing sent. No values were printed.)\n');
} else {
  console.log('\n  Done. Verify:  gh secret list --repo ' + repo);
  console.log('  Then trigger:  gh workflow run "Shoal swarm QA" --repo ' + repo + ' -f scenario=smoke\n');
}
