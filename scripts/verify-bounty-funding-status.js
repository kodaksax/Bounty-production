#!/usr/bin/env node
/**
 * Verifies supabase/migrations/20261002180000_bounty_funding_status_read_model.sql
 * against staging inside ONE transaction that is always rolled back.
 *
 *   node scripts/verify-bounty-funding-status.js                 # staging (.env.staging)
 *   PGSSLROOTCERT=/path/to/supabase-ca.crt node scripts/verify-bounty-funding-status.js
 *   node scripts/verify-bounty-funding-status.js --insecure-tls  # encrypt, don't verify
 *
 * The migration file is always (re)applied inside the transaction -- its
 * functions are CREATE OR REPLACE -- so this tests the file, not whatever
 * version happens to be live. Fixtures (users, bounties, ledger rows) live in
 * the same transaction. Nothing persists.
 *
 * TLS: the server certificate is verified by default. Supabase presents a
 * certificate signed by its own root CA, so point PGSSLROOTCERT at it
 * (Dashboard > Database > SSL Configuration > Download certificate), or pass
 * --insecure-tls to opt out explicitly. Same policy as
 * scripts/ops/sync-cron-secrets.js.
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const ROOT = path.resolve(__dirname, '..');
const MIGRATION = path.join(ROOT, 'supabase/migrations/20261002180000_bounty_funding_status_read_model.sql');
const ENV = (process.argv.find((a) => a.startsWith('--env=')) || '--env=staging').slice(6);
const INSECURE_TLS = process.argv.includes('--insecure-tls');
if (ENV !== 'staging') {
  console.error('verify-bounty-funding-status only runs against staging (it applies DDL inside a transaction).');
  process.exit(2);
}

function candidateUrls() {
  const env = fs.readFileSync(path.join(ROOT, `.env.${ENV}`), 'utf8');
  const m = env.match(/^\s*DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m);
  if (!m) throw new Error(`DATABASE_URL not found in .env.${ENV}`);
  const u = new URL(m[1].trim());
  // sslmode in the URL would override the TLS policy below.
  u.searchParams.delete('sslmode');
  const raw = u.toString();
  const urls = [raw];
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
      // A certificate failure won't be fixed by the next host; say how to fix it.
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
  const as = (role, uid, fn) => async () => {
    await c.query(`SET LOCAL ROLE ${role}`);
    await c.query(`SELECT set_config('request.jwt.claims', $1, true)`,
      [JSON.stringify(uid ? { sub: uid, role } : { role })]);
    // On error the caller's ROLLBACK TO SAVEPOINT undoes the SET LOCALs; only
    // the success path needs an explicit reset.
    const rows = await fn();
    await c.query('RESET ROLE');
    await c.query(`SELECT set_config('request.jwt.claims', '', true)`);
    return rows;
  };

  try {
    await c.query('BEGIN');
    await c.query("SET LOCAL statement_timeout = '120s'");

    const sql = fs.readFileSync(MIGRATION, 'utf8').replace(/^\s*BEGIN;\s*$/m, '').replace(/^\s*COMMIT;\s*$/m, '');
    await c.query(sql);
    check('migration applies cleanly (inside this transaction)', true);

    // The RPC re-implements bounties' SELECT visibility (it is SECURITY
    // DEFINER). Any policy it doesn't know about must fail this suite.
    const KNOWN_SELECT_POLICIES = ['bounties_select_authenticated', 'bounties_select_moderation_hold'];
    const policies = await q(`SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'bounties' AND cmd IN ('SELECT', 'ALL')`);
    const unknown = policies.map((p) => p.policyname).filter((n) => !KNOWN_SELECT_POLICIES.includes(n));
    check('bounties has no SELECT policy the RPC does not mirror', unknown.length === 0, unknown.length ? unknown : policies.map((p) => p.policyname));

    // Fixture plumbing only: posting/escrow triggers are not under test here.
    for (const t of ['trg_bounties_reserve_escrow', 'trg_bounties_enforce_funding_before_work', 'trg_bounties_consume_posting_checkout',
      'trg_bounties_enforce_posting_policy', 'trg_bounties_enforce_posting_policy_on_update', 'trg_bounties_normalize_funding_mode',
      'trg_bounties_lifecycle_guard']) {
      const exists = await one(`SELECT 1 AS x FROM pg_trigger WHERE tgname = $1 AND NOT tgisinternal`, [t]);
      if (exists) await c.query(`ALTER TABLE public.bounties DISABLE TRIGGER ${t}`);
    }
    await c.query(`SELECT set_config('app.bypass_profile_guard', 'on', true)`);

    const stamp = Date.now();
    const mkUser = async (label) => (await one(`WITH u AS (
        INSERT INTO auth.users (id, aud, role, email, created_at, updated_at)
        VALUES (gen_random_uuid(), 'authenticated', 'authenticated', $1, now(), now()) RETURNING id)
      INSERT INTO public.profiles (id, username) SELECT id, $2 FROM u RETURNING id`,
      [`funding+${label}+${stamp}@example.test`, `fs_${label}_${stamp % 1e7}`])).id;

    const mkBounty = async (poster, { status = 'open', fundingMode = 'at_accept', amount = 25, honor = false, pav = 1 } = {}) =>
      (await one(`INSERT INTO public.bounties (title, description, amount, is_for_honor, poster_id, user_id, status, work_type, funding_mode, payment_architecture_version)
        VALUES ($1, 'Funding status fixture', $2, $3, $4, $4, $5, 'online', $6, $7) RETURNING id`,
        [`fs ${status} ${fundingMode} ${stamp}`, amount, honor, poster, status, fundingMode, pav])).id;

    const ledger = async (bounty, user, type, amount) =>
      c.query(`INSERT INTO public.wallet_transactions (user_id, bounty_id, type, amount, status)
        VALUES ($1, $2, $3, $4, 'completed')`, [user, bounty, type, amount]);

    const P = await mkUser('poster');
    const H = await mkUser('hunter');

    const bOpenUnfunded = await mkBounty(P);
    const bOpenHeld = await mkBounty(P);
    await ledger(bOpenHeld, P, 'escrow', -25);
    const bRefunded = await mkBounty(P, { status: 'cancelled' });
    await ledger(bRefunded, P, 'escrow', -25);
    await ledger(bRefunded, P, 'refund', 25);
    const bReleased = await mkBounty(P, { status: 'completed' });
    await ledger(bReleased, P, 'escrow', -25);
    await ledger(bReleased, H, 'release', 23.75);
    const bProgressHeld = await mkBounty(P, { status: 'in_progress' });
    await ledger(bProgressHeld, P, 'escrow', -25);
    const bHonor = await mkBounty(P, { honor: true, amount: 0, fundingMode: 'at_post' });
    const bAtPostNoEscrow = await mkBounty(P, { fundingMode: 'at_post' });
    const bV2Authorized = await mkBounty(P, { fundingMode: 'at_post', pav: 2 });
    await c.query(`INSERT INTO public.bounty_payments (bounty_id, poster_id, amount, status) VALUES ($1, $2, 25, 'authorized')`, [bV2Authorized, P]);
    // v1 ledger rows on a v2 bounty must not count: architecture decides.
    const bV2Pending = await mkBounty(P, { fundingMode: 'at_post', pav: 2 });
    await c.query(`INSERT INTO public.bounty_payments (bounty_id, poster_id, amount, status) VALUES ($1, $2, 25, 'pending_payment')`, [bV2Pending, P]);
    await ledger(bV2Pending, P, 'escrow', -25);

    const all = [bOpenUnfunded, bOpenHeld, bRefunded, bReleased, bProgressHeld, bHonor, bAtPostNoEscrow, bV2Authorized, bV2Pending];
    const call = (role, uid, ids) => as(role, uid, () => q(`SELECT * FROM public.get_bounty_funding_status($1::uuid[])`, [ids]));

    const r = await attempt(call('authenticated', H, all));
    check('authenticated hunter can call get_bounty_funding_status', r.ok, r.msg);
    const state = Object.fromEntries((r.rows || []).map((row) => [row.bounty_id, row.funding_state]));
    const expect = [
      ['open + at_accept + nothing held -> held_on_selection', bOpenUnfunded, 'held_on_selection'],
      ['open + escrow completed -> held', bOpenHeld, 'held'],
      ['escrow then refund -> not_held', bRefunded, 'not_held'],
      ['escrow then release -> not_held', bReleased, 'not_held'],
      ['in_progress + escrow -> held', bProgressHeld, 'held'],
      ['for honor -> not_applicable', bHonor, 'not_applicable'],
      ['open + at_post + no escrow (legacy anomaly) -> not_held, never held_on_selection', bAtPostNoEscrow, 'not_held'],
      ['v2 authorized PaymentIntent -> held', bV2Authorized, 'held'],
      ['v2 pending_payment (v1 ledger row ignored) -> not_held', bV2Pending, 'not_held'],
    ];
    for (const [name, id, want] of expect) check(name, state[id] === want, state[id]);

    const cols = r.ok && r.rows[0] ? Object.keys(r.rows[0]).sort() : [];
    check('returns only bounty_id + funding_state (no amounts or balances)', JSON.stringify(cols) === JSON.stringify(['bounty_id', 'funding_state']), cols);

    const anon = await attempt(call('anon', null, [bOpenHeld]));
    check('anon cannot execute', !anon.ok && anon.code === '42501', anon.code);

    const helper = await attempt(as('authenticated', H, () => q(`SELECT public.fn_bounty_funding_held($1)`, [bOpenHeld])));
    check('internal helper fn_bounty_funding_held not executable by authenticated', !helper.ok && helper.code === '42501', helper.code);

    const big = Array.from({ length: 150 }, () => bOpenHeld);
    const capped = await attempt(call('authenticated', H, [...big.slice(0, 100), bOpenUnfunded]));
    check('array capped at 100 ids', capped.ok && !capped.rows.some((row) => row.bounty_id === bOpenUnfunded), capped.ok ? capped.rows.length : capped.msg);

    const noJwt = await attempt(as('authenticated', null, () => q(`SELECT * FROM public.get_bounty_funding_status($1::uuid[])`, [[bOpenHeld]])));
    check('no auth.uid() -> no rows', noJwt.ok && noJwt.rows.length === 0, noJwt.ok ? noJwt.rows.length : noJwt.msg);

    // --- visibility: a moderation-held bounty must not be probeable ---------
    // Uses the real fn_bounty_moderation_visible + bounty_moderation row where
    // the environment has them (prod, and staging once 20261001140000 lands);
    // otherwise installs a stand-in with the same signature and semantics so
    // the RPC's mirroring of the restrictive policy is still exercised.
    const S = await mkUser('stranger');
    const bHidden = await mkBounty(P);
    await ledger(bHidden, P, 'escrow', -25);
    const realModeration = (await one(`SELECT to_regprocedure('public.fn_bounty_moderation_visible(uuid,uuid,uuid,uuid)') IS NOT NULL AS ok`)).ok;
    if (realModeration) {
      await c.query(`INSERT INTO public.bounty_moderation (bounty_id, state) VALUES ($1, 'hidden')
        ON CONFLICT (bounty_id) DO UPDATE SET state = 'hidden'`, [bHidden]);
    } else {
      await c.query(`CREATE FUNCTION public.fn_bounty_moderation_visible(p_bounty_id uuid, p_poster_id uuid, p_user_id uuid, p_accepted_by uuid)
        RETURNS boolean LANGUAGE sql STABLE AS $f$
          SELECT p_bounty_id <> '${bHidden}'::uuid OR auth.uid() IN (p_poster_id, p_user_id, p_accepted_by)
        $f$`);
    }
    const hiddenStranger = await attempt(call('authenticated', S, [bHidden, bOpenHeld]));
    check(`moderation-held bounty: stranger gets no row (${realModeration ? 'real' : 'stand-in'} visibility fn)`,
      hiddenStranger.ok && !hiddenStranger.rows.some((row) => row.bounty_id === bHidden)
        && hiddenStranger.rows.some((row) => row.bounty_id === bOpenHeld),
      hiddenStranger.ok ? hiddenStranger.rows.map((row) => row.bounty_id === bHidden ? 'hidden' : 'visible') : hiddenStranger.msg);
    const hiddenPoster = await attempt(call('authenticated', P, [bHidden]));
    check('moderation-held bounty: its poster still gets the state', hiddenPoster.ok && hiddenPoster.rows[0]?.funding_state === 'held',
      hiddenPoster.ok ? hiddenPoster.rows : hiddenPoster.msg);
  } finally {
    await c.query('ROLLBACK').catch(() => {});
    await c.end();
  }

  const failed = results.filter((x) => !x.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed (rolled back; nothing persisted)`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
