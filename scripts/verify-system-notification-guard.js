#!/usr/bin/env node
/**
 * Verifies supabase/migrations/20261013120000_system_notification_caller_guard.sql
 * against staging, inside ONE transaction that is always rolled back.
 *
 *   node scripts/verify-system-notification-guard.js                 # staging (.env.staging)
 *   node scripts/verify-system-notification-guard.js --insecure-tls  # no Supabase CA locally
 *
 * Exit code 0 only when every check passes.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const ROOT = path.resolve(__dirname, '..');
const MIGRATION = path.join(ROOT, 'supabase/migrations/20261013120000_system_notification_caller_guard.sql');
const ENV = (process.argv.find((a) => a.startsWith('--env=')) || '--env=staging').slice(6);
const INSECURE_TLS = process.argv.includes('--insecure-tls');
if (ENV !== 'staging') {
  console.error('verify-system-notification-guard only runs against staging (it applies DDL inside a transaction).');
  process.exit(2);
}

function candidateUrls() {
  const env = fs.readFileSync(path.join(ROOT, `.env.${ENV}`), 'utf8');
  const m = env.match(/^\s*DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m);
  if (!m) throw new Error(`DATABASE_URL not found in .env.${ENV}`);
  const u = new URL(m[1].trim());
  u.searchParams.delete('sslmode');
  const urls = [u.toString()];
  const ref = u.hostname.match(/^db\.([a-z0-9]+)\.supabase\.co$/)?.[1];
  if (ref) {
    for (const host of ['aws-1-us-east-2.pooler.supabase.com', 'aws-0-us-east-2.pooler.supabase.com']) {
      urls.push(`postgresql://postgres.${ref}:${encodeURIComponent(decodeURIComponent(u.password))}@${host}:5432${u.pathname}`);
    }
  }
  return urls;
}

function tlsConfig() {
  if (INSECURE_TLS) {
    console.warn('WARNING: --insecure-tls: connection is encrypted but the server certificate is NOT verified.');
    return { rejectUnauthorized: false };
  }
  const ca = process.env.PGSSLROOTCERT;
  return ca ? { rejectUnauthorized: true, ca: fs.readFileSync(ca, 'utf8') } : { rejectUnauthorized: true };
}

async function connect() {
  let lastError;
  for (const connectionString of candidateUrls()) {
    const c = new Client({ connectionString, ssl: tlsConfig() });
    try {
      await c.connect();
      return c;
    } catch (err) {
      await c.end().catch(() => {});
      if (/self[- ]signed|unable to verify|certificate/i.test(err.message)) {
        throw new Error(`${err.message}\nSet PGSSLROOTCERT to Supabase's root CA, or pass --insecure-tls.`);
      }
      lastError = err;
    }
  }
  throw lastError;
}

const results = [];
function check(name, ok, info) {
  results.push({ name, ok: !!ok, info });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info !== undefined ? '  -- ' + (typeof info === 'string' ? info : JSON.stringify(info)) : ''}`);
}

async function main() {
  const c = await connect();
  const q = async (sql, params) => (await c.query(sql, params)).rows;
  const one = async (sql, params) => (await q(sql, params))[0];
  let sp = 0;
  const attempt = async (fn) => {
    const name = `sp_${++sp}`;
    await c.query(`SAVEPOINT ${name}`);
    try {
      const rows = await fn();
      await c.query(`RELEASE SAVEPOINT ${name}`);
      return { ok: true, rows };
    } catch (err) {
      await c.query(`ROLLBACK TO SAVEPOINT ${name}`);
      return { ok: false, code: err.code, msg: err.message };
    }
  };
  const as = (role, claims, fn) => async () => {
    await c.query(`SET LOCAL ROLE ${role}`);
    await c.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role, ...claims })]);
    const rows = await fn();
    await c.query('RESET ROLE');
    await c.query(`SELECT set_config('request.jwt.claims', '', true)`);
    return rows;
  };
  const send = (role, claims, userId, type, title, body, data) =>
    as(role, claims, () => q(`SELECT public.send_system_notification($1, $2, $3, $4, $5::jsonb)`,
      [userId, type, title, body, data === undefined ? null : JSON.stringify(data)]));

  try {
    await c.query('BEGIN');
    await c.query("SET LOCAL statement_timeout = '120s'");

    // --baseline skips the migration to show the holes are real (checks fail).
    if (!process.argv.includes('--baseline')) {
      const sql = fs.readFileSync(MIGRATION, 'utf8').replace(/^\s*BEGIN;\s*$/m, '').replace(/^\s*COMMIT;\s*$/m, '');
      await c.query(sql);
      check('migration applies cleanly (inside this transaction)', true);
    }

    const priv = await one(`SELECT
        has_function_privilege('anon', 'public.increment_withdrawal_counter(uuid,timestamptz)', 'EXECUTE') AS anon_counter,
        has_function_privilege('authenticated', 'public.increment_withdrawal_counter(uuid,timestamptz)', 'EXECUTE') AS auth_counter,
        has_function_privilege('service_role', 'public.increment_withdrawal_counter(uuid,timestamptz)', 'EXECUTE') AS service_counter,
        has_function_privilege('anon', 'public.send_system_notification(uuid,text,text,text,jsonb)', 'EXECUTE') AS anon_notify,
        has_function_privilege('authenticated', 'public.send_system_notification(uuid,text,text,text,jsonb)', 'EXECUTE') AS auth_notify`);
    check('anon can no longer execute increment_withdrawal_counter', priv.anon_counter === false, priv);
    check('authenticated cannot execute increment_withdrawal_counter', priv.auth_counter === false);
    check('service_role keeps increment_withdrawal_counter', priv.service_counter === true);
    check('anon cannot execute send_system_notification', priv.anon_notify === false);
    check('authenticated keeps send_system_notification (dispute-service needs it)', priv.auth_notify === true);

    // Fixture plumbing only: bounty posting/escrow triggers are not under test.
    for (const t of ['trg_bounties_reserve_escrow', 'trg_bounties_enforce_funding_before_work', 'trg_bounties_consume_posting_checkout',
      'trg_bounties_enforce_posting_policy', 'trg_bounties_enforce_posting_policy_on_update', 'trg_bounties_normalize_funding_mode',
      'trg_bounties_lifecycle_guard', 'trg_bounties_a_paid_completion_guard']) {
      const exists = await one(`SELECT 1 AS x FROM pg_trigger WHERE tgname = $1 AND tgrelid = 'public.bounties'::regclass AND NOT tgisinternal`, [t]);
      if (exists) await c.query(`ALTER TABLE public.bounties DISABLE TRIGGER ${t}`);
    }
    await c.query(`SELECT set_config('app.bypass_profile_guard', 'on', true)`);

    const stamp = Date.now();
    const mkUser = async (label) => (await one(`WITH u AS (
        INSERT INTO auth.users (id, aud, role, email, created_at, updated_at)
        VALUES (gen_random_uuid(), 'authenticated', 'authenticated', $1, now(), now()) RETURNING id)
      INSERT INTO public.profiles (id, username) SELECT id, $2 FROM u RETURNING id`,
      [`notifyguard+${label}+${stamp}@example.test`, `ng_${label}_${stamp % 1e7}`])).id;

    const P = await mkUser('poster');
    const H = await mkUser('hunter');
    const S = await mkUser('stranger');
    const title = `Guard fixture ${stamp}`;
    const B = (await one(`INSERT INTO public.bounties (title, description, amount, is_for_honor, poster_id, user_id, status, work_type, accepted_by)
      VALUES ($1, 'Notification guard fixture', 25, false, $2, $2, 'in_progress', 'online', $3) RETURNING id`, [title, P, H])).id;
    const D = (await one(`INSERT INTO public.bounty_disputes (bounty_id, initiator_id, respondent_id, status, reason, dispute_stage)
      VALUES ($1, $2, $3, 'open', 'Notification guard fixture', 'in_progress') RETURNING id`, [B, H, P])).id;

    const user = (uid) => ({ sub: uid, app_metadata: {} });
    const countFor = async (uid, type) => Number((await one(
      `SELECT count(*)::int AS n FROM public.notifications WHERE user_id = $1 AND type = $2`, [uid, type])).n);

    // --- the spoofing vector -------------------------------------------------
    let r = await attempt(send('authenticated', user(S), P, 'account_restricted', 'Your account is restricted', 'Verify at http://evil.example', {}));
    check('stranger cannot send account_restricted to another user', !r.ok && r.code === '42501', r.msg);

    r = await attempt(send('authenticated', user(S), P, 'dispute_created', 'x', 'x', { disputeId: D, bountyId: B }));
    check('a user who did not open the dispute cannot notify for it', !r.ok && r.code === '42501', r.msg);

    r = await attempt(send('authenticated', user(H), S, 'dispute_created', 'x', 'x', { disputeId: D, bountyId: B }));
    check('initiator cannot notify someone outside the dispute', !r.ok && r.code === '42501', r.msg);

    r = await attempt(send('authenticated', user(H), H, 'dispute_created', 'x', 'x', { disputeId: D }));
    check('initiator cannot notify themselves', !r.ok && r.code === '42501', r.msg);

    r = await attempt(send('authenticated', user(H), P, 'dispute_created', 'x', 'x', { bountyId: B }));
    check('a non-admin call without disputeId is rejected', !r.ok && r.code === '42501', r.msg);

    // --- the legitimate client flows ------------------------------------------
    r = await attempt(send('authenticated', user(H), P, 'dispute_created', 'HACKED', 'Click http://evil.example', { disputeId: D, bountyId: B }));
    check('initiator can notify the poster of a dispute they opened', r.ok, r.msg);
    const row = await one(`SELECT title, body, data, category FROM public.notifications
      WHERE user_id = $1 AND type = 'dispute_created' ORDER BY created_at DESC LIMIT 1`, [P]);
    check('server rewrites title/body (client text is ignored)',
      row && row.title === 'Dispute Created' && row.body === `A dispute has been opened for bounty: ${title}`, row && { title: row.title, body: row.body });
    check('data carries the verified ids only', row && String(row.data.disputeId) === String(D) && row.data.bountyId === B, row && row.data);
    const outbox = await one(`SELECT title, data FROM public.notifications_outbox
      WHERE recipients @> $1::jsonb AND data->>'type' = 'dispute_created' ORDER BY created_at DESC LIMIT 1`, [JSON.stringify([P])]);
    check('push/email outbox row uses the server text too', outbox && outbox.title === 'Dispute Created' && outbox.data.skipInApp === true, outbox && outbox.title);

    r = await attempt(send('authenticated', user(H), P, 'dispute_created', 'again', 'again', { disputeId: D, bountyId: B }));
    check('a repeat for the same dispute/recipient is a silent no-op', r.ok && (await countFor(P, 'dispute_created')) === 1, r.msg);

    r = await attempt(send('authenticated', user(H), P, 'workflow_dispute_created', 'x', 'x', { disputeId: D, bountyId: B, stage: 'in_progress' }));
    const wf = await one(`SELECT title, data FROM public.notifications WHERE user_id = $1 AND type = 'workflow_dispute_created' LIMIT 1`, [P]);
    check('workflow dispute notification works with server text and a clean stage',
      r.ok && wf && wf.title === 'Dispute Raised' && wf.data.stage === 'in_progress', r.ok ? wf : r.msg);

    // --- privileged callers keep full use ----------------------------------------
    r = await attempt(send('authenticated', { sub: H, app_metadata: { role: 'admin' } }, S, 'account_warning', 'Admin title', 'Admin body', { reason: 'test' }));
    const adminRow = await one(`SELECT title FROM public.notifications WHERE user_id = $1 AND type = 'account_warning' LIMIT 1`, [S]);
    check('admin can send account_warning with their own text', r.ok && adminRow && adminRow.title === 'Admin title', r.ok ? adminRow : r.msg);

    r = await attempt(send('service_role', {}, S, 'verification_verified', 'You are verified', 'Body', null));
    check('service_role can send any supported type', r.ok, r.msg);
  } finally {
    await c.query('ROLLBACK').catch(() => {});
    await c.end().catch(() => {});
  }

  const failed = results.filter((x) => !x.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed (transaction rolled back; nothing was written).`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error('verify-system-notification-guard failed:', err.message);
  process.exit(1);
});
