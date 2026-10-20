#!/usr/bin/env node
/**
 * Verifies supabase/migrations/20261020120000_first_time_poster_card_at_post.sql
 * (SBA-05) against staging, inside ONE transaction that is always rolled back.
 *
 *   node scripts/verify-card-at-post.js                 # migration not yet applied: applies it in the tx
 *   node scripts/verify-card-at-post.js --applied       # migration already applied: checks only
 *   node scripts/verify-card-at-post.js --insecure-tls  # no Supabase CA locally
 *
 * What it proves, as the real anon / authenticated roles where it matters:
 *   * fn_is_first_time_poster: true for a never-posted account and for one
 *     whose posts were never hired; false once any bounty is accepted, by each
 *     signal separately (accepted_by, accepted request, status, completed_at,
 *     ledger-only event on an archived bounty).
 *   * fn_get_posting_card_requirement: off by default; with the switch on,
 *     true only for a first-time poster on a bounty charged at hire; answers
 *     only about auth.uid(); anon can't call it.
 *   * fn_can_defer_bounty_funding: 'all_bounties' unchanged; 'first_bounty'
 *     now follows the shared definition; clients can no longer call it, and
 *     posting a paid bounty as `authenticated` still gets funding_mode
 *     'at_accept' with no escrow debit (the revoke didn't break the trigger).
 *   * The switch's CHECK rejects unknown values.
 *
 * Nothing persists: the script first proves ROLLBACK is honoured with a probe
 * table, then rolls back everything it did. No money moves: fixture bounties
 * are paid but 'at_accept', so inserting them debits nothing, and every one
 * is rolled back.
 *
 * Exit code 0 only when every check passes.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const ROOT = path.resolve(__dirname, '..');
const ENV = (process.argv.find((a) => a.startsWith('--env=')) || '--env=staging').slice(6);
const INSECURE_TLS = process.argv.includes('--insecure-tls');
const ALREADY_APPLIED = process.argv.includes('--applied');
if (ENV !== 'staging') {
  console.error('verify-card-at-post only runs against staging.');
  process.exit(2);
}

const MIGRATION = path.join(
  ROOT,
  'supabase/migrations/20261020120000_first_time_poster_card_at_post.sql'
);

// is_internal Shoal pool accounts on staging (qa/shoal/README.md).
const NEVER_POSTED = 'c71fc716-3ab1-4a5e-b424-781e0a67ad57'; // shoal_poster_00
const POSTED_NEVER_HIRED = 'e21d780e-6a3d-433a-9d02-ee19bf2bb1b0'; // shoal_poster
const HAS_HIRED = 'a3af8f71-513f-49e9-9e1b-fa9a9e2f2266'; // shoal_poster_01
const FIXTURE_POSTER = 'be8ace71-c693-4b04-8449-3dec74d19d81'; // shoal_hunter_07, $0, no posts
const FIXTURE_HUNTER = 'ac934d46-dab7-4f6b-a9e6-cf43b07168e9'; // shoal_hunter_08

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
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info !== undefined ? `  (${typeof info === 'string' ? info : JSON.stringify(info)})` : ''}`);
}

/** Strip the file's own BEGIN/COMMIT so it runs inside our transaction. */
function migrationBody() {
  return fs
    .readFileSync(MIGRATION, 'utf8')
    .replace(/^\s*BEGIN;\s*$/m, '')
    .replace(/^\s*COMMIT;\s*$/m, '')
    .replace(/^\s*NOTIFY pgrst.*$/m, '');
}

async function main() {
  const db = await connect();
  const q = (sql, params) => db.query(sql, params);
  const one = async (sql, params) => (await q(sql, params)).rows[0];
  const val = async (sql, params) => Object.values((await q(sql, params)).rows[0] || {})[0];

  /** Run fn as a client role with auth.uid() = uid, inside a savepoint. */
  async function as(role, uid, fn) {
    await q('SAVEPOINT as_role');
    try {
      await q(`SELECT set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify(uid ? { sub: uid, role } : { role }),
      ]);
      await q(`SET LOCAL ROLE ${role}`);
      const out = await fn();
      await q('RESET ROLE');
      await q('RELEASE SAVEPOINT as_role');
      return { ok: true, out };
    } catch (err) {
      await q('ROLLBACK TO SAVEPOINT as_role');
      await q('RESET ROLE');
      return { ok: false, err };
    }
  }

  const firstTime = (uid) => val('SELECT public.fn_is_first_time_poster($1::uuid)', [uid]);

  // --- 0. Rollback is honoured ---------------------------------------------
  await q('BEGIN');
  await q('CREATE TABLE public.__sba05_probe (x int)');
  await q('ROLLBACK');
  const probe = await val(`SELECT to_regclass('public.__sba05_probe') IS NULL`);
  check('rollback is honoured (probe table gone)', probe === true);
  if (!probe) throw new Error('ROLLBACK not honoured; refusing to continue');

  await q('BEGIN');
  try {
    if (ALREADY_APPLIED) {
      const exists = await val(`SELECT to_regprocedure('public.fn_is_first_time_poster(uuid)') IS NOT NULL`);
      check('migration is applied', exists === true);
    } else {
      await q(migrationBody());
      check('migration applies cleanly', true);
    }

    // --- 1. Definition, against real pool history ---------------------------
    check('null user is not a first-time poster', (await firstTime(null)) === false);
    check('never-posted account is first-time', (await firstTime(NEVER_POSTED)) === true);
    check('posted-but-never-hired account is first-time', (await firstTime(POSTED_NEVER_HIRED)) === true);
    check('account that has hired is not first-time', (await firstTime(HAS_HIRED)) === false);

    // --- 1b. Each signal on its own, on fixture bounties --------------------
    check('fixture poster starts first-time', (await firstTime(FIXTURE_POSTER)) === true);

    async function withFixtureBounty(label, mutate) {
      await q('SAVEPOINT sig');
      const { id } = await one(
        `INSERT INTO public.bounties (title, description, amount, is_for_honor, poster_id, user_id, status, is_test, location)
         VALUES ($1, 'SBA-05 verify fixture, rolled back.', 20, false, $2, $2, 'open', true, 'Online')
         RETURNING id`,
        [`SBA-05 ${label}`, FIXTURE_POSTER]
      );
      const openStill = await firstTime(FIXTURE_POSTER);
      await mutate(id);
      const after = await firstTime(FIXTURE_POSTER);
      await q('ROLLBACK TO SAVEPOINT sig');
      check(`${label}: open bounty keeps first-time, signal clears it`, openStill === true && after === false, { openStill, after });
    }

    // Writes below run as the table owner, so the lifecycle guards that stop
    // clients doing this don't apply. They model what the server paths record.
    // trg_bounties_enforce_funding_before_work still refuses to assign a hunter
    // to an unfunded bounty, so these fixtures are funded at post: deferral off
    // and a balance for the fixture poster, both undone by ROLLBACK TO funded.
    await q('SAVEPOINT funded');
    await q(`UPDATE public.payment_experiment_config SET deferred_funding_enabled = false WHERE id`);
    // The same transaction-local bypass the trusted balance functions use.
    await q(`SELECT set_config('app.bypass_profile_guard', 'on', true)`);
    await q(`UPDATE public.profiles SET balance = 500 WHERE id = $1`, [FIXTURE_POSTER]);
    await q(`SELECT set_config('app.bypass_profile_guard', 'off', true)`);
    // 'archived' is not itself a signal (checked below), so these isolate the
    // column. An open bounty can't carry a hunter (bounties_open_implies_unassigned).
    await withFixtureBounty('accepted_by', (id) =>
      q(`UPDATE public.bounties SET status = 'archived', accepted_by = $2 WHERE id = $1`, [id, FIXTURE_HUNTER]));
    await withFixtureBounty('accepted_request_id', async (id) => {
      const { id: reqId } = await one(
        `INSERT INTO public.bounty_requests (bounty_id, hunter_id, poster_id, status)
         VALUES ($1, $2, $3, 'pending') RETURNING id`, [id, FIXTURE_HUNTER, FIXTURE_POSTER]);
      await q(`UPDATE public.bounties SET status = 'archived', accepted_request_id = $2 WHERE id = $1`, [id, reqId]);
    });
    await withFixtureBounty('accepted request', (id) =>
      q(`INSERT INTO public.bounty_requests (bounty_id, hunter_id, poster_id, status)
         VALUES ($1, $2, $3, 'accepted')`, [id, FIXTURE_HUNTER, FIXTURE_POSTER]));
    await withFixtureBounty('status completed', (id) =>
      q(`UPDATE public.bounties SET status = 'completed' WHERE id = $1`, [id]));
    await withFixtureBounty('completed_at', (id) =>
      q(`UPDATE public.bounties SET completed_at = now() WHERE id = $1`, [id]));
    await withFixtureBounty('ledger-only (archived)', async (id) => {
      await q(`UPDATE public.bounties SET status = 'archived' WHERE id = $1`, [id]);
      // Archiving alone must not count.
      const archivedOnly = await firstTime(FIXTURE_POSTER);
      check('archived with no acceptance signal stays first-time', archivedOnly === true);
      await q(
        `INSERT INTO public.bounty_events (event_key, bounty_id, event_type, source, occurred_at)
         VALUES ($1, $2, 'bounty.accepted', 'inferred', now())`,
        [`verify_sba05:${id}`, id]
      );
    });
    await q('ROLLBACK TO SAVEPOINT funded');
    check('fixture poster first-time again after savepoints', (await firstTime(FIXTURE_POSTER)) === true);

    // --- 2. Switch ----------------------------------------------------------
    const scope = await val(`SELECT card_at_post_scope FROM public.payment_experiment_config WHERE id`);
    check("switch defaults to 'off'", scope === 'off', scope);
    await q('SAVEPOINT bad');
    let rejected = false;
    try {
      await q(`UPDATE public.payment_experiment_config SET card_at_post_scope = 'everyone' WHERE id`);
    } catch (e) {
      rejected = e.code === '23514';
    }
    await q('ROLLBACK TO SAVEPOINT bad');
    check('switch CHECK rejects unknown values', rejected);

    // --- 3. Requirement RPC, as the real client roles ----------------------
    const req = async (uid, amount) => {
      const r = await as('authenticated', uid, () =>
        val('SELECT public.fn_get_posting_card_requirement($1::numeric)', [amount]));
      if (!r.ok) throw r.err;
      return r.out;
    };

    let r = await req(FIXTURE_POSTER, 40);
    check('switch off: card not required', r.card_required === false && r.scope === 'off' && r.first_time_poster === true, r);

    await q(`UPDATE public.payment_experiment_config SET card_at_post_scope = 'first_time_posters' WHERE id`);
    r = await req(FIXTURE_POSTER, 40);
    check('switch on, first-time, $40 at hire: card required', r.card_required === true && r.charged_at_hire === true, r);
    r = await req(FIXTURE_POSTER, 0);
    check('switch on, $0: not required (nothing charged at hire)', r.card_required === false && r.charged_at_hire === false, r);
    r = await req(HAS_HIRED, 40);
    check('switch on, poster who has hired: not required', r.card_required === false && r.first_time_poster === false, r);
    r = await req(null, 40);
    check('no auth.uid(): not required', r.card_required === false, r);

    await q('SAVEPOINT killed');
    await q(`UPDATE public.payment_experiment_config SET deferred_funding_enabled = false WHERE id`);
    r = await req(FIXTURE_POSTER, 40);
    check('deferral kill switch on (charged at post): not required', r.card_required === false && r.charged_at_hire === false, r);
    await q('ROLLBACK TO SAVEPOINT killed');

    const anonCall = await as('anon', null, () => val('SELECT public.fn_get_posting_card_requirement(40)'));
    check('anon cannot call fn_get_posting_card_requirement', !anonCall.ok && anonCall.err.code === '42501', anonCall.err?.code);

    // --- 4. Grants -----------------------------------------------------------
    const priv = (role, sig) => val(`SELECT has_function_privilege($1, $2, 'EXECUTE')`, [role, sig]);
    for (const role of ['anon', 'authenticated']) {
      check(`${role} cannot execute fn_is_first_time_poster`, (await priv(role, 'public.fn_is_first_time_poster(uuid)')) === false);
      check(`${role} cannot execute fn_can_defer_bounty_funding`, (await priv(role, 'public.fn_can_defer_bounty_funding(uuid,numeric)')) === false);
    }
    check('authenticated can execute fn_get_posting_card_requirement', (await priv('authenticated', 'public.fn_get_posting_card_requirement(numeric)')) === true);
    check('authenticated can still execute fn_can_i_defer_bounty_funding', (await priv('authenticated', 'public.fn_can_i_defer_bounty_funding(numeric)')) === true);
    for (const sig of ['fn_is_first_time_poster(uuid)', 'fn_get_posting_card_requirement(numeric)', 'fn_can_defer_bounty_funding(uuid,numeric)']) {
      const def = await one(
        `SELECT p.prosecdef, p.proconfig FROM pg_proc p WHERE p.oid = $1::regprocedure`, [`public.${sig}`]);
      check(`${sig} is SECURITY DEFINER with fixed search_path`, def.prosecdef === true && (def.proconfig || []).includes('search_path=public'), def.proconfig);
    }

    // --- 5. fn_can_defer_bounty_funding behaviour ----------------------------
    const canDefer = (uid, amt) => val('SELECT public.fn_can_defer_bounty_funding($1::uuid, $2::numeric)', [uid, amt]);
    check("'all_bounties': poster who has hired still defers", (await canDefer(HAS_HIRED, 40)) === true);
    await q('SAVEPOINT scope');
    await q(`UPDATE public.payment_experiment_config SET deferred_funding_scope = 'first_bounty' WHERE id`);
    check("'first_bounty': posted-never-hired defers (was false: has prior posts)", (await canDefer(POSTED_NEVER_HIRED, 40)) === true);
    check("'first_bounty': poster who has hired does not defer", (await canDefer(HAS_HIRED, 40)) === false);
    await q('ROLLBACK TO SAVEPOINT scope');

    const viaWrapper = await as('authenticated', FIXTURE_POSTER, () =>
      val('SELECT public.fn_can_i_defer_bounty_funding(40)'));
    check('fn_can_i_defer_bounty_funding still answers for the caller', viaWrapper.ok && viaWrapper.out === true, viaWrapper.err?.message);

    // --- 6. Posting still works as authenticated (trigger runs as owner) ----
    const balBefore = await val('SELECT balance FROM public.profiles WHERE id = $1', [FIXTURE_POSTER]);
    const insert = await as('authenticated', FIXTURE_POSTER, () =>
      one(
        `INSERT INTO public.bounties (title, description, amount, is_for_honor, poster_id, user_id, status, is_test, location)
         VALUES ('SBA-05 paid fixture', 'Rolled back; verifies funding_mode after the revoke.', 40, false, $1, $1, 'open', true, 'Online')
         RETURNING id, funding_mode`,
        [FIXTURE_POSTER]
      ));
    check('authenticated paid post succeeds with $0 balance', insert.ok, insert.err?.message);
    if (insert.ok) {
      check("paid post is funding_mode 'at_accept'", insert.out.funding_mode === 'at_accept', insert.out.funding_mode);
      const escrow = await val(
        `SELECT count(*)::int FROM public.wallet_transactions WHERE bounty_id = $1 AND type = 'escrow'`, [insert.out.id]);
      const balAfter = await val('SELECT balance FROM public.profiles WHERE id = $1', [FIXTURE_POSTER]);
      check('no escrow row and no balance change at post', escrow === 0 && String(balAfter) === String(balBefore), { escrow, balBefore, balAfter });
      // The poster now has an unhired post: still first-time.
      check('an unhired post leaves the poster first-time', (await firstTime(FIXTURE_POSTER)) === true);
    }
  } finally {
    await q('ROLLBACK');
  }

  const leftover = await val(
    `SELECT to_regprocedure('public.fn_is_first_time_poster(uuid)') IS NOT NULL`);
  if (!ALREADY_APPLIED) check('nothing persisted (function absent after rollback)', leftover === false);
  await db.end();

  const failed = results.filter((x) => !x.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
