#!/usr/bin/env node
/**
 * Stripe developer workflow for Bounty — TEST MODE ONLY.
 *
 * Reads the Stripe test key and Supabase credentials from a local, git-ignored
 * env file (.env.staging by default) and refuses to run with anything that is
 * not a test-mode key or that points at the production Supabase project.
 * Secrets are passed to child processes through environment variables, never
 * on the command line, and are never printed.
 *
 *   node scripts/stripe-dev.mjs whoami                 which Stripe account + Supabase project
 *   node scripts/stripe-dev.mjs endpoints              webhook endpoints and their event coverage
 *   node scripts/stripe-dev.mjs cli <stripe args...>   any Stripe CLI command with the test key
 *   node scripts/stripe-dev.mjs trigger <event> [...]  stripe trigger (test fixtures)
 *   node scripts/stripe-dev.mjs listen                 stream test events to the terminal (no forwarding)
 *   node scripts/stripe-dev.mjs logs                   stream test-mode API request logs
 *   node scripts/stripe-dev.mjs serve-webhooks         run supabase/functions/webhooks LOCALLY under Deno,
 *                                                      with `stripe listen` forwarding platform AND Connect
 *                                                      events to it (signature-verified with the listen secret)
 *   node scripts/stripe-dev.mjs reconcile [--days 30]  read-only: Stripe PaymentIntents vs bounty_payments /
 *                                                      wallet_transactions; exits 1 on any discrepancy
 *
 * Options: --env staging|development (default staging)
 *
 * See docs/payments/STRIPE_DEV_WORKFLOW.md.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PRODUCTION_SUPABASE_REF = 'xwlwqzzphmmhghiqvkeu';
const ENV_FILES = { staging: '.env.staging', development: '.env.development' };

// ── args ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
function takeOption(name, fallback) {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = argv[i + 1];
  argv.splice(i, 2);
  return v;
}
const envName = takeOption('env', 'staging');
const days = Number(takeOption('days', '30'));
// Deno.serve() under `deno run` always binds :8000.
const port = 8000;
const [command, ...rest] = argv;

function die(msg) {
  console.error(`stripe-dev: ${msg}`);
  process.exit(2);
}

// ── env loading + guards ────────────────────────────────────────────────────
function loadEnv(name) {
  const file = ENV_FILES[name];
  if (!file) die(`unknown --env "${name}" (use staging or development)`);
  const full = join(ROOT, file);
  if (!existsSync(full)) die(`${file} not found — copy ${file}.example and fill it in`);
  const out = {};
  for (const line of readFileSync(full, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    out[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  const key = out.STRIPE_SECRET_KEY ?? '';
  if (!/^(sk|rk)_test_/.test(key)) {
    die(`${file} STRIPE_SECRET_KEY is not a test-mode key — refusing (this tool never touches live mode)`);
  }
  const ref = (out.SUPABASE_URL ?? '').match(/https:\/\/([a-z0-9]+)\./)?.[1] ?? null;
  if (ref === PRODUCTION_SUPABASE_REF) {
    die(`${file} SUPABASE_URL points at the PRODUCTION project — refusing`);
  }
  return { file, key, ref, env: out };
}

const cfg = command && command !== 'help' ? loadEnv(envName) : null;

function run(cmd, args, extraEnv = {}, opts = {}) {
  return spawn(cmd, args, {
    stdio: opts.stdio ?? 'inherit',
    shell: process.platform === 'win32', // stripe/deno are .cmd/.exe shims on Windows
    env: { ...process.env, MSYS_NO_PATHCONV: '1', ...extraEnv },
    cwd: opts.cwd ?? ROOT,
  });
}

function stripe(args, opts = {}) {
  return run('stripe', args, { STRIPE_API_KEY: cfg.key }, opts);
}

function wait(child) {
  return new Promise(resolve => child.on('exit', code => resolve(code ?? 1)));
}

async function stripeApi(path, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`https://api.stripe.com${path}${qs ? `?${qs}` : ''}`, {
    headers: { Authorization: `Bearer ${cfg.key}` },
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`Stripe ${path}: ${body?.error?.message ?? res.status}`);
  return body;
}

async function stripeListAll(path, params) {
  const out = [];
  let starting_after;
  for (;;) {
    const page = await stripeApi(path, { limit: '100', ...params, ...(starting_after ? { starting_after } : {}) });
    out.push(...page.data);
    if (!page.has_more || page.data.length === 0) return out;
    starting_after = page.data[page.data.length - 1].id;
  }
}

async function dbSelect(table, query) {
  const url = `${cfg.env.SUPABASE_URL}/rest/v1/${table}?${query}`;
  const key = cfg.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) die(`${cfg.file} has no SUPABASE_SERVICE_ROLE_KEY — reconcile needs read access`);
  const res = await fetch(url, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (!res.ok) throw new Error(`Supabase ${table}: ${res.status} ${await res.text()}`);
  return res.json();
}

// ── commands ────────────────────────────────────────────────────────────────
async function whoami() {
  const acct = await stripeApi('/v1/account');
  console.log(`env file        ${cfg.file}`);
  console.log(`stripe account  ${acct.id}  (${acct.settings?.dashboard?.display_name ?? acct.business_profile?.name ?? 'unnamed'})  TEST MODE`);
  console.log(`supabase ref    ${cfg.ref}`);
}

async function endpoints() {
  const { data } = await stripeApi('/v1/webhook_endpoints', { limit: '100' });
  const needed = [
    'payment_intent.succeeded', 'payment_intent.payment_failed', 'payment_intent.canceled',
    'payment_intent.amount_capturable_updated', 'charge.refunded', 'refund.created', 'refund.updated',
    'refund.failed', 'charge.dispute.created', 'charge.dispute.closed', 'checkout.session.completed',
    'account.updated', 'transfer.created', 'transfer.reversed', 'payout.created', 'payout.paid',
    'payout.failed', 'payout.canceled',
  ];
  for (const e of data) {
    const all = e.enabled_events.includes('*');
    const missing = all ? [] : needed.filter(n => !e.enabled_events.includes(n));
    console.log(`${e.id}  ${e.status.padEnd(8)}  connect=${Boolean(e.connect)}  ${e.url}`);
    console.log(`   api_version=${e.api_version ?? '(account default)'}  events=${all ? '*' : e.enabled_events.length}`);
    if (missing.length) console.log(`   NOT subscribed to: ${missing.join(', ')}`);
  }
  if (!data.some(e => e.connect)) {
    console.log('\nNo Connect endpoint: account.updated / transfer.* / payout.* from connected accounts reach NO deployed handler in this environment.');
  }
}

async function serveWebhooks() {
  if (!cfg.env.SUPABASE_URL || !cfg.env.SUPABASE_SERVICE_ROLE_KEY) {
    die(`${cfg.file} needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY for the local function`);
  }
  // 1. The listen session's own signing secret (stable per device+account).
  const secretProc = stripe(['listen', '--print-secret'], { stdio: ['ignore', 'pipe', 'inherit'] });
  let secret = '';
  secretProc.stdout.on('data', d => (secret += d.toString()));
  if ((await wait(secretProc)) !== 0) die('stripe listen --print-secret failed');
  secret = secret.trim();
  if (!secret.startsWith('whsec_')) die('could not obtain a listen signing secret');

  console.log(`[stripe-dev] local webhooks → ${cfg.ref} database (${envName}); Stripe ${cfg.file} test account`);
  console.log('[stripe-dev] NOTE: the deployed function also receives these events; the claim lease');
  console.log('[stripe-dev]       (claim_stripe_event) guarantees only one of them processes each event.');

  // 2. The real edge function under Deno. Debug: set DENO_INSPECT=1 and attach VS Code.
  const denoArgs = ['run', '-A', '--config', 'supabase/functions/deno.json'];
  if (process.env.DENO_INSPECT) denoArgs.push('--inspect-wait=127.0.0.1:9229');
  denoArgs.push('supabase/functions/webhooks/index.ts');
  const fn = run('deno', denoArgs, {
    SUPABASE_URL: cfg.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: cfg.env.SUPABASE_SERVICE_ROLE_KEY,
    STRIPE_SECRET_KEY: cfg.key,
    // Only the listen secret: anything not signed by this CLI session is rejected.
    STRIPE_WEBHOOK_SECRET: secret,
    STRIPE_CONNECT_WEBHOOK_SECRET: '',
    STRIPE_WEBHOOK_SECRET_SECONDARY: '',
  });

  // 3. Forward platform + Connect events to it.
  const target = `http://localhost:${port}/webhooks`;
  const listen = stripe(['listen', '--forward-to', target, '--forward-connect-to', target]);

  // On Windows the children run through a shell, so kill() would only end the
  // shell and leave deno/stripe running — take down the whole tree.
  const killTree = child => {
    if (child.exitCode !== null || !child.pid) return;
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      child.kill();
    }
  };
  const stop = () => {
    killTree(listen);
    killTree(fn);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  const code = await Promise.race([wait(fn), wait(listen)]);
  stop();
  process.exit(code);
}

/** Expected bounty_payments.status for each PaymentIntent status. */
const BP_STATUS_FOR_PI = {
  succeeded: ['captured', 'released', 'refund_pending', 'refunded', 'disputed'],
  requires_capture: ['authorized'],
  canceled: ['canceled', 'failed', 'pending_payment'],
  requires_payment_method: ['pending_payment', 'failed', 'canceled'],
  requires_confirmation: ['pending_payment'],
  requires_action: ['pending_payment'],
  processing: ['pending_payment'],
};

async function reconcile() {
  const since = Math.floor(Date.now() / 1000) - days * 86400;
  const pis = await stripeListAll('/v1/payment_intents', { 'created[gte]': String(since) });
  const findings = [];
  const flag = (kind, pi, detail) => findings.push({ kind, pi, detail });
  let checked = 0;

  for (const pi of pis) {
    const purpose = pi.metadata?.purpose;
    if (purpose === 'wallet_deposit') {
      checked++;
      const rows = await dbSelect(
        'wallet_transactions',
        `select=id,amount,status,type,user_id&stripe_payment_intent_id=eq.${pi.id}`
      );
      if (pi.status === 'succeeded' && rows.length === 0) flag('deposit_not_credited', pi.id, `$${pi.amount / 100} succeeded in Stripe, no wallet row`);
      if (pi.status !== 'succeeded' && rows.some(r => r.status === 'completed')) flag('credited_without_payment', pi.id, `Stripe status ${pi.status}, wallet row completed`);
      for (const r of rows) {
        if (Math.round(Number(r.amount) * 100) !== pi.amount) flag('deposit_amount_mismatch', pi.id, `Stripe ${pi.amount}¢ vs wallet ${r.amount}`);
        if (pi.metadata?.user_id && r.user_id !== pi.metadata.user_id) flag('deposit_user_mismatch', pi.id, `metadata user ${pi.metadata.user_id} vs row ${r.user_id}`);
      }
      if (rows.length > 1) flag('duplicate_deposit_rows', pi.id, `${rows.length} wallet rows`);
    } else if (purpose === 'bounty_escrow') {
      checked++;
      const rows = await dbSelect(
        'bounty_payments',
        `select=id,bounty_id,amount,status&stripe_payment_intent_id=eq.${pi.id}`
      );
      if (rows.length === 0) {
        if (['succeeded', 'requires_capture'].includes(pi.status)) flag('escrow_payment_without_row', pi.id, `Stripe ${pi.status} $${pi.amount / 100}, no bounty_payments row`);
        continue;
      }
      if (rows.length > 1) flag('duplicate_escrow_rows', pi.id, `${rows.length} bounty_payments rows`);
      for (const r of rows) {
        if (Math.round(Number(r.amount) * 100) !== pi.amount) flag('escrow_amount_mismatch', pi.id, `Stripe ${pi.amount}¢ vs bounty_payments ${r.amount}`);
        const ok = BP_STATUS_FOR_PI[pi.status];
        if (ok && !ok.includes(r.status)) flag('escrow_status_mismatch', pi.id, `Stripe ${pi.status} vs bounty_payments ${r.status} (bounty ${r.bounty_id})`);
      }
    }
  }

  // Reverse direction: rows that claim money we hold, whose PI is not succeeded.
  const sinceIso = new Date(since * 1000).toISOString();
  const held = await dbSelect(
    'bounty_payments',
    `select=id,bounty_id,status,stripe_payment_intent_id&status=in.(captured,released)&created_at=gte.${sinceIso}`
  );
  const byId = new Map(pis.map(p => [p.id, p]));
  for (const r of held) {
    if (!r.stripe_payment_intent_id) {
      flag('captured_row_without_pi', r.id, `bounty ${r.bounty_id} is ${r.status} with no PaymentIntent`);
      continue;
    }
    const pi = byId.get(r.stripe_payment_intent_id) ?? (await stripeApi(`/v1/payment_intents/${r.stripe_payment_intent_id}`).catch(() => null));
    if (!pi) flag('row_pi_missing_in_stripe', r.stripe_payment_intent_id, `bounty ${r.bounty_id} ${r.status}`);
    else if (pi.status !== 'succeeded') flag('row_captured_but_pi_not_succeeded', pi.id, `bounty_payments ${r.status}, Stripe ${pi.status}`);
  }

  console.log(`reconcile ${cfg.file} (${cfg.ref}) — last ${days} days`);
  console.log(`  Stripe PaymentIntents: ${pis.length}  (Bounty-tagged checked: ${checked}; untagged ignored)`);
  console.log(`  bounty_payments captured/released rows checked: ${held.length}`);
  if (findings.length === 0) {
    console.log('  ✓ no discrepancies');
    return 0;
  }
  console.log(`  ✗ ${findings.length} discrepanc${findings.length === 1 ? 'y' : 'ies'} (read-only; nothing was changed):`);
  for (const f of findings) console.log(`    ${f.kind.padEnd(34)} ${f.pi}  ${f.detail}`);
  return 1;
}

// ── dispatch ────────────────────────────────────────────────────────────────
const commands = {
  whoami,
  endpoints,
  reconcile,
  'serve-webhooks': serveWebhooks,
  cli: () => wait(stripe(rest)),
  trigger: () => wait(stripe(['trigger', ...rest])),
  listen: () => wait(stripe(['listen', ...rest])),
  logs: () => wait(stripe(['logs', 'tail', ...rest])),
};

if (!command || command === 'help' || !commands[command]) {
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0].replace(/^#!.*\n\/\*\*?/, ''));
  process.exit(command && command !== 'help' ? 2 : 0);
}

Promise.resolve(commands[command]())
  .then(code => process.exit(typeof code === 'number' ? code : 0))
  .catch(err => {
    console.error(`stripe-dev: ${err.message}`);
    process.exit(1);
  });
