-- Behavioural test for 20261110120000_cancelled_bounty_money_reconciliation.sql
--
-- Seeds a copy of the 5e96aaed case (fresh ids, nothing read from or written
-- to real rows), then checks both findings and the admin guard. Everything
-- runs in one transaction that ends in ROLLBACK, so it leaves nothing behind.
--
-- Run on a Supabase branch (never production):
--   psql "$BRANCH_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/20261110120000_cancelled_bounty_money_reconciliation.test.sql
-- A failed expectation raises and stops the run; success prints
-- "P10 reconciliation + admin guard: all checks passed".
--
-- Seeding skips row triggers (session_replication_role = replica) so posting
-- policy, geocoding and notification triggers don't need a real listing; they
-- are switched back on before anything under test runs.

BEGIN;

CREATE TEMP TABLE t_ids AS SELECT
  gen_random_uuid() AS poster,       -- the senior poster
  gen_random_uuid() AS founder,      -- admin who also applied (5e96aaed's actor)
  gen_random_uuid() AS admin2,       -- a second admin
  gen_random_uuid() AS applicant,    -- another hunter who applied
  gen_random_uuid() AS stranger,     -- never applied
  gen_random_uuid() AS b_cancelled,  -- copy of 5e96aaed: cancelled, $35 captured
  gen_random_uuid() AS b_open,       -- open, $35 captured
  gen_random_uuid() AS b_wallet,     -- open, wallet escrow held
  gen_random_uuid() AS b_rp_old,     -- refund_pending for 25 h
  gen_random_uuid() AS b_rp_new,     -- refund_pending for 2 h
  gen_random_uuid() AS b_test,       -- deleted, is_test, $10 captured
  gen_random_uuid() AS p_cancelled, gen_random_uuid() AS p_open,
  gen_random_uuid() AS p_rp_old, gen_random_uuid() AS p_rp_new, gen_random_uuid() AS p_test;

-- Helpers ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.act_as(p_user uuid, p_admin boolean) RETURNS void
LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated',
                      'app_metadata', json_build_object('role', CASE WHEN p_admin THEN 'admin' ELSE 'user' END))::text,
    true);
$$;

CREATE OR REPLACE FUNCTION pg_temp.expect_error(p_sql text, p_state text, p_like text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> p_state OR SQLERRM NOT LIKE p_like THEN
      RAISE EXCEPTION 'expected % "%", got % "%" for: %', p_state, p_like, SQLSTATE, SQLERRM, p_sql;
    END IF;
    RETURN;
  END;
  RAISE EXCEPTION 'expected % "%", but it succeeded: %', p_state, p_like, p_sql;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.check(p_ok boolean, p_what text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN RAISE EXCEPTION 'FAILED: %', p_what; END IF;
  RAISE NOTICE 'ok: %', p_what;
END;
$$;

-- Seed ---------------------------------------------------------------------
SET LOCAL session_replication_role = replica;

INSERT INTO auth.users (id, raw_app_meta_data)
SELECT u, jsonb_build_object('role', r) FROM t_ids,
  LATERAL (VALUES (poster,'user'),(founder,'admin'),(admin2,'admin'),(applicant,'user'),(stranger,'user')) v(u, r);
INSERT INTO public.profiles (id, username)
SELECT u, 'p10_' || left(u::text, 8) FROM t_ids,
  LATERAL (VALUES (poster),(founder),(admin2),(applicant),(stranger)) v(u);

INSERT INTO public.bounties (id, poster_id, title, description, amount, status, is_test, created_at, updated_at)
SELECT b, poster, 'P10 test ' || s, 'P10 reconciliation test fixture', amt, s::public.bounty_status_enum, tst, now() - interval '35 days', now() - interval '34 days'
FROM t_ids, LATERAL (VALUES
  (b_cancelled, 'cancelled', 35, false),
  (b_open,      'open',      35, false),
  (b_wallet,    'open',      20, false),
  (b_rp_old,    'archived',  15, false),
  (b_rp_new,    'archived',  15, false),
  (b_test,      'deleted',   10, true)) v(b, s, amt, tst);

INSERT INTO public.bounty_payments
  (id, bounty_id, poster_id, stripe_payment_intent_id, stripe_charge_id, transfer_group, amount,
   capture_method, status, metadata, created_at, updated_at, currency)
SELECT p, b, poster, 'pi_p10_' || left(p::text, 8), 'ch_p10_' || left(p::text, 8), 'bounty_' || b, amt,
       'automatic', st, '{}'::jsonb, now() - interval '35 days', upd, 'usd'
FROM t_ids, LATERAL (VALUES
  (p_cancelled, b_cancelled, 35, 'captured',       now() - interval '35 days'),
  (p_open,      b_open,      35, 'captured',       now() - interval '35 days'),
  (p_rp_old,    b_rp_old,    15, 'refund_pending', now() - interval '25 hours'),
  (p_rp_new,    b_rp_new,    15, 'refund_pending', now() - interval '2 hours'),
  (p_test,      b_test,      10, 'captured',       now() - interval '35 days')) v(p, b, amt, st, upd);

INSERT INTO public.wallet_transactions (user_id, bounty_id, type, amount, status)
SELECT poster, b_wallet, 'escrow', -20, 'completed' FROM t_ids;

-- The founder applied to both copies; the applicant applied to b_open.
-- (For b_cancelled the request row is gone, as on 5e96aaed; only the event remains.)
INSERT INTO public.bounty_events (event_key, event_type, source, bounty_id, actor_id, occurred_at, metadata)
SELECT 'p10:' || b || ':' || a, 'application.submitted', 'app', b, a, now() - interval '34 days', '{}'::jsonb
FROM t_ids, LATERAL (VALUES (b_cancelled, founder), (b_open, founder), (b_open, applicant)) v(b, a);

SET LOCAL session_replication_role = origin;

-- 1. Findings ----------------------------------------------------------------
SELECT public.run_bounty_money_reconciliation();

SELECT pg_temp.check(
  (SELECT count(*) = 1 AND bool_and(severity = 'critical') FROM public.reconciliation_findings f, t_ids
    WHERE f.finding_type = 'cancelled_bounty_captured_payment' AND f.details->>'bounty_payment_id' = p_cancelled::text
      AND f.resolved_at IS NULL),
  'cancelled_bounty_captured_payment fires (critical) for the 5e96aaed copy');
SELECT pg_temp.check(
  (SELECT count(*) = 1 AND bool_and(severity = 'warning') FROM public.reconciliation_findings f, t_ids
    WHERE f.finding_type = 'cancelled_bounty_captured_payment' AND f.details->>'bounty_payment_id' = p_test::text),
  'an is_test bounty is reported as warning, not critical');
SELECT pg_temp.check(
  NOT EXISTS (SELECT 1 FROM public.reconciliation_findings f, t_ids
               WHERE f.details->>'bounty_payment_id' = p_open::text),
  'an open bounty with a captured payment is not a finding');
SELECT pg_temp.check(
  (SELECT count(*) = 1 FROM public.reconciliation_findings f, t_ids
    WHERE f.finding_type = 'refund_pending_without_stripe_refund' AND f.details->>'bounty_payment_id' = p_rp_old::text),
  'refund_pending_without_stripe_refund fires after 24 h');
SELECT pg_temp.check(
  NOT EXISTS (SELECT 1 FROM public.reconciliation_findings f, t_ids
               WHERE f.details->>'bounty_payment_id' = p_rp_new::text),
  'refund_pending inside 24 h is not a finding');

SELECT public.run_bounty_money_reconciliation();
SELECT pg_temp.check(
  (SELECT count(*) = 1 AND max(occurrence_count) = 2 FROM public.reconciliation_findings f, t_ids
    WHERE f.details->>'bounty_payment_id' = p_cancelled::text),
  'a second run updates the open finding instead of adding one');

INSERT INTO public.reconciliation_known_exceptions (finding_type, user_id, reason, subject_key)
SELECT 'refund_pending_without_stripe_refund', poster, 'P10 test: reviewed', p_rp_old::text FROM t_ids;
SELECT public.run_bounty_money_reconciliation();
SELECT pg_temp.check(
  (SELECT resolved_at IS NOT NULL FROM public.reconciliation_findings f, t_ids
    WHERE f.details->>'bounty_payment_id' = p_rp_old::text),
  'a known exception for that payment resolves and stops the finding');
SELECT pg_temp.check(
  (SELECT resolved_at IS NULL FROM public.reconciliation_findings f, t_ids
    WHERE f.details->>'bounty_payment_id' = p_cancelled::text),
  '...and leaves the poster''s other findings alone');

-- 2. Admin guard -------------------------------------------------------------
SELECT pg_temp.act_as(applicant, false) FROM t_ids;
SELECT pg_temp.expect_error(format(
  $q$SELECT public.admin_set_bounty_status(%L, 'cancelled', 'not an admin', 'refund_poster')$q$, b_open),
  '42501', '%admin role required%') FROM t_ids;

SELECT pg_temp.act_as(admin2, true) FROM t_ids;
SELECT pg_temp.expect_error(format(
  $q$SELECT public.admin_set_bounty_status(%L, 'cancelled', 'Admin console: Cancel')$q$, b_open),
  '55000', 'disposition_required:%') FROM t_ids;
SELECT pg_temp.check(
  (SELECT status::text = 'open' FROM public.bounties, t_ids WHERE id = b_open),
  'cancel without a disposition is refused and changes nothing');
SELECT pg_temp.expect_error(format(
  $q$SELECT public.admin_set_bounty_status(%L, 'cancelled', 'x', 'give_it_away')$q$, b_open),
  '22023', 'invalid disposition%') FROM t_ids;
SELECT pg_temp.expect_error(format(
  $q$SELECT public.admin_set_bounty_status(%L, 'cancelled', 'x', 'refund_poster')$q$, b_wallet),
  '22023', 'a disposition applies only%') FROM t_ids;
SELECT pg_temp.expect_error(format(
  $q$SELECT public.admin_set_bounty_status(%L, 'cancelled', 'x')$q$, b_wallet),
  '55000', 'escrow_unsettled:wallet_escrow_held') FROM t_ids;
SELECT pg_temp.expect_error(format(
  $q$SELECT public.admin_set_bounty_status(%L, 'in_progress', 'x', 'keep_as_platform_revenue')$q$, b_open),
  '22023', 'a disposition applies only%') FROM t_ids;

-- pay_out_to_hunter: who may be paid
SELECT pg_temp.expect_error(format(
  $q$SELECT public.admin_set_bounty_status(%L, 'cancelled', 'x', 'pay_out_to_hunter')$q$, b_open),
  '22023', '%needs p_hunter_id%') FROM t_ids;
SELECT pg_temp.expect_error(format(
  $q$SELECT public.admin_set_bounty_status(%L, 'cancelled', 'x', 'pay_out_to_hunter', %L)$q$, b_open, stranger),
  '22023', '%never applied%') FROM t_ids;
SELECT pg_temp.act_as(founder, true) FROM t_ids;
SELECT pg_temp.expect_error(format(
  $q$SELECT public.admin_set_bounty_status(%L, 'cancelled', 'x', 'pay_out_to_hunter', %L)$q$, b_open, founder),
  '42501', '%own account%') FROM t_ids;
SELECT pg_temp.act_as(admin2, true) FROM t_ids;

SELECT public.admin_set_bounty_status(b_open, 'cancelled', 'Hunter did the job; pay them', 'pay_out_to_hunter', applicant) FROM t_ids;
SELECT pg_temp.check(
  (SELECT bp.status = 'captured' AND bp.hunter_id = applicant AND bp.metadata->'admin_disposition'->>'disposition' = 'pay_out_to_hunter'
     FROM public.bounty_payments bp, t_ids WHERE bp.id = p_open),
  'pay_out_to_hunter records the hunter and leaves the money for /admin-settle');
SELECT pg_temp.check(
  (SELECT b.status::text = 'cancelled' FROM public.bounties b, t_ids WHERE b.id = b_open),
  '...and the bounty is cancelled');
SELECT public.run_bounty_money_reconciliation();
SELECT pg_temp.check(
  EXISTS (SELECT 1 FROM public.reconciliation_findings f, t_ids
           WHERE f.finding_type = 'cancelled_bounty_captured_payment'
             AND f.details->>'bounty_payment_id' = p_open::text AND f.resolved_at IS NULL),
  '...and stays visible to reconciliation until the transfer lands');

-- keep_as_platform_revenue on an already-cancelled bounty (the 5e96aaed shape)
SELECT public.admin_set_bounty_status(b_cancelled, 'cancelled', 'Founder did the job off-platform; keep funds', 'keep_as_platform_revenue') FROM t_ids;
SELECT pg_temp.check(
  (SELECT bp.status = 'retained' AND bp.settlement_state::text = 'stripe_settled'
     FROM public.bounty_payments bp, t_ids WHERE bp.id = p_cancelled),
  'keep_as_platform_revenue marks the payment retained / stripe_settled');
SELECT pg_temp.check(
  (SELECT count(*) = 1 AND sum(amount) = 35 FROM public.platform_ledger pl, t_ids
    WHERE pl.bounty_id = b_cancelled AND pl.fee_type = 'retained_bounty_funds'),
  '...and writes one platform_ledger row for the amount');
SELECT pg_temp.check(
  (SELECT count(*) = 2 FROM public.admin_action_log l, t_ids
    WHERE l.action_type = 'bounty_status_disposition' AND l.admin_user_id = admin2
      AND l.metadata->>'bounty_id' IN (b_open::text, b_cancelled::text)),
  'each disposition writes admin_action_log with the acting admin');
SELECT pg_temp.check(
  (SELECT count(*) = 1 FROM public.bounty_events e, t_ids
    WHERE e.bounty_id = b_cancelled AND e.event_type = 'admin.status_changed'
      AND e.actor_id = admin2 AND e.metadata->>'disposition' = 'keep_as_platform_revenue'),
  'admin.status_changed names the admin and the disposition');
SELECT public.run_bounty_money_reconciliation();
SELECT pg_temp.check(
  (SELECT resolved_at IS NOT NULL FROM public.reconciliation_findings f, t_ids
    WHERE f.details->>'bounty_payment_id' = p_cancelled::text),
  'the finding resolves once the money is settled');
SELECT pg_temp.check(
  public.fn_bounty_unsettled_escrow_reason((SELECT b_cancelled FROM t_ids)) IS NULL,
  'a retained payment is no longer an escrow hold');

-- refund_poster
SET LOCAL session_replication_role = replica;
UPDATE public.bounties SET status = 'open' FROM t_ids WHERE id = b_rp_new;
UPDATE public.bounty_payments SET status = 'captured' FROM t_ids WHERE id = p_rp_new;
SET LOCAL session_replication_role = origin;
SELECT public.admin_set_bounty_status(b_rp_new, 'archived', 'Poster asked for their money back', 'refund_poster') FROM t_ids;
SELECT pg_temp.check(
  (SELECT bp.status = 'refund_pending' AND bp.metadata->'admin_disposition'->>'disposition' = 'refund_poster'
     FROM public.bounty_payments bp, t_ids WHERE bp.id = p_rp_new),
  'refund_poster queues the payment for the refund path (refund_pending)');

-- Unchanged behaviour
SELECT pg_temp.check(
  (SELECT (public.admin_set_bounty_status(b_rp_new, 'archived', 'again')).status::text = 'archived' FROM t_ids),
  'same-status call without a disposition is still a no-op');

DO $$ BEGIN RAISE NOTICE 'P10 reconciliation + admin guard: all checks passed'; END $$;

ROLLBACK;
