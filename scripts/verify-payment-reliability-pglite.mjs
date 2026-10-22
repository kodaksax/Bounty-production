/* scripts/verify-payment-reliability-pglite.mjs
 *
 * Functional checks, on an in-process PostgreSQL (PGlite), for
 *   supabase/migrations/20261021120000_funding_requirement_counts_v2_escrow.sql
 *   supabase/migrations/20261021120100_reconcile_stripe_refunded_bounty_payments.sql
 *
 * The defect: fn_get_bounty_funding_requirement reported already_funded only
 * from a v1 wallet escrow row, so a v2 (website Stripe Checkout) bounty whose
 * charge is captured in bounty_payments read as unfunded. The app's cancel
 * path then skipped the refund and deleted the bounty (production 060079f5).
 *
 * The schema is a minimal stand-in with production's columns. The pre-fix
 * body is loaded from the rollback file (byte-for-byte what production ran),
 * so the "before" checks reproduce the defect against the real definition.
 * The migration is applied twice (idempotency), then rolled back.
 *
 * The reconciliation is checked against stored-event evidence shaped like
 * production's (charge.refunded with no refunds key; refund.* objects): dry
 * run writes nothing, apply marks only fully proven rows, re-apply is a no-op,
 * revert restores each row exactly, and only service_role may run it.
 *
 * Usage:
 *   npm i --no-save @electric-sql/pglite   (or set PGLITE_DIR to a folder that has it)
 *   node scripts/verify-payment-reliability-pglite.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const req = createRequire(process.env.PGLITE_DIR ? path.join(process.env.PGLITE_DIR, 'noop.js') : import.meta.url);
const { PGlite } = await import(pathToFileURL(req.resolve('@electric-sql/pglite')).href);
const MIGRATION = fs.readFileSync(
  `${REPO}/supabase/migrations/20261021120000_funding_requirement_counts_v2_escrow.sql`,
  'utf8'
);
const RECONCILE = fs.readFileSync(
  `${REPO}/supabase/migrations/20261021120100_reconcile_stripe_refunded_bounty_payments.sql`,
  'utf8'
);
const RECONCILE_ROLLBACK = fs.readFileSync(
  `${REPO}/supabase/rollbacks/production/20261021120100_reconcile_stripe_refunded_bounty_payments.down.sql`,
  'utf8'
);
const ROLLBACK = fs.readFileSync(
  `${REPO}/supabase/rollbacks/production/20261021120000_funding_requirement_counts_v2_escrow.down.sql`,
  'utf8'
);

const db = await PGlite.create();
const q = (sql, params) => db.query(sql, params);
const one = async (sql, params) => (await q(sql, params)).rows[0];

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok  ', name); }
  else { fail++; console.log('  FAIL', name, detail !== undefined ? JSON.stringify(detail) : ''); }
}

// ─── Supabase-ish base ──────────────────────────────────────────────────────
await db.exec(`
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid $$;

CREATE TABLE public.profiles (id uuid PRIMARY KEY, balance numeric DEFAULT 0);
CREATE TABLE public.bounties (
  id uuid PRIMARY KEY, poster_id uuid, user_id uuid, amount numeric DEFAULT 0,
  is_for_honor boolean DEFAULT false, status text DEFAULT 'open',
  funding_mode text DEFAULT 'at_post', payment_architecture_version int DEFAULT 1);
CREATE TABLE public.wallet_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, bounty_id uuid, type text, status text, amount numeric);
CREATE TABLE public.bounty_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bounty_id uuid, poster_id uuid, status text, amount numeric,
  stripe_payment_intent_id text UNIQUE, stripe_refund_id text, metadata jsonb);
CREATE TABLE public.stripe_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_type text, event_data jsonb, created_at timestamptz DEFAULT now());
`);

// Pre-fix definition and its production grants (20260823120000).
await db.exec(ROLLBACK);
await db.exec(`
REVOKE ALL ON FUNCTION public.fn_get_bounty_funding_requirement(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_get_bounty_funding_requirement(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_get_bounty_funding_requirement(uuid) TO authenticated;
`);

const POSTER = '00000000-0000-0000-0000-00000000000a';
const OTHER = '00000000-0000-0000-0000-00000000000b';
const B = {
  v1Escrowed:   '10000000-0000-0000-0000-000000000001',
  v1Unfunded:   '10000000-0000-0000-0000-000000000002',
  v2Captured:   '10000000-0000-0000-0000-000000000003', // the 060079f5 shape
  v2Authorized: '10000000-0000-0000-0000-000000000004',
  v2Refunded:   '10000000-0000-0000-0000-000000000005',
  v2Pending:    '10000000-0000-0000-0000-000000000006',
  v2LaterFailed:'10000000-0000-0000-0000-000000000009',
  v2Canceled:   '10000000-0000-0000-0000-000000000007',
  honor:        '10000000-0000-0000-0000-000000000008',
};
await q(`INSERT INTO public.profiles (id, balance) VALUES ($1, 7), ($2, 0)`, [POSTER, OTHER]);
await db.exec(`
INSERT INTO public.bounties (id, poster_id, amount, funding_mode, payment_architecture_version, is_for_honor) VALUES
  ('${B.v1Escrowed}',   '${POSTER}', 20, 'at_post',   1, false),
  ('${B.v1Unfunded}',   '${POSTER}', 20, 'at_accept', 1, false),
  ('${B.v2Captured}',   '${POSTER}',  5, 'at_post',   2, false),
  ('${B.v2Authorized}', '${POSTER}', 35, 'at_post',   2, false),
  ('${B.v2Refunded}',   '${POSTER}', 15, 'at_post',   2, false),
  ('${B.v2Pending}',    '${POSTER}', 15, 'at_post',   2, false),
  ('${B.v2Canceled}',   '${POSTER}', 15, 'at_post',   2, false),
  ('${B.honor}',        '${POSTER}',  0, 'at_post',   1, true);
INSERT INTO public.wallet_transactions (user_id, bounty_id, type, status, amount) VALUES
  ('${POSTER}', '${B.v1Escrowed}', 'escrow', 'completed', -20);
INSERT INTO public.bounty_payments (bounty_id, poster_id, status, amount) VALUES
  ('${B.v2Captured}',   '${POSTER}', 'captured',        5),
  ('${B.v2Authorized}', '${POSTER}', 'authorized',     35),
  ('${B.v2Refunded}',   '${POSTER}', 'refunded',       15),
  ('${B.v2Pending}',    '${POSTER}', 'pending_payment',15),
  ('${B.v2Canceled}',   '${POSTER}', 'canceled',       15);
`);

async function asUser(uid, fn) {
  await db.exec('BEGIN');
  try {
    await q(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, role: 'authenticated' })]);
    await db.exec('SET LOCAL ROLE authenticated');
    return await fn();
  } finally {
    await db.exec('ROLLBACK');
  }
}
const req_ = (id) => asUser(POSTER, () => one(`SELECT * FROM public.fn_get_bounty_funding_requirement($1)`, [id]));

console.log('\nBefore the migration (the production defect)');
check('v2 captured web payment reads as NOT funded', (await req_(B.v2Captured)).already_funded === false);
check('v1 escrowed bounty reads as funded', (await req_(B.v1Escrowed)).already_funded === true);

async function afterChecks(label) {
  console.log(`\n${label}`);
  const cap = await req_(B.v2Captured);
  check('v2 captured -> already_funded', cap.already_funded === true, cap);
  check('v2 captured at_post -> requires_funding stays false, shortfall 0',
    cap.requires_funding === false && Number(cap.shortfall) === 0 && Number(cap.amount_required) === 0, cap);
  check('v2 authorized hold -> already_funded', (await req_(B.v2Authorized)).already_funded === true);
  check('v2 refunded -> not funded (nothing left to refund)', (await req_(B.v2Refunded)).already_funded === false);
  check('v2 pending_payment -> not funded', (await req_(B.v2Pending)).already_funded === false);
  check('v2 canceled -> not funded', (await req_(B.v2Canceled)).already_funded === false);
  check('v1 escrowed -> still funded', (await req_(B.v1Escrowed)).already_funded === true);
  const un = await req_(B.v1Unfunded);
  check('v1 at_accept unfunded -> requires funding, shortfall = amount - balance',
    un.already_funded === false && un.requires_funding === true &&
    Number(un.amount_required) === 20 && Number(un.shortfall) === 13, un);
  check('honor -> not funded, no requirement', (await req_(B.honor)).requires_funding === false);
  let denied = null;
  try { await asUser(OTHER, () => one(`SELECT * FROM public.fn_get_bounty_funding_requirement($1)`, [B.v2Captured])); }
  catch (e) { denied = e.code; }
  check('a non-poster is still refused (42501)', denied === '42501', denied);
  const grants = await one(`
    SELECT has_function_privilege('anon', 'public.fn_get_bounty_funding_requirement(uuid)', 'EXECUTE') AS anon,
           has_function_privilege('authenticated', 'public.fn_get_bounty_funding_requirement(uuid)', 'EXECUTE') AS authn`);
  check('grants unchanged: authenticated yes, anon no', grants.authn === true && grants.anon === false, grants);
  const sec = await one(`SELECT prosecdef FROM pg_proc WHERE proname = 'fn_get_bounty_funding_requirement'`);
  check('still SECURITY DEFINER', sec.prosecdef === true);
}

await db.exec(MIGRATION);
await afterChecks('After the migration');
await db.exec(MIGRATION);
await afterChecks('After applying it a second time');

await db.exec(ROLLBACK);
console.log('\nAfter the rollback');
check('rollback restores the pre-fix answer for v2', (await req_(B.v2Captured)).already_funded === false);
check('rollback keeps v1', (await req_(B.v1Escrowed)).already_funded === true);

// ─── 20261021120100: reconcile Stripe-refunded v2 rows ──────────────────────
console.log('\nReconciliation (20261021120100)');
const P = (n) => `20000000-0000-0000-0000-00000000000${n}`;
await db.exec(`
DELETE FROM public.bounty_payments;
INSERT INTO public.bounty_payments (id, bounty_id, poster_id, status, amount, stripe_payment_intent_id, stripe_refund_id, metadata) VALUES
  ('${P(1)}', '${B.v2Captured}',   '${POSTER}', 'refund_pending', 15, 'pi_full_pending',  NULL, '{"source":"x"}'),
  ('${P(2)}', '${B.v2Authorized}', '${POSTER}', 'captured',       10, 'pi_full_captured', NULL, NULL),
  ('${P(3)}', '${B.v2Refunded}',   '${POSTER}', 'refund_pending', 15, 'pi_partial',       NULL, NULL),
  ('${P(4)}', '${B.v2Pending}',    '${POSTER}', 'captured',       35, 'pi_no_refund',     NULL, NULL),
  ('${P(5)}', '${B.v2Canceled}',   '${POSTER}', 'released',       15, 'pi_released',      NULL, NULL),
  ('${P(6)}', '${B.v1Unfunded}',   '${POSTER}', 'refund_pending', 16, 'pi_not_refunded',  're_old', NULL),
  ('${P(7)}', '${B.v2LaterFailed}','${POSTER}', 'captured',       20, 'pi_later_failed', NULL, NULL);
INSERT INTO public.stripe_events (event_type, event_data, created_at) VALUES
  ('charge.refunded', '{"object":"charge","id":"ch_1","payment_intent":"pi_full_pending","refunded":true,"amount_refunded":1500}', now() - interval '2 min'),
  ('refund.created',  '{"object":"refund","id":"re_full_1","payment_intent":"pi_full_pending","amount":1500,"status":"succeeded"}', now() - interval '2 min'),
  ('charge.refunded', '{"object":"charge","id":"ch_2","payment_intent":"pi_full_captured","refunded":true,"amount_refunded":1000}', now()),
  ('refund.updated',  '{"object":"refund","id":"pyr_2","payment_intent":"pi_full_captured","amount":1000,"status":"succeeded"}', now()),
  ('charge.refunded', '{"object":"charge","id":"ch_3","payment_intent":"pi_partial","refunded":false,"amount_refunded":500}', now()),
  ('charge.refunded', '{"object":"charge","id":"ch_5","payment_intent":"pi_released","refunded":true,"amount_refunded":1500}', now()),
  ('charge.refunded', '{"object":"charge","id":"ch_6","payment_intent":"pi_not_refunded","refunded":false,"amount_refunded":0}', now()),
  ('charge.refunded', '{"object":"charge","id":"ch_7","payment_intent":"pi_later_failed","refunded":true,"amount_refunded":2000}', now()),
  ('refund.created', '{"object":"refund","id":"re_later_failed","payment_intent":"pi_later_failed","amount":2000,"status":"succeeded"}', now() - interval '1 min'),
  ('refund.failed',  '{"object":"refund","id":"re_later_failed","payment_intent":"pi_later_failed","amount":2000,"status":"failed"}', now());
`);
await db.exec(RECONCILE);
await db.exec(RECONCILE);

const snapshot = async () =>
  (await q(`SELECT id::text, status, stripe_refund_id, metadata FROM public.bounty_payments ORDER BY id`)).rows;
const before = await snapshot();
const dry = (await q(`SELECT * FROM public.admin_reconcile_stripe_refunded_bounty_payments()`)).rows;
check('dry run lists exactly the two fully proven rows',
  dry.map(r => r.bounty_payment_id).sort().join(',') === `${P(1)},${P(2)}`, dry);
check('dry run applies nothing', dry.every(r => r.applied === false));
check('dry run writes nothing', JSON.stringify(await snapshot()) === JSON.stringify(before));
check('partial refund, unrefunded charge, no evidence, later failed refund and released rows are never candidates',
  !dry.some(r => [P(3), P(4), P(5), P(6), P(7)].includes(r.bounty_payment_id)));

const applied = (await q(`SELECT * FROM public.admin_reconcile_stripe_refunded_bounty_payments(false)`)).rows;
check('apply marks both rows', applied.length === 2 && applied.every(r => r.applied === true), applied);
const r1 = await one(`SELECT * FROM public.bounty_payments WHERE id = $1`, [P(1)]);
check('refund_pending row -> refunded with the proven refund id, existing metadata kept',
  r1.status === 'refunded' && r1.stripe_refund_id === 're_full_1' && r1.metadata.source === 'x' &&
  r1.metadata.refund_reconciled_from === 'refund_pending', r1);
const r2 = await one(`SELECT * FROM public.bounty_payments WHERE id = $1`, [P(2)]);
check('captured row Stripe refunded -> refunded', r2.status === 'refunded' && r2.stripe_refund_id === 'pyr_2', r2);
const untouched = await one(
  `SELECT count(*)::int n FROM public.bounty_payments WHERE id = ANY($1::uuid[]) AND metadata IS NULL`,
  [[P(3), P(4), P(5), P(6), P(7)]]
);
check('every other row untouched', untouched.n === 5, untouched);
const again = (await q(`SELECT * FROM public.admin_reconcile_stripe_refunded_bounty_payments(false)`)).rows;
check('re-apply is a no-op', again.length === 0, again);

const reverted = await one(`SELECT public.admin_revert_stripe_refund_reconciliation() AS n`);
check('revert reports 2 rows', reverted.n === 2, reverted);
check('revert restores every row exactly', JSON.stringify(await snapshot()) === JSON.stringify(before), await snapshot());

let deniedRecon = null;
try { await asUser(POSTER, () => one(`SELECT * FROM public.admin_reconcile_stripe_refunded_bounty_payments()`)); }
catch (e) { deniedRecon = e.code; }
check('authenticated may not run the reconciliation (42501)', deniedRecon === '42501', deniedRecon);
const reconGrants = await one(`SELECT
  has_function_privilege('anon', 'public.admin_reconcile_stripe_refunded_bounty_payments(boolean)', 'EXECUTE') a,
  has_function_privilege('service_role', 'public.admin_reconcile_stripe_refunded_bounty_payments(boolean)', 'EXECUTE') s`);
check('anon no, service_role yes', reconGrants.a === false && reconGrants.s === true, reconGrants);

await db.exec(RECONCILE_ROLLBACK);
const gone = await one(`SELECT count(*)::int n FROM pg_proc WHERE proname IN
  ('admin_reconcile_stripe_refunded_bounty_payments', 'admin_revert_stripe_refund_reconciliation')`);
check('rollback drops both functions', gone.n === 0, gone);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
