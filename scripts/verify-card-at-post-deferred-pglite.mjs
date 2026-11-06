/* scripts/verify-card-at-post-deferred-pglite.mjs
 *
 * Functional checks, on an in-process PostgreSQL (PGlite), for
 *   supabase/migrations/20261104120000_card_at_post_deferred_bounty_intake.sql
 *
 * The schema is a minimal stand-in with production's columns (read from the
 * live catalog 2026-11-04). fn_bounties_enforce_posting_quality is loaded from
 * its real migration so the call-stack checks run against the real matcher.
 *
 * Usage:
 *   npm i --no-save @electric-sql/pglite   (or set PGLITE_DIR to a folder that has it)
 *   node scripts/verify-card-at-post-deferred-pglite.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const req = createRequire(process.env.PGLITE_DIR ? path.join(process.env.PGLITE_DIR, 'noop.js') : import.meta.url);
const { PGlite } = await import(pathToFileURL(req.resolve('@electric-sql/pglite')).href);
const read = f => fs.readFileSync(`${REPO}/supabase/${f}`, 'utf8');
const MIGRATION = read('migrations/20261104120000_card_at_post_deferred_bounty_intake.sql');
const ROLLBACK = read('rollbacks/production/20261104120000_card_at_post_deferred_bounty_intake.down.sql');
const CARD_AT_POST = read('migrations/20261020120000_first_time_poster_card_at_post.sql');
const QUALITY = read('migrations/20261019230000_posting_quality_rules.sql');

const db = await PGlite.create();
const q = (sql, params) => db.query(sql, params);
const one = async (sql, params) => (await q(sql, params)).rows[0];
let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok  ', name); }
  else { fail++; console.log('  FAIL', name, detail !== undefined ? JSON.stringify(detail) : ''); }
}
const errorOf = async fn => { try { await fn(); return null; } catch (e) { return e; } };

await db.exec(`
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid $$;

CREATE TYPE bounty_status_enum AS ENUM ('open','in_progress','completed','cancellation_requested','cancelled','deleted');
CREATE TYPE work_type_enum AS ENUM ('online','in_person');
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE TABLE public.profiles (id uuid PRIMARY KEY, balance numeric DEFAULT 0, is_internal boolean DEFAULT false, created_at timestamptz DEFAULT now() - interval '30 days', stripe_customer_id text, account_status text DEFAULT 'active');
CREATE TABLE public.checkout_processing_failures (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), stripe_checkout_session_id text NOT NULL, stripe_event_id text, pending_bounty_id uuid, customer_email text, reason text NOT NULL, resolved boolean DEFAULT false);
CREATE FUNCTION public.is_account_active(p_user_id uuid) RETURNS boolean LANGUAGE sql STABLE AS
  $$ SELECT COALESCE((SELECT account_status = 'active' FROM public.profiles WHERE id = p_user_id), true) $$;
CREATE TABLE public.bounties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), poster_id uuid, user_id uuid, title text, description text,
  amount numeric, location text, category text, deadline timestamptz, status bounty_status_enum DEFAULT 'open',
  work_type work_type_enum DEFAULT 'online', is_for_honor boolean DEFAULT false, payment_architecture_version int DEFAULT 1,
  funding_mode text NOT NULL DEFAULT 'at_post', latitude double precision, longitude double precision,
  zip_code text, neighborhood text, accepted_by uuid, accepted_request_id uuid, completed_at timestamptz);
CREATE TABLE public.bounty_requests (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bounty_id uuid, status text);
CREATE TABLE public.bounty_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bounty_id uuid, poster_id uuid, event_type text);
CREATE TABLE public.pending_bounties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text NOT NULL, description text NOT NULL DEFAULT '', amount numeric NOT NULL,
  location text, category text, deadline timestamptz, work_type text NOT NULL DEFAULT 'online', latitude double precision,
  longitude double precision, zip_code text, neighborhood text, source text NOT NULL DEFAULT 'web', email text NOT NULL DEFAULT 'x@y.z',
  status text NOT NULL DEFAULT 'pending_payment' CONSTRAINT pending_bounties_status_check CHECK (status IN ('pending_payment','paid','created','expired','failed')), resulting_bounty_id uuid REFERENCES public.bounties(id) ON DELETE SET NULL,
  supabase_user_id uuid, stripe_checkout_session_id text, stripe_customer_id text, stripe_payment_intent_id text, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE public.bounty_payments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bounty_id uuid, status text);
CREATE TABLE public.wallet_transactions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, bounty_id uuid, type text, status text, amount numeric, description text, metadata jsonb);
CREATE TABLE public.payment_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, stripe_payment_method_id text NOT NULL UNIQUE,
  type text NOT NULL DEFAULT 'card', is_default boolean DEFAULT false, card_brand text, card_last4 text, card_exp_month int, card_exp_year int);
CREATE TABLE public.posting_policy_config (id boolean PRIMARY KEY DEFAULT true);
CREATE TABLE public.payment_experiment_config (
  id boolean PRIMARY KEY DEFAULT true CHECK (id), deferred_funding_enabled boolean DEFAULT true,
  deferred_funding_scope text DEFAULT 'all_bounties', deferred_funding_max_amount numeric, updated_at timestamptz DEFAULT now());
INSERT INTO public.payment_experiment_config DEFAULT VALUES;
INSERT INTO public.posting_policy_config DEFAULT VALUES;
CREATE TABLE public.findings (kind text, details jsonb);
CREATE FUNCTION public.record_reconciliation_finding(p_finding_type text, p_severity text, p_user_id uuid, p_details jsonb)
  RETURNS void LANGUAGE sql AS $$ INSERT INTO public.findings VALUES (p_finding_type, p_details) $$;
CREATE FUNCTION public.update_balance(p_user uuid, p_amount numeric) RETURNS void LANGUAGE sql AS
  $$ UPDATE public.profiles SET balance = balance + p_amount WHERE id = p_user $$;

-- Live fn_reserve_bounty_escrow's decision and debit.
CREATE FUNCTION public.fn_reserve_bounty_escrow() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF COALESCE(NEW.payment_architecture_version, 1) = 2 THEN RETURN NEW; END IF;
  IF NEW.funding_mode = 'at_accept' THEN RETURN NEW; END IF;
  IF NEW.is_for_honor IS TRUE OR NEW.amount IS NULL OR NEW.amount <= 0 THEN RETURN NEW; END IF;
  INSERT INTO public.wallet_transactions (user_id, bounty_id, type, amount, status)
    VALUES (COALESCE(NEW.poster_id, NEW.user_id), NEW.id, 'escrow', -NEW.amount, 'completed');
  PERFORM public.update_balance(COALESCE(NEW.poster_id, NEW.user_id), -NEW.amount);
  RETURN NEW;
END $$;
CREATE TRIGGER trg_bounties_reserve_escrow AFTER INSERT ON public.bounties FOR EACH ROW EXECUTE FUNCTION public.fn_reserve_bounty_escrow();
`);

// The prior state: the real SBA-05 migration (scope column, requirement fn,
// fn_is_first_time_poster, fn_can_defer) and the real posting-quality trigger.
await db.exec(CARD_AT_POST);
await db.exec(`
CREATE FUNCTION public.fn_bounties_normalize_funding_mode() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.is_for_honor IS TRUE OR COALESCE(NEW.payment_architecture_version, 1) <> 1 OR NEW.amount IS NULL OR NEW.amount <= 0 THEN
    NEW.funding_mode := 'at_post'; RETURN NEW;
  END IF;
  IF public.fn_can_defer_bounty_funding(COALESCE(NEW.poster_id, NEW.user_id), NEW.amount) THEN NEW.funding_mode := 'at_accept';
  ELSE NEW.funding_mode := 'at_post'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_bounties_normalize_funding_mode BEFORE INSERT ON public.bounties FOR EACH ROW EXECUTE FUNCTION public.fn_bounties_normalize_funding_mode();
`);
await db.exec(QUALITY);

const POSTER = '00000000-0000-0000-0000-00000000000a';
const FRESH = '00000000-0000-0000-0000-00000000000b';
const NOCARD = '00000000-0000-0000-0000-00000000000c';
await q(`INSERT INTO public.profiles (id, balance) VALUES ($1, 7), ($2, 0)`, [POSTER, NOCARD]);
await q(`INSERT INTO public.profiles (id, balance, created_at) VALUES ($1, 0, now())`, [FRESH]);
await q(`INSERT INTO public.payment_methods (user_id, stripe_payment_method_id) VALUES ($1,'pm_poster'), ($2,'pm_fresh')`, [POSTER, FRESH]);
await q(`INSERT INTO public.payment_methods (user_id, stripe_payment_method_id, type) VALUES ($1,'ba_only','us_bank_account')`, [NOCARD]);

const setScope = s => q(`UPDATE public.payment_experiment_config SET card_at_post_scope = $1`, [s]);
async function requirement(uid, amount) {
  await db.exec('BEGIN');
  try {
    await q(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, role: 'authenticated' })]);
    await db.exec('SET LOCAL ROLE authenticated');
    return (await one(`SELECT public.fn_get_posting_card_requirement($1) AS r`, [amount])).r;
  } finally { await db.exec('ROLLBACK'); }
}
const pending = async (over = {}) => (await one(
  `INSERT INTO public.pending_bounties (title, description, amount, work_type, location)
   VALUES ($1, $2, $3, $4, $5) RETURNING id`,
  [over.title ?? 'Walk my cat', 'A long enough description for the rules', over.amount ?? 20, over.work_type ?? 'online', over.location ?? null])).id;
const deferred = (id, poster = POSTER, pm = 'pm_poster', session = `cs_${id}`) =>
  one(`SELECT * FROM public.fn_create_bounty_from_pending_deferred($1, $2, $3, $4)`, [id, poster, session, pm]);
const balance = async id => Number((await one(`SELECT balance FROM public.profiles WHERE id = $1`, [id])).balance);

const beforeRefused = await errorOf(() => setScope('all_posters'));
check('before: all_posters refused by the constraint', beforeRefused?.code === '23514', beforeRefused?.code);

async function afterChecks(label) {
  console.log(`\n${label}`);
  const sw = await one(`SELECT web_card_at_post_enabled e FROM public.payment_experiment_config`);
  check('website switch exists and defaults off', sw.e === false, sw);
await setScope('all_posters');
  check('constraint accepts all_posters', true);

  let r = await requirement(NOCARD, 20);
  check('all_posters, no card row (bank account does not count) -> required', r.card_required === true, r);
  check('all_posters, card on file -> not required', (await requirement(POSTER, 20)).card_required === false);
  check('all_posters, $0 -> not required', (await requirement(NOCARD, 0)).card_required === false);
  r = await requirement(NOCARD, null);
  check('all_posters, null amount -> false, not null', r.card_required === false, r);

  await setScope('first_time_posters');
  check('first_time_posters: first-time poster with a card still required (unchanged)',
    (await requirement(POSTER, 20)).card_required === true);
  check('first_time_posters: $0 not required', (await requirement(POSTER, 0)).card_required === false);
  await q(`INSERT INTO public.bounty_events (poster_id, event_type) VALUES ($1, 'accepted')`, [NOCARD]);
  await q(`INSERT INTO public.bounties (poster_id, user_id, title, amount, status, accepted_by) VALUES ($1,$1,'hired',0,'completed',$1)`, [NOCARD]);
  check('first_time_posters: repeat poster with no card not required', (await requirement(NOCARD, 20)).card_required === false);
  await setScope('off');
  check('off: nobody', (await requirement(NOCARD, 20)).card_required === false);

  console.log('\n  deferred intake');
  await q(`UPDATE public.payment_experiment_config SET deferred_funding_enabled = false`);
  const before = await balance(POSTER);
  const id = await pending();
  const made = await deferred(id);
  check('creates a bounty', made.created === true && !!made.bounty_id, made);
  const b = await one(`SELECT * FROM public.bounties WHERE id = $1`, [made.bounty_id]);
  check('kill switch off: still at_accept', b.funding_mode === 'at_accept', b.funding_mode);
  check('payment_architecture_version = 1', b.payment_architecture_version === 1);
  check('no wallet escrow, balance untouched',
    (await one(`SELECT count(*)::int c FROM public.wallet_transactions WHERE bounty_id = $1`, [b.id])).c === 0 && (await balance(POSTER)) === before);
  check('no bounty_payments row', (await one(`SELECT count(*)::int c FROM public.bounty_payments WHERE bounty_id = $1`, [b.id])).c === 0);
  const p = await one(`SELECT * FROM public.pending_bounties WHERE id = $1`, [id]);
  check('pending created + linked + session recorded',
    p.status === 'created' && p.resulting_bounty_id === b.id && p.stripe_checkout_session_id === `cs_${id}` && p.supabase_user_id === POSTER, p);

  const replay = await deferred(id);
  check('replay: created=false, same bounty', replay.created === false && replay.bounty_id === b.id, replay);
  check('replay: no second bounty', (await one(`SELECT count(*)::int c FROM public.bounties WHERE title = 'Walk my cat' AND id = $1`, [b.id])).c === 1);

  const countBefore = (await one(`SELECT count(*)::int c FROM public.bounties`)).c;
  await q(`DELETE FROM public.bounties WHERE id = $1`, [b.id]);
  const afterDelete = await deferred(id);
  check('replay after the poster deleted it: no resurrection',
    afterDelete.created === false && afterDelete.bounty_id === null &&
    (await one(`SELECT count(*)::int c FROM public.bounties`)).c === countBefore - 1, afterDelete);

  console.log('\n  the bypass is only for this function');
  const v1 = await one(`INSERT INTO public.bounties (poster_id, user_id, title, amount, funding_mode) VALUES ($1,$1,'direct',2,'at_accept') RETURNING id, funding_mode`, [POSTER]);
  check('kill switch off: a direct insert asking at_accept is still at_post', v1.funding_mode === 'at_post', v1);
  check('...and the debit fires as before', (await balance(POSTER)) === before - 2);
  await q(`UPDATE public.profiles SET balance = balance + 2 WHERE id = $1`, [POSTER]);
  await q(`UPDATE public.payment_experiment_config SET deferred_funding_enabled = true`);
  const v2 = await one(`INSERT INTO public.bounties (poster_id, user_id, title, amount, payment_architecture_version) VALUES ($1,$1,'v2',5,2) RETURNING funding_mode`, [POSTER]);
  check('v2 insert still at_post', v2.funding_mode === 'at_post');
  const honor = await one(`INSERT INTO public.bounties (poster_id, user_id, title, amount, is_for_honor) VALUES ($1,$1,'honor',0,true) RETURNING funding_mode`, [POSTER]);
  check('honor insert still at_post', honor.funding_mode === 'at_post');
  const normal = await one(`INSERT INTO public.bounties (poster_id, user_id, title, amount) VALUES ($1,$1,'normal',3) RETURNING funding_mode`, [POSTER]);
  check('normal v1 insert at_accept when deferral is on', normal.funding_mode === 'at_accept');

  console.log('\n  refusals');
  const noCard = await errorOf(async () => deferred(await pending(), POSTER, 'pm_someone_else'));
  check('a card not saved to this poster is refused, with the terminal prefix',
    noCard?.message?.startsWith('fn_create_bounty_from_pending_deferred:'), noCard?.message);
  const notMine = await errorOf(async () => deferred(await pending(), POSTER, 'pm_fresh'));
  check("another poster's card is refused", notMine?.message?.includes('is not saved to poster'), notMine?.message);
  const nf = await errorOf(() => deferred('99999999-9999-4999-8999-999999999999'));
  check('missing pending row: terminal prefix and "not found" suffix', /^fn_create_bounty_from_pending_deferred:.* not found$/.test(nf?.message ?? ''), nf?.message);

  const a = await deferred(await pending(), FRESH, 'pm_fresh');
  const c = await deferred(await pending(), FRESH, 'pm_fresh');
  check('new account: first two posts allowed', a.created && c.created);
  const failPending = await pending();
  const third = await errorOf(() => deferred(failPending, FRESH, 'pm_fresh'));
  check('new account: third post refused with 23514 (not exempt)', third?.code === '23514', third?.message);
  const stillPending = await one(`SELECT status FROM public.pending_bounties WHERE id = $1`, [failPending]);
  check('...and the refusal rolled back cleanly', stillPending.status === 'pending_payment');
  await q(`DELETE FROM public.bounties WHERE poster_id = $1`, [FRESH]);

  const ip = await pending({ work_type: 'in_person', location: '1 Main St' });
  await deferred(ip);
  const f = await one(`SELECT * FROM public.findings WHERE kind = 'bounty_location_not_geocoded' ORDER BY details->>'pendingBountyId' = $1 DESC LIMIT 1`, [ip]);
  check('in-person post with no point pages an admin', f?.details?.pendingBountyId === ip, f);

  console.log('\n  new-account cap, asked ahead');
  const capped = async () => (await one(`SELECT public.fn_new_account_open_cap_reached($1) AS r`, [FRESH])).r;
  check('new account with 0 open: not reached', (await capped()) === false);
  await deferred(await pending(), FRESH, 'pm_fresh');
  await deferred(await pending(), FRESH, 'pm_fresh');
  check('new account with 2 open: reached, where the trigger would refuse', (await capped()) === true);
  await q(`UPDATE public.profiles SET is_internal = true WHERE id = $1`, [FRESH]);
  check('internal account: exempt, as in the trigger', (await capped()) === false);
  await q(`UPDATE public.profiles SET is_internal = false, created_at = now() - interval '2 days' WHERE id = $1`, [FRESH]);
  check('account over 24h old: not reached', (await capped()) === false);
  await q(`UPDATE public.profiles SET created_at = now() WHERE id = $1`, [FRESH]);
  await q(`DELETE FROM public.bounties WHERE poster_id = $1`, [FRESH]);
  check('unknown user: false, not null', (await one(`SELECT public.fn_new_account_open_cap_reached('99999999-9999-4999-8999-999999999999') AS r`)).r === false);

  console.log('\n  sign-in hold');
  const CLAIMER = crypto.randomUUID();
  await q(`INSERT INTO auth.users (id) VALUES ($1)`, [CLAIMER]);
  await q(`INSERT INTO public.profiles (id, stripe_customer_id) VALUES ($1, NULL)`, [CLAIMER]);
  await q(`INSERT INTO public.payment_methods (user_id, stripe_payment_method_id, is_default) VALUES ($1, $2, true)`, [CLAIMER, `pm_old_${CLAIMER}`]);
  const hold = async (card, user = CLAIMER) => {
    const hid = await pending();
    await q(`UPDATE public.pending_bounties SET status = 'awaiting_sign_in', claim_user_id = $2, claim_card = $3,
             claim_requested_at = now(), stripe_checkout_session_id = $4 WHERE id = $1`,
      [hid, user, JSON.stringify(card), `cs_${hid}`]);
    return hid;
  };
  const claim = async (id, u = CLAIMER) => (await q(`SELECT * FROM public.fn_claim_pending_bounties($1, $2)`, [u, id])).rows;
  const heldCard = { payment_method_id: `pm_held_${CLAIMER}`, customer_id: 'cus_session', brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2030 };
  const heldId = await hold(heldCard);
  const untouched = await one(`SELECT count(*)::int c FROM public.bounties WHERE poster_id = $1`, [CLAIMER]);
  check('held: no bounty and no card on the account yet', untouched.c === 0 &&
    (await one(`SELECT count(*)::int c FROM public.payment_methods WHERE stripe_payment_method_id = $1`, [heldCard.payment_method_id])).c === 0);
  check('another user confirming it finds nothing', (await claim(heldId, POSTER)).length === 0);
  const otherHeld = await hold({ ...heldCard, payment_method_id: `pm_other_held_${CLAIMER}` });
  const claimed = await claim(heldId);
  check('confirming one post leaves another held post alone',
    (await one(`SELECT status FROM public.pending_bounties WHERE id = $1`, [otherHeld])).status === 'awaiting_sign_in');
  await q(`UPDATE public.pending_bounties SET status = 'expired' WHERE id = $1`, [otherHeld]);
  check('the matched user signing in claims it', claimed.length === 1 && claimed[0].outcome === 'created' && !!claimed[0].bounty_id, claimed);
  const cb = await one(`SELECT * FROM public.bounties WHERE id = $1`, [claimed[0].bounty_id]);
  check('claimed bounty is v1 at_accept on that account', cb.funding_mode === 'at_accept' && cb.payment_architecture_version === 1 && cb.poster_id === CLAIMER);
  const pm = await one(`SELECT * FROM public.payment_methods WHERE stripe_payment_method_id = $1`, [heldCard.payment_method_id]);
  check('card saved as the default, details intact', pm.user_id === CLAIMER && pm.is_default === true && pm.card_last4 === '4242' && pm.card_exp_year === 2030, pm);
  check('other default unset', (await one(`SELECT is_default FROM public.payment_methods WHERE stripe_payment_method_id = $1`, [`pm_old_${CLAIMER}`])).is_default === false);
  check('customer set when the profile had none', (await one(`SELECT stripe_customer_id s FROM public.profiles WHERE id = $1`, [CLAIMER])).s === 'cus_session');
  const heldAfter = await one(`SELECT * FROM public.pending_bounties WHERE id = $1`, [heldId]);
  check('pending created, card cleared', heldAfter.status === 'created' && heldAfter.claim_card === null && heldAfter.supabase_user_id === CLAIMER, heldAfter);
  check('confirming again does nothing', (await claim(heldId)).length === 0);

  const otherCustomer = { ...heldCard, payment_method_id: `pm_other_${CLAIMER}`, customer_id: 'cus_someone_else' };
  await claim(await hold(otherCustomer));
  const op = await one(`SELECT is_default FROM public.payment_methods WHERE stripe_payment_method_id = $1`, [otherCustomer.payment_method_id]);
  check('card on a different customer: saved, not default', op.is_default === false, op);
  check('...existing default and customer kept',
    (await one(`SELECT is_default FROM public.payment_methods WHERE stripe_payment_method_id = $1`, [heldCard.payment_method_id])).is_default === true &&
    (await one(`SELECT stripe_customer_id s FROM public.profiles WHERE id = $1`, [CLAIMER])).s === 'cus_session');

  const staleId = await hold({ ...heldCard, payment_method_id: `pm_stale_${CLAIMER}` });
  await q(`UPDATE public.pending_bounties SET claim_requested_at = now() - interval '8 days' WHERE id = $1`, [staleId]);
  check('a hold over 7 days old is not claimed', (await claim(staleId)).length === 0);

  const NEWBIE = crypto.randomUUID();
  await q(`INSERT INTO auth.users (id) VALUES ($1)`, [NEWBIE]);
  await q(`INSERT INTO public.profiles (id, created_at) VALUES ($1, now())`, [NEWBIE]);
  const nbCard = i => ({ payment_method_id: `pm_nb${i}_${NEWBIE}`, customer_id: 'cus_nb', brand: 'visa', last4: '1111', exp_month: 1, exp_year: 2031 });
  const nbRows = [];
  nbRows.push(...await claim(await hold(nbCard(1), NEWBIE), NEWBIE));
  nbRows.push(...await claim(await hold(nbCard(2), NEWBIE), NEWBIE));
  const thirdHold = await hold(nbCard(3), NEWBIE);
  nbRows.push(...await claim(thirdHold, NEWBIE));
  check('claim hits the cap: two created, third failed, no abort',
    nbRows.filter(r => r.outcome === 'created').length === 2 && nbRows.filter(r => r.outcome === 'failed').length === 1, nbRows);
  check('...failed row recorded, and its card rolled back',
    (await one(`SELECT status FROM public.pending_bounties WHERE id = $1`, [thirdHold])).status === 'failed' &&
    (await one(`SELECT count(*)::int c FROM public.checkout_processing_failures WHERE pending_bounty_id = $1`, [thirdHold])).c === 1 &&
    (await one(`SELECT count(*)::int c FROM public.payment_methods WHERE stripe_payment_method_id = $1`, [nbCard(3).payment_method_id])).c === 0);

  const SUSP = crypto.randomUUID();
  await q(`INSERT INTO auth.users (id) VALUES ($1)`, [SUSP]);
  await q(`INSERT INTO public.profiles (id, account_status) VALUES ($1, 'suspended')`, [SUSP]);
  const suspId = await hold({ ...heldCard, payment_method_id: `pm_susp_${SUSP}` }, SUSP);
  const suspRows = await claim(suspId, SUSP);
  check('suspended account: claim refused, nothing created',
    suspRows[0]?.outcome === 'failed' && (await one(`SELECT count(*)::int c FROM public.bounties WHERE poster_id = $1`, [SUSP])).c === 0, suspRows);
  check('...recorded failed', (await one(`SELECT status FROM public.pending_bounties WHERE id = $1`, [suspId])).status === 'failed');

  await q(`DELETE FROM public.bounties WHERE poster_id = ANY($1)`, [[CLAIMER, NEWBIE]]);
  await q(`DELETE FROM public.pending_bounties WHERE claim_user_id IS NOT NULL`);

  const newGrants = await one(`SELECT
    has_function_privilege('authenticated', 'public.fn_claim_pending_bounties(uuid,uuid)', 'EXECUTE') AS claim_authn,
    has_function_privilege('anon', 'public.fn_claim_pending_bounties(uuid,uuid)', 'EXECUTE') AS claim_anon,
    has_function_privilege('service_role', 'public.fn_claim_pending_bounties(uuid,uuid)', 'EXECUTE') AS claim_svc,
    has_function_privilege('authenticated', 'public.fn_new_account_open_cap_reached(uuid)', 'EXECUTE') AS cap_authn,
    has_function_privilege('service_role', 'public.fn_new_account_open_cap_reached(uuid)', 'EXECUTE') AS cap_svc`);
  check('claim and cap fns: service_role only',
    !newGrants.claim_authn && !newGrants.claim_anon && newGrants.claim_svc && !newGrants.cap_authn && newGrants.cap_svc, newGrants);

  const grants = await one(`SELECT
    has_function_privilege('anon', 'public.fn_create_bounty_from_pending_deferred(uuid,uuid,text,text)', 'EXECUTE') AS anon,
    has_function_privilege('authenticated', 'public.fn_create_bounty_from_pending_deferred(uuid,uuid,text,text)', 'EXECUTE') AS authn,
    has_function_privilege('service_role', 'public.fn_create_bounty_from_pending_deferred(uuid,uuid,text,text)', 'EXECUTE') AS svc,
    has_function_privilege('anon', 'public.fn_get_posting_card_requirement(numeric)', 'EXECUTE') AS req_anon,
    has_function_privilege('authenticated', 'public.fn_get_posting_card_requirement(numeric)', 'EXECUTE') AS req_authn`);
  check('deferred fn: service_role only', !grants.anon && !grants.authn && grants.svc, grants);
  check('requirement fn: grants unchanged', !grants.req_anon && grants.req_authn, grants);
  await q(`DELETE FROM public.bounties WHERE poster_id = $1 AND title <> 'hired'`, [NOCARD]);
  await q(`DELETE FROM public.bounty_events WHERE poster_id = $1`, [NOCARD]);
  await q(`DELETE FROM public.bounties WHERE poster_id = $1`, [NOCARD]);
  await q(`DELETE FROM public.bounties WHERE poster_id = $1`, [POSTER]);
}

await db.exec(MIGRATION);
await afterChecks('After the migration');
await db.exec(MIGRATION);
await afterChecks('After applying it twice');

console.log('\nAfter the rollback');
await setScope('all_posters');
await db.exec(ROLLBACK);
check('all_posters falls back to off', (await one(`SELECT card_at_post_scope s FROM public.payment_experiment_config`)).s === 'off');
check('deferred fn gone', (await one(`SELECT count(*)::int c FROM pg_proc WHERE proname = 'fn_create_bounty_from_pending_deferred'`)).c === 0);
check('website switch gone', (await one(`SELECT count(*)::int c FROM information_schema.columns WHERE table_name = 'payment_experiment_config' AND column_name = 'web_card_at_post_enabled'`)).c === 0);
check('claim and cap fns gone', (await one(`SELECT count(*)::int c FROM pg_proc WHERE proname IN ('fn_claim_pending_bounties','fn_new_account_open_cap_reached')`)).c === 0);
check('claim columns gone', (await one(`SELECT count(*)::int c FROM information_schema.columns WHERE table_name = 'pending_bounties' AND column_name LIKE 'claim_%'`)).c === 0);
const again = await errorOf(() => setScope('all_posters'));
check('constraint restored', again?.code === '23514');
await q(`UPDATE public.payment_experiment_config SET deferred_funding_enabled = false`);
const restored = await one(`INSERT INTO public.bounties (poster_id, user_id, title, amount) VALUES ($1,$1,'after',1) RETURNING funding_mode`, [POSTER]);
check('normalize trigger back to normal', restored.funding_mode === 'at_post');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
