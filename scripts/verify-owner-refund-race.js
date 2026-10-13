#!/usr/bin/env node
/**
 * Verifies supabase/migrations/20261013140000_owner_refund_acceptance_race.sql
 * (#883) against staging with two real sessions, because the property under
 * test is how a refund claim and an acceptance serialise on the bounty lock.
 *
 *   node scripts/verify-owner-refund-race.js                 # staging (.env.staging)
 *   node scripts/verify-owner-refund-race.js --insecure-tls  # no Supabase CA locally
 *
 * The migration must already be applied to staging. Fixtures are a $0
 * for-honor is_test bounty + one pending request between two is_internal
 * accounts. They are committed (a second session can't see uncommitted rows)
 * and deleted at the end. No money moves.
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
if (ENV !== 'staging') {
  console.error('verify-owner-refund-race only runs against staging (it commits fixture rows).');
  process.exit(2);
}

// Two is_internal Shoal accounts on staging.
const POSTER = '82cf749c-c327-4939-ad61-f927c55aee2d'; // shoal_poster_05
const HUNTER = '3bdd1b1d-2dc3-4cb4-b1ef-752f16e16a8f'; // shoal_hunter_06
const BLOCK_WAIT_MS = 1500;

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

/** Resolves to 'pending' if p has not settled within ms. */
function settledWithin(p, ms) {
  return Promise.race([
    p.then(() => 'settled', () => 'settled'),
    new Promise((r) => setTimeout(() => r('pending'), ms)),
  ]);
}

async function actAsPoster(c) {
  await c.query('SET LOCAL ROLE authenticated');
  await c.query("SELECT set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: POSTER, role: 'authenticated' }),
  ]);
}

async function main() {
  const admin = await connect(); // session A: the refund endpoint (service role / owner)
  const poster = await connect(); // session B: the poster's accept RPC
  const q = async (sql, params) => (await admin.query(sql, params)).rows;
  let bountyId = null;

  try {
    const present = (await q("SELECT to_regproc('public.fn_claim_owner_refund') IS NOT NULL AS ok"))[0].ok;
    if (!present) throw new Error('fn_claim_owner_refund is missing: apply 20261013140000 to staging first.');

    // ---- fixtures (committed) ----
    bountyId = (await q(
      `INSERT INTO public.bounties (user_id, poster_id, title, description, amount, is_for_honor, status, is_test)
       VALUES ($1, $1, 'verify #883 refund/accept race (fixture)', 'Created and deleted by scripts/verify-owner-refund-race.js', 0, true, 'open', true)
       RETURNING id`,
      [POSTER]
    ))[0].id;
    const requestId = (await q(
      `INSERT INTO public.bounty_requests (bounty_id, hunter_id, poster_id, status)
       VALUES ($1, $2, $3, 'pending') RETURNING id`,
      [bountyId, HUNTER, POSTER]
    ))[0].id;
    const claimRows = async () =>
      Number((await q('SELECT count(*)::int AS n FROM public.bounty_owner_refund_claims WHERE bounty_id = $1', [bountyId]))[0].n);

    // ---- privileges ----
    for (const role of ['anon', 'authenticated']) {
      await admin.query('BEGIN');
      await admin.query(`SET LOCAL ROLE ${role}`);
      let fnErr = null;
      try {
        await admin.query('SELECT public.fn_claim_owner_refund($1, $2)', [bountyId, POSTER]);
      } catch (e) {
        fnErr = e.message;
      }
      await admin.query('ROLLBACK');
      check(`${role} cannot execute fn_claim_owner_refund`, /permission denied/i.test(fnErr || ''), fnErr || 'no error');

      await admin.query('BEGIN');
      await admin.query(`SET LOCAL ROLE ${role}`);
      let tblErr = null;
      try {
        await admin.query('SELECT 1 FROM public.bounty_owner_refund_claims LIMIT 1');
      } catch (e) {
        tblErr = e.message;
      }
      await admin.query('ROLLBACK');
      check(`${role} cannot read bounty_owner_refund_claims`, /permission denied/i.test(tblErr || ''), tblErr || 'no error');
    }

    // ---- the rule is unchanged: a non-owner gets no claim ----
    const notOwner = (await q('SELECT public.fn_claim_owner_refund($1, $2) AS r', [bountyId, HUNTER]))[0].r;
    check('non-owner is refused with not_bounty_owner', notOwner === 'not_bounty_owner', notOwner);
    check('refused claim writes no claim row', (await claimRows()) === 0);

    // ---- 1. claim first: acceptance waits on the lock, then refuses ----
    await admin.query('BEGIN');
    const claimed = (await admin.query('SELECT public.fn_claim_owner_refund($1, $2) AS r', [bountyId, POSTER])).rows[0].r;
    check('owner claim on an open, never-accepted bounty is allowed', claimed === null, claimed);

    await poster.query('BEGIN');
    await actAsPoster(poster);
    const accept1 = poster.query('SELECT * FROM public.fn_accept_bounty_request($1)', [requestId]);
    accept1.catch(() => {});
    check('acceptance blocks while the claim holds the bounty lock', (await settledWithin(accept1, BLOCK_WAIT_MS)) === 'pending');
    await admin.query('COMMIT');
    let accept1Err = null;
    try {
      await accept1;
    } catch (e) {
      accept1Err = e.message;
    }
    await poster.query('ROLLBACK');
    check('acceptance after the claim refuses with bounty_not_open: owner_refund_in_progress',
      /bounty_not_open: owner_refund_in_progress/.test(accept1Err || ''), accept1Err || 'accepted!');

    const state1 = (await q('SELECT status::text, accepted_by FROM public.bounties WHERE id = $1', [bountyId]))[0];
    check('bounty is still open with no hunter', state1.status === 'open' && state1.accepted_by === null, state1);

    // ---- 2. legacy accept_bounty_request is covered by the same check ----
    await poster.query('BEGIN');
    await actAsPoster(poster);
    let legacyErr = null;
    try {
      await poster.query('SELECT public.accept_bounty_request($1)', [requestId]);
    } catch (e) {
      legacyErr = e.message;
    }
    await poster.query('ROLLBACK');
    check('accept_bounty_request also refuses during a live claim',
      /owner_refund_in_progress/.test(legacyErr || ''), legacyErr || 'accepted!');

    // ---- 3. an expired claim no longer blocks ----
    await q("UPDATE public.bounty_owner_refund_claims SET expires_at = now() - interval '1 second' WHERE bounty_id = $1", [bountyId]);
    await poster.query('BEGIN');
    await actAsPoster(poster);
    let expiredErr = null;
    try {
      await poster.query('SELECT * FROM public.fn_accept_bounty_request($1)', [requestId]);
    } catch (e) {
      expiredErr = e.message;
    }
    await poster.query('ROLLBACK');
    check('an expired claim does not block acceptance', expiredErr === null, expiredErr || 'accepted (rolled back)');

    // ---- 4. accept first: the claim waits on the lock, then sees the hunter ----
    await q('DELETE FROM public.bounty_owner_refund_claims WHERE bounty_id = $1', [bountyId]);
    await poster.query('BEGIN');
    await actAsPoster(poster);
    await poster.query('SELECT * FROM public.fn_accept_bounty_request($1)', [requestId]);
    const claim2 = admin.query('SELECT public.fn_claim_owner_refund($1, $2) AS r', [bountyId, POSTER]);
    claim2.catch(() => {});
    check('the claim blocks while an acceptance holds the bounty lock', (await settledWithin(claim2, BLOCK_WAIT_MS)) === 'pending');
    await poster.query('COMMIT');
    const claimed2 = (await claim2).rows[0].r;
    check('the claim after acceptance is refused with refund_requires_cancellation_or_dispute',
      claimed2 === 'refund_requires_cancellation_or_dispute', claimed2);
    check('refused claim after acceptance writes no claim row', (await claimRows()) === 0);
  } finally {
    if (bountyId) {
      try {
        await q('DELETE FROM public.bounties WHERE id = $1', [bountyId]);
        console.log(`cleanup: deleted fixture bounty ${bountyId}`);
      } catch (e) {
        console.error(`cleanup FAILED for fixture bounty ${bountyId} (is_test=true): ${e.message}`);
      }
    }
    await poster.end().catch(() => {});
    await admin.end().catch(() => {});
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
