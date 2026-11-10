-- Settle bounty 5e96aaed-93bd-4ade-ae39-93b073d9daff ($35 captured, cancelled 2026-10-07)
--
-- DO NOT RUN until the founder has chosen ONE option and this file has been
-- reviewed. Nothing here calls Stripe.
--
-- STATE (read-only check, 2026-11-10)
--   bounties         5e96aaed  status cancelled, accepted_by NULL, payment_architecture_version 2
--   bounty_payments  7a665b48  status captured, settlement_state stripe_pending, $35.00,
--                              stripe_refund_id NULL, stripe_transfer_id NULL, hunter_id NULL
--   platform_ledger  none.  ledger_entries none.  wallet_transactions none.
--   The founder (f4bd948b-a0a6-4991-8e5d-d4a3978760e6) applied on 2026-10-06, then as admin
--   cancelled the bounty on 2026-10-07 and did the job off-platform.
--   His Connect account exists but has payouts_enabled = false.
--
-- OPTIONS (each is its own section below)
--   A. Mark completed, keep the $35 as platform revenue. Settles entirely here.
--      Side effect: moving to completed enqueues the poster's
--      'bounty_completed_followup' activation moment (trg_bounties_completed_activation).
--   B. Release to the founder's hunter account. This file records the decision;
--      the Stripe transfer is then run by bounty-payments POST /admin-settle
--      {"bountyId": "5e96aaed-..."}, same code and idempotency key as /release.
--      REFUSES while the founder's payouts_enabled is false.
--   C. Refund the poster. This file records the decision; the Stripe refund is
--      then run by POST /admin-settle, same code as the poster's own /cancel.
--   B and C are not finished until /admin-settle succeeds. Until then they stay
--   visible to reconciliation (cancelled_bounty_captured_payment for B,
--   refund_pending_without_stripe_refund for C after 24 h).
--
-- HOW TO RUN
--   Requires 20261110120000_cancelled_bounty_money_reconciliation.sql (A and B
--   check for it). Run the whole file once as-is: every section ends in
--   ROLLBACK, so that is a dry run of all three, printing BEFORE and AFTER rows
--   as NOTICEs. Then change exactly one section's ROLLBACK to COMMIT and run
--   only that section. Once one option is committed, the other two refuse
--   (their precondition is a still-captured payment with no disposition).
--   psql:        psql "$DB_URL" -v ON_ERROR_STOP=1 -f scripts/ops/settle-5e96aaed-2026-11.sql
--   SQL editor:  paste one section at a time.
--   Set c_actor below to the admin who is making the decision (it goes into
--   admin_action_log and bounty_events). It defaults to the founder.
--
-- Undo: scripts/ops/settle-5e96aaed-2026-11.rollback.sql (same three sections).

-- ===========================================================================
-- OPTION A — mark completed, keep as platform revenue
-- ===========================================================================
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.show_5e96aaed(p_label text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT 'bounty' AS what, to_jsonb(x) AS row FROM (
      SELECT id, status, accepted_by, completed_at, amount, updated_at FROM public.bounties
       WHERE id = '5e96aaed-93bd-4ade-ae39-93b073d9daff') x
    UNION ALL SELECT 'bounty_payment', to_jsonb(x) FROM (
      SELECT id, status, settlement_state, amount, hunter_id, stripe_refund_id, stripe_transfer_id,
             metadata->'admin_disposition' AS admin_disposition, updated_at
        FROM public.bounty_payments WHERE id = '7a665b48-5702-40a8-9184-fe7bf7a67daa') x
    UNION ALL SELECT 'platform_ledger', to_jsonb(x) FROM (
      SELECT id, amount, fee_type, created_at FROM public.platform_ledger
       WHERE bounty_id = '5e96aaed-93bd-4ade-ae39-93b073d9daff') x
    UNION ALL SELECT 'admin_action_log', to_jsonb(x) FROM (
      SELECT id, admin_user_id, action_type, amount, metadata->>'disposition' AS disposition, created_at
        FROM public.admin_action_log WHERE metadata->>'bounty_id' = '5e96aaed-93bd-4ade-ae39-93b073d9daff') x
  LOOP
    RAISE NOTICE '% %: %', p_label, r.what, r.row;
  END LOOP;
END;
$$;

SELECT pg_temp.show_5e96aaed('A BEFORE');

DO $$
DECLARE
  c_bounty  constant uuid := '5e96aaed-93bd-4ade-ae39-93b073d9daff';
  c_payment constant uuid := '7a665b48-5702-40a8-9184-fe7bf7a67daa';
  c_actor   constant uuid := 'f4bd948b-a0a6-4991-8e5d-d4a3978760e6';
  c_reason  constant text := 'ops 2026-11 (scripts/ops/settle-5e96aaed-2026-11.sql, option A): the founder did the job off-platform after the email accept could not be acted on; the captured $35 is kept as platform revenue';
  v_b  public.bounties%rowtype;
  v_p  public.bounty_payments%rowtype;
  v_disp jsonb;
BEGIN
  SELECT * INTO v_b FROM public.bounties WHERE id = c_bounty FOR UPDATE;
  SELECT * INTO v_p FROM public.bounty_payments WHERE id = c_payment FOR UPDATE;
  IF v_b.id IS NULL OR v_p.id IS NULL OR v_p.bounty_id <> c_bounty THEN
    RAISE EXCEPTION 'A: bounty or payment not found';
  END IF;
  IF v_b.status::text <> 'cancelled' THEN RAISE EXCEPTION 'A: bounty is %, expected cancelled', v_b.status; END IF;
  IF v_p.status <> 'captured' OR v_p.stripe_refund_id IS NOT NULL OR v_p.stripe_transfer_id IS NOT NULL
     OR v_p.metadata ? 'admin_disposition' THEN
    RAISE EXCEPTION 'A: payment is no longer an undecided capture (status %, refund %, transfer %, disposition %)',
      v_p.status, v_p.stripe_refund_id, v_p.stripe_transfer_id, v_p.metadata->'admin_disposition';
  END IF;
  IF v_p.amount <> 35 THEN RAISE EXCEPTION 'A: amount is %, expected 35', v_p.amount; END IF;
  IF EXISTS (SELECT 1 FROM public.platform_ledger WHERE bounty_id = c_bounty) THEN
    RAISE EXCEPTION 'A: platform_ledger already has a row for this bounty';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bounty_payments_status_check'
                  AND pg_get_constraintdef(oid) LIKE '%retained%') THEN
    RAISE EXCEPTION 'A: apply 20261110120000_cancelled_bounty_money_reconciliation.sql first';
  END IF;

  v_disp := jsonb_build_object('disposition', 'keep_as_platform_revenue', 'admin_id', c_actor,
    'reason', c_reason, 'at', now(), 'source', 'ops_script', 'bounty_status_from', 'cancelled', 'bounty_status_to', 'completed');

  INSERT INTO public.platform_ledger (bounty_id, amount, fee_type, description, metadata)
  VALUES (c_bounty, v_p.amount, 'retained_bounty_funds', 'Captured bounty funds kept by the platform (ops, option A)',
          jsonb_build_object('bounty_payment_id', c_payment, 'admin_id', c_actor, 'reason', c_reason,
                             'stripe_charge_id', v_p.stripe_charge_id, 'ops_script', 'settle-5e96aaed-2026-11'));

  UPDATE public.bounty_payments SET status = 'retained',
         metadata = metadata || jsonb_build_object('admin_disposition', v_disp)
   WHERE id = c_payment;

  UPDATE public.bounties SET status = 'completed', completed_at = now(), updated_at = now() WHERE id = c_bounty;

  INSERT INTO public.admin_action_log (admin_user_id, action_type, target_user_id, amount, reason, result, metadata)
  VALUES (c_actor, 'bounty_status_disposition', v_b.poster_id, v_p.amount, c_reason, 'success',
          jsonb_build_object('bounty_id', c_bounty, 'bounty_payment_id', c_payment, 'disposition', 'keep_as_platform_revenue',
                             'from', 'cancelled', 'to', 'completed', 'ops_script', 'settle-5e96aaed-2026-11', 'option', 'A'));

  PERFORM public.record_bounty_event('ops.settle_5e96aaed:A:' || to_char(now() AT TIME ZONE 'UTC', 'YYYYMMDD"T"HH24MISS.US'),
    'admin.status_changed', 'system', c_bounty, c_actor, now(), v_p.amount, NULL,
    jsonb_build_object('from', 'cancelled', 'to', 'completed', 'reason', c_reason,
                       'disposition', 'keep_as_platform_revenue', 'bounty_payment_id', c_payment));

  IF public.fn_bounty_unsettled_escrow_reason(c_bounty) IS NOT NULL THEN
    RAISE EXCEPTION 'A: still holding money afterwards: %', public.fn_bounty_unsettled_escrow_reason(c_bounty);
  END IF;
END $$;

SELECT pg_temp.show_5e96aaed('A AFTER');

ROLLBACK;  -- change to COMMIT to apply option A

-- ===========================================================================
-- OPTION B — release to the founder's hunter account
-- ===========================================================================
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.show_5e96aaed(p_label text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT 'bounty' AS what, to_jsonb(x) AS row FROM (
      SELECT id, status, accepted_by, completed_at, amount, updated_at FROM public.bounties
       WHERE id = '5e96aaed-93bd-4ade-ae39-93b073d9daff') x
    UNION ALL SELECT 'bounty_payment', to_jsonb(x) FROM (
      SELECT id, status, settlement_state, amount, hunter_id, stripe_refund_id, stripe_transfer_id,
             metadata->'admin_disposition' AS admin_disposition, updated_at
        FROM public.bounty_payments WHERE id = '7a665b48-5702-40a8-9184-fe7bf7a67daa') x
    UNION ALL SELECT 'hunter_payouts', to_jsonb(x) FROM (
      SELECT id, stripe_connect_account_id IS NOT NULL AS has_connect_account, stripe_connect_payouts_enabled
        FROM public.profiles WHERE id = 'f4bd948b-a0a6-4991-8e5d-d4a3978760e6') x
    UNION ALL SELECT 'admin_action_log', to_jsonb(x) FROM (
      SELECT id, admin_user_id, action_type, amount, metadata->>'disposition' AS disposition, created_at
        FROM public.admin_action_log WHERE metadata->>'bounty_id' = '5e96aaed-93bd-4ade-ae39-93b073d9daff') x
  LOOP
    RAISE NOTICE '% %: %', p_label, r.what, r.row;
  END LOOP;
END;
$$;

SELECT pg_temp.show_5e96aaed('B BEFORE');

DO $$
DECLARE
  c_bounty  constant uuid := '5e96aaed-93bd-4ade-ae39-93b073d9daff';
  c_payment constant uuid := '7a665b48-5702-40a8-9184-fe7bf7a67daa';
  c_hunter  constant uuid := 'f4bd948b-a0a6-4991-8e5d-d4a3978760e6';
  c_actor   constant uuid := 'f4bd948b-a0a6-4991-8e5d-d4a3978760e6';
  c_reason  constant text := 'ops 2026-11 (scripts/ops/settle-5e96aaed-2026-11.sql, option B): the founder applied on 2026-10-06 and did the job; pay the hunter share to his hunter account';
  v_b  public.bounties%rowtype;
  v_p  public.bounty_payments%rowtype;
  v_payouts boolean;
BEGIN
  SELECT * INTO v_b FROM public.bounties WHERE id = c_bounty FOR UPDATE;
  SELECT * INTO v_p FROM public.bounty_payments WHERE id = c_payment FOR UPDATE;
  IF v_b.id IS NULL OR v_p.id IS NULL OR v_p.bounty_id <> c_bounty THEN
    RAISE EXCEPTION 'B: bounty or payment not found';
  END IF;
  IF v_b.status::text <> 'cancelled' THEN RAISE EXCEPTION 'B: bounty is %, expected cancelled', v_b.status; END IF;
  IF v_p.status <> 'captured' OR v_p.stripe_refund_id IS NOT NULL OR v_p.stripe_transfer_id IS NOT NULL
     OR v_p.metadata ? 'admin_disposition' THEN
    RAISE EXCEPTION 'B: payment is no longer an undecided capture (status %, refund %, transfer %, disposition %)',
      v_p.status, v_p.stripe_refund_id, v_p.stripe_transfer_id, v_p.metadata->'admin_disposition';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.bounty_events WHERE bounty_id = c_bounty
                  AND event_type = 'application.submitted' AND actor_id = c_hunter) THEN
    RAISE EXCEPTION 'B: % never applied to this bounty', c_hunter;
  END IF;
  SELECT stripe_connect_payouts_enabled INTO v_payouts FROM public.profiles WHERE id = c_hunter;
  IF v_payouts IS NOT TRUE THEN
    -- /release (and so /admin-settle) refuses hunter_payouts_disabled; recording
    -- the decision now would only leave a disposition nothing can execute.
    RAISE EXCEPTION 'B: the founder''s Connect account has payouts_enabled = %; finish payout onboarding first', v_payouts;
  END IF;

  UPDATE public.bounty_payments
     SET hunter_id = c_hunter,
         metadata  = metadata || jsonb_build_object('admin_disposition', jsonb_build_object(
           'disposition', 'pay_out_to_hunter', 'hunter_id', c_hunter, 'admin_id', c_actor, 'reason', c_reason,
           'at', now(), 'source', 'ops_script', 'bounty_status_from', 'cancelled', 'bounty_status_to', 'cancelled'))
   WHERE id = c_payment;

  INSERT INTO public.admin_action_log (admin_user_id, action_type, target_user_id, amount, reason, result, metadata)
  VALUES (c_actor, 'bounty_status_disposition', v_b.poster_id, v_p.amount, c_reason, 'success',
          jsonb_build_object('bounty_id', c_bounty, 'bounty_payment_id', c_payment, 'disposition', 'pay_out_to_hunter',
                             'hunter_id', c_hunter, 'from', 'cancelled', 'to', 'cancelled',
                             'ops_script', 'settle-5e96aaed-2026-11', 'option', 'B'));

  PERFORM public.record_bounty_event('ops.settle_5e96aaed:B:' || to_char(now() AT TIME ZONE 'UTC', 'YYYYMMDD"T"HH24MISS.US'),
    'admin.status_changed', 'system', c_bounty, c_actor, now(), v_p.amount, NULL,
    jsonb_build_object('from', 'cancelled', 'to', 'cancelled', 'reason', c_reason,
                       'disposition', 'pay_out_to_hunter', 'hunter_id', c_hunter, 'bounty_payment_id', c_payment));

  RAISE NOTICE 'B: recorded. Next: POST bounty-payments/admin-settle {"bountyId":"%"} to run the transfer.', c_bounty;
END $$;

SELECT pg_temp.show_5e96aaed('B AFTER');

ROLLBACK;  -- change to COMMIT to apply option B (then run /admin-settle)

-- ===========================================================================
-- OPTION C — refund the poster
-- ===========================================================================
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.show_5e96aaed(p_label text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT 'bounty' AS what, to_jsonb(x) AS row FROM (
      SELECT id, status, accepted_by, amount, updated_at FROM public.bounties
       WHERE id = '5e96aaed-93bd-4ade-ae39-93b073d9daff') x
    UNION ALL SELECT 'bounty_payment', to_jsonb(x) FROM (
      SELECT id, status, settlement_state, amount, stripe_refund_id, stripe_transfer_id,
             metadata->'admin_disposition' AS admin_disposition, updated_at
        FROM public.bounty_payments WHERE id = '7a665b48-5702-40a8-9184-fe7bf7a67daa') x
    UNION ALL SELECT 'admin_action_log', to_jsonb(x) FROM (
      SELECT id, admin_user_id, action_type, amount, metadata->>'disposition' AS disposition, created_at
        FROM public.admin_action_log WHERE metadata->>'bounty_id' = '5e96aaed-93bd-4ade-ae39-93b073d9daff') x
  LOOP
    RAISE NOTICE '% %: %', p_label, r.what, r.row;
  END LOOP;
END;
$$;

SELECT pg_temp.show_5e96aaed('C BEFORE');

DO $$
DECLARE
  c_bounty  constant uuid := '5e96aaed-93bd-4ade-ae39-93b073d9daff';
  c_payment constant uuid := '7a665b48-5702-40a8-9184-fe7bf7a67daa';
  c_actor   constant uuid := 'f4bd948b-a0a6-4991-8e5d-d4a3978760e6';
  c_reason  constant text := 'ops 2026-11 (scripts/ops/settle-5e96aaed-2026-11.sql, option C): the bounty was cancelled by an admin and never done on-platform; refund the poster in full';
  v_b  public.bounties%rowtype;
  v_p  public.bounty_payments%rowtype;
BEGIN
  SELECT * INTO v_b FROM public.bounties WHERE id = c_bounty FOR UPDATE;
  SELECT * INTO v_p FROM public.bounty_payments WHERE id = c_payment FOR UPDATE;
  IF v_b.id IS NULL OR v_p.id IS NULL OR v_p.bounty_id <> c_bounty THEN
    RAISE EXCEPTION 'C: bounty or payment not found';
  END IF;
  IF v_b.status::text <> 'cancelled' THEN RAISE EXCEPTION 'C: bounty is %, expected cancelled', v_b.status; END IF;
  IF v_p.status <> 'captured' OR v_p.stripe_refund_id IS NOT NULL OR v_p.stripe_transfer_id IS NOT NULL
     OR v_p.metadata ? 'admin_disposition' THEN
    RAISE EXCEPTION 'C: payment is no longer an undecided capture (status %, refund %, transfer %, disposition %)',
      v_p.status, v_p.stripe_refund_id, v_p.stripe_transfer_id, v_p.metadata->'admin_disposition';
  END IF;
  IF v_p.stripe_payment_intent_id IS NULL THEN RAISE EXCEPTION 'C: no PaymentIntent to refund'; END IF;

  UPDATE public.bounty_payments
     SET status   = 'refund_pending',
         metadata = metadata || jsonb_build_object('admin_disposition', jsonb_build_object(
           'disposition', 'refund_poster', 'admin_id', c_actor, 'reason', c_reason, 'at', now(),
           'source', 'ops_script', 'bounty_status_from', 'cancelled', 'bounty_status_to', 'cancelled'))
   WHERE id = c_payment;

  INSERT INTO public.admin_action_log (admin_user_id, action_type, target_user_id, amount, reason, result, metadata)
  VALUES (c_actor, 'bounty_status_disposition', v_b.poster_id, v_p.amount, c_reason, 'success',
          jsonb_build_object('bounty_id', c_bounty, 'bounty_payment_id', c_payment, 'disposition', 'refund_poster',
                             'from', 'cancelled', 'to', 'cancelled', 'ops_script', 'settle-5e96aaed-2026-11', 'option', 'C'));

  PERFORM public.record_bounty_event('ops.settle_5e96aaed:C:' || to_char(now() AT TIME ZONE 'UTC', 'YYYYMMDD"T"HH24MISS.US'),
    'admin.status_changed', 'system', c_bounty, c_actor, now(), v_p.amount, NULL,
    jsonb_build_object('from', 'cancelled', 'to', 'cancelled', 'reason', c_reason,
                       'disposition', 'refund_poster', 'bounty_payment_id', c_payment));

  RAISE NOTICE 'C: recorded. Next: POST bounty-payments/admin-settle {"bountyId":"%"} to run the refund.', c_bounty;
END $$;

SELECT pg_temp.show_5e96aaed('C AFTER');

ROLLBACK;  -- change to COMMIT to apply option C (then run /admin-settle)
