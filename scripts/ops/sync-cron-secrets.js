#!/usr/bin/env node
// Sync the credentials that pg_cron / outbox drains send to edge functions
// with what those functions actually check. Never prints a secret value; only
// SHA-256 prefixes, which are what `supabase secrets list` shows as DIGEST.
//
// Background: 2026-09-13..25 moderation-sweep, expire-bounty-requests and
// process-analytics-person returned 401 on every call. See
// supabase/migrations/20260925120000_job_health_monitoring.sql.
//
// Usage (dry run is the default; nothing is written without --apply):
//   node scripts/ops/sync-cron-secrets.js status
//   node scripts/ops/sync-cron-secrets.js service-role [--apply]
//       Prompts (hidden) for the project's CURRENT secret key
//       (Dashboard > Project Settings > API Keys > Secret keys). Refuses to
//       write unless its SHA-256 equals the edge runtime's
//       SUPABASE_SERVICE_ROLE_KEY digest, then updates vault
//       SUPABASE_SERVICE_ROLE_KEY.
//   node scripts/ops/sync-cron-secrets.js expire [--apply]
//       Generates a fresh random secret and sets it in BOTH places:
//       edge secret EXPIRE_BOUNTY_REQUESTS_CRON_SECRET and vault
//       expire_bounty_requests_cron_secret. Then re-verifies digests.
//
// Options:
//   --project-ref <ref>  (or SUPABASE_PROJECT_REF) target project; defaults to
//                        production. The script refuses to run if DATABASE_URL
//                        does not point at the same project ref.
//   --env-file <path>    (or SYNC_ENV_FILE) file holding DATABASE_URL; defaults
//                        to .env.production (the .env copy points at the wrong
//                        project).
//   TLS: the DB certificate is verified by default. Supabase's pooler presents
//   a certificate signed by Supabase's own root CA, so either point
//   PGSSLROOTCERT at that CA (Dashboard > Database > SSL Configuration >
//   Download certificate) or pass --insecure-tls to encrypt without verifying.

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const dotenv = require('dotenv');
const { Client } = require('pg');

const DEFAULT_PROJECT_REF = 'xwlwqzzphmmhghiqvkeu'; // production (Bounty-expo)
const ROOT = path.resolve(__dirname, '..', '..');

const argv = process.argv.slice(2);
function option(name) {
  const i = argv.indexOf(name);
  if (i === -1) return undefined;
  const value = argv[i + 1];
  argv.splice(i, 2);
  return value;
}
const PROJECT_REF = option('--project-ref') || process.env.SUPABASE_PROJECT_REF || DEFAULT_PROJECT_REF;
const ENV_FILE = path.resolve(ROOT, option('--env-file') || process.env.SYNC_ENV_FILE || '.env.production');
const INSECURE_TLS = argv.includes('--insecure-tls');

// [edge env secret name, vault secret name]
const PAIRS = {
  'service-role': ['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY'],
  expire: ['EXPIRE_BOUNTY_REQUESTS_CRON_SECRET', 'expire_bounty_requests_cron_secret'],
  reconciliation: ['RECONCILIATION_CRON_SECRET', 'reconciliation_cron_secret'],
};

const sha = (v) => crypto.createHash('sha256').update(v, 'utf8').digest('hex');
const short = (d) => (d ? d.slice(0, 12) : '(missing)');

function supabase(args) {
  return execFileSync('npx', ['--no-install', 'supabase', ...args, '--project-ref', PROJECT_REF], {
    cwd: ROOT,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function edgeDigests() {
  const out = supabase(['secrets', 'list']);
  const digests = {};
  for (const line of out.split(/\r?\n/)) {
    const cols = line.split('|').map((c) => c.trim());
    if (cols.length >= 2 && /^[A-Z0-9_]+$/.test(cols[0]) && /^[0-9a-f]{64}$/.test(cols[1])) {
      digests[cols[0]] = cols[1];
    }
  }
  return digests;
}

function tlsConfig() {
  if (INSECURE_TLS) {
    console.warn('WARNING: --insecure-tls: connection is encrypted but the server certificate is NOT verified.');
    return { rejectUnauthorized: false };
  }
  const ca = process.env.PGSSLROOTCERT;
  return ca ? { rejectUnauthorized: true, ca: fs.readFileSync(ca, 'utf8') } : { rejectUnauthorized: true };
}

async function db() {
  const env = dotenv.parse(fs.readFileSync(ENV_FILE));
  if (!env.DATABASE_URL) throw new Error(`DATABASE_URL missing from ${ENV_FILE}`);
  // Guard against a DATABASE_URL for a different project than the one whose
  // edge secrets we are about to compare/write (pooler URLs carry the ref in
  // the username, direct URLs in the host).
  if (!env.DATABASE_URL.includes(PROJECT_REF)) {
    throw new Error(`DATABASE_URL in ${ENV_FILE} does not reference project ${PROJECT_REF}. Refusing.`);
  }
  // Strip sslmode from the URL so it cannot override the TLS policy below.
  const url = new URL(env.DATABASE_URL);
  url.searchParams.delete('sslmode');
  const client = new Client({ connectionString: url.toString(), ssl: tlsConfig() });
  try {
    await client.connect();
  } catch (e) {
    if (/self[- ]signed|unable to verify|certificate/i.test(e.message)) {
      throw new Error(`${e.message}\nSet PGSSLROOTCERT to Supabase's root CA, or pass --insecure-tls.`);
    }
    throw e;
  }
  return client;
}

async function vaultDigest(client, name) {
  const { rows } = await client.query(
    `SELECT encode(extensions.digest(convert_to(decrypted_secret, 'utf8'), 'sha256'), 'hex') AS d
       FROM vault.decrypted_secrets WHERE name = $1`,
    [name]
  );
  return rows[0]?.d ?? null;
}

async function upsertVault(client, name, value) {
  const { rows } = await client.query('SELECT id FROM vault.secrets WHERE name = $1', [name]);
  if (rows[0]) await client.query('SELECT vault.update_secret($1, $2)', [rows[0].id, value]);
  else await client.query('SELECT vault.create_secret($1, $2)', [value, name]);
}

// Hidden input via raw mode (no echo). Non-TTY stdin (a pipe) is read whole,
// so `... service-role --apply < keyfile` also works.
function promptHidden(question) {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    return new Promise((resolve, reject) => {
      let data = '';
      stdin.setEncoding('utf8');
      stdin.on('data', (c) => { data += c; });
      stdin.on('end', () => resolve(data.trim()));
      stdin.on('error', reject);
    });
  }
  return new Promise((resolve, reject) => {
    process.stdout.write(question);
    let answer = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const done = (fn) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
      process.stdout.write('\n');
      fn();
    };
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n' || ch === '\u0004') return done(() => resolve(answer.trim()));
        if (ch === '\u0003') return done(() => reject(new Error('Cancelled.')));
        if (ch === '\u007f' || ch === '\b') answer = answer.slice(0, -1);
        else answer += ch;
      }
    };
    stdin.on('data', onData);
  });
}

async function status(client) {
  const edge = edgeDigests();
  let bad = 0;
  for (const [label, [edgeName, vaultName]] of Object.entries(PAIRS)) {
    const e = edge[edgeName] ?? null;
    const v = await vaultDigest(client, vaultName);
    const ok = e && v && e === v;
    if (!ok) bad++;
    console.log(`${ok ? 'MATCH   ' : 'MISMATCH'} ${label.padEnd(15)} edge ${edgeName}=${short(e)}  vault ${vaultName}=${short(v)}`);
  }
  return bad;
}

async function main() {
  const [cmd, ...flags] = argv;
  const apply = flags.includes('--apply');
  if (!['status', 'service-role', 'expire'].includes(cmd)) {
    console.error('usage: sync-cron-secrets.js status | service-role [--apply] | expire [--apply]\n' +
      '       [--project-ref <ref>] [--env-file <path>] [--insecure-tls]');
    process.exit(2);
  }
  console.log(`Target project: ${PROJECT_REF}${PROJECT_REF === DEFAULT_PROJECT_REF ? ' (production)' : ''}  env: ${path.relative(ROOT, ENV_FILE)}`);
  const client = await db();
  try {
    if (cmd === 'status') {
      process.exitCode = (await status(client)) ? 1 : 0;
      return;
    }

    if (cmd === 'service-role') {
      const edge = edgeDigests()['SUPABASE_SERVICE_ROLE_KEY'];
      if (!edge) throw new Error('edge secret SUPABASE_SERVICE_ROLE_KEY has no digest');
      const key = await promptHidden('Paste the current secret key (input hidden): ');
      const d = sha(key);
      console.log(`candidate=${short(d)}  edge SUPABASE_SERVICE_ROLE_KEY=${short(edge)}  vault=${short(await vaultDigest(client, 'SUPABASE_SERVICE_ROLE_KEY'))}`);
      if (d !== edge) {
        throw new Error('Refusing: that key is not the one the edge functions compare against. Nothing written.');
      }
      if (!apply) { console.log('Dry run: digest matches. Re-run with --apply to write vault SUPABASE_SERVICE_ROLE_KEY.'); return; }
      await upsertVault(client, 'SUPABASE_SERVICE_ROLE_KEY', key);
    }

    if (cmd === 'expire') {
      if (!apply) {
        console.log('Dry run: would generate a new secret and set edge EXPIRE_BOUNTY_REQUESTS_CRON_SECRET + vault expire_bounty_requests_cron_secret.');
        console.log('NOTE: the next expire-stale-bounty-requests run (every 15 min) will then expire the whole backlog.');
        return;
      }
      const secret = crypto.randomBytes(32).toString('hex');
      const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cron-secret-')), '.env');
      try {
        fs.writeFileSync(tmp, `EXPIRE_BOUNTY_REQUESTS_CRON_SECRET=${secret}\n`, { mode: 0o600 });
        supabase(['secrets', 'set', '--env-file', tmp]);
      } finally {
        fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
      }
      await upsertVault(client, 'expire_bounty_requests_cron_secret', secret);
    }

    console.log('Written. Re-verifying:');
    process.exitCode = (await status(client)) ? 1 : 0;
  } finally {
    await client.end();
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
