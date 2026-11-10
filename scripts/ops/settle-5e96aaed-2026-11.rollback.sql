-- Undo for scripts/ops/settle-5e96aaed-2026-11.sql. Same three sections.
--
-- Run only the section matching the option that was committed. Each one checks
-- that the rows are still exactly as that option left them and refuses
-- otherwise. In particular, B and C refuse once Stripe has moved money
-- (a stripe_transfer_id or stripe_refund_id is set): a transfer or refund
-- cannot be undone from SQL; that needs a Stripe reversal and its own review.
--
-- admin_action_log is append-only (trg_admin_action_log_append_only), so the
-- original audit row stays and a compensating row is added.
--
-- Every section ends in ROLLBACK. Change the one you need to COMMIT.

-- ===========================================================================
-- UNDO A — back to cancelled with the $35 captured and undecided
-- ===========================================================================
BEGIN;

DO $$
DECLARE
  c_bounty  constant uuid := '5e96aaed-93bd-4ade-ae39-93b073d9daff';
  c_payment constant uuid := '7a665b48-5702-40a8-9184-fe7bf7a67daa';
  c_actor   constant uuid := 'f4bd948b-a0a6-4991-8e5d-d4a3978760e6';
  v_b public.bounties%rowtype;
  v_p public.bounty_payments%rowtype;
  v_rows int;
BEGIN
  SELECT * INTO v_b FROM public.bounties WHERE id = c_bounty FOR UPDATE;
  SELECT * INTO v_p FROM public.bounty_payments WHERE id = c_payment FOR UPDATE;
  IF v_b.status::text <> 'completed' OR v_p.status <> 'retained'
     OR v_p.metadata->'admin_disposition'->>'source' IS DISTINCT FROM 'ops_script'
     OR v_p.metadata->'admin_disposition'->>'disposition' IS DISTINCT FROM 'keep_as_platform_revenue' THEN
    RAISE EXCEPTION 'undo A: state is not what option A wrote (bounty %, payment %, disposition %)',
      v_b.status, v_p.status, v_p.metadata->'admin_disposition';
  END IF;

  RAISE NOTICE 'undo A BEFORE bounty: %', to_jsonb(v_b);
  RAISE NOTICE 'undo A BEFORE payment: %', to_jsonb(v_p);

  DELETE FROM public.platform_ledger
   WHERE bounty_id = c_bounty AND fee_type = 'retained_bounty_funds'
     AND metadata->>'ops_script' = 'settle-5e96aaed-2026-11';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION 'undo A: expected 1 platform_ledger row, found %', v_rows; END IF;

  UPDATE public.bounty_payments
     SET status = 'captured',
         metadata = (metadata - 'admin_disposition')
                    || jsonb_build_object('admin_disposition_reverted', metadata->'admin_disposition')
   WHERE id = c_payment;
  UPDATE public.bounties SET status = 'cancelled', completed_at = NULL, updated_at = now() WHERE id = c_bounty;

  INSERT INTO public.admin_action_log (admin_user_id, action_type, target_user_id, amount, reason, result, metadata)
  VALUES (c_actor, 'bounty_status_disposition', v_b.poster_id, v_p.amount,
          'undo of ops option A (scripts/ops/settle-5e96aaed-2026-11.rollback.sql)', 'success',
          jsonb_build_object('bounty_id', c_bounty, 'bounty_payment_id', c_payment, 'disposition', 'reverted',
                             'reverted_disposition', 'keep_as_platform_revenue', 'from', 'completed', 'to', 'cancelled'));

  PERFORM public.record_bounty_event('ops.settle_5e96aaed:undoA:' || to_char(now() AT TIME ZONE 'UTC', 'YYYYMMDD"T"HH24MISS.US'),
    'admin.status_changed', 'system', c_bounty, c_actor, now(), v_p.amount, NULL,
    jsonb_build_object('from', 'completed', 'to', 'cancelled', 'reason', 'undo of ops option A'));

  SELECT * INTO v_b FROM public.bounties WHERE id = c_bounty;
  SELECT * INTO v_p FROM public.bounty_payments WHERE id = c_payment;
  RAISE NOTICE 'undo A AFTER bounty: %', to_jsonb(v_b);
  RAISE NOTICE 'undo A AFTER payment: %', to_jsonb(v_p);
END $$;

ROLLBACK;  -- change to COMMIT to undo option A

-- ===========================================================================
-- UNDO B — forget the hunter, before any transfer exists
-- ===========================================================================
BEGIN;

DO $$
DECLARE
  c_bounty  constant uuid := '5e96aaed-93bd-4ade-ae39-93b073d9daff';
  c_payment constant uuid := '7a665b48-5702-40a8-9184-fe7bf7a67daa';
  c_actor   constant uuid := 'f4bd948b-a0a6-4991-8e5d-d4a3978760e6';
  v_b public.bounties%rowtype;
  v_p public.bounty_payments%rowtype;
BEGIN
  SELECT * INTO v_b FROM public.bounties WHERE id = c_bounty FOR UPDATE;
  SELECT * INTO v_p FROM public.bounty_payments WHERE id = c_payment FOR UPDATE;
  IF v_p.stripe_transfer_id IS NOT NULL THEN
    RAISE EXCEPTION 'undo B: transfer % already exists; reverse it in Stripe first (admin-withdrawals reverse_transfer), not here', v_p.stripe_transfer_id;
  END IF;
  IF v_p.status <> 'captured'
     OR v_p.metadata->'admin_disposition'->>'source' IS DISTINCT FROM 'ops_script'
     OR v_p.metadata->'admin_disposition'->>'disposition' IS DISTINCT FROM 'pay_out_to_hunter' THEN
    RAISE EXCEPTION 'undo B: state is not what option B wrote (payment %, disposition %)',
      v_p.status, v_p.metadata->'admin_disposition';
  END IF;

  RAISE NOTICE 'undo B BEFORE payment: %', to_jsonb(v_p);

  UPDATE public.bounty_payments
     SET hunter_id = NULL,
         metadata = (metadata - 'admin_disposition')
                    || jsonb_build_object('admin_disposition_reverted', metadata->'admin_disposition')
   WHERE id = c_payment;

  INSERT INTO public.admin_action_log (admin_user_id, action_type, target_user_id, amount, reason, result, metadata)
  VALUES (c_actor, 'bounty_status_disposition', v_b.poster_id, v_p.amount,
          'undo of ops option B (scripts/ops/settle-5e96aaed-2026-11.rollback.sql)', 'success',
          jsonb_build_object('bounty_id', c_bounty, 'bounty_payment_id', c_payment, 'disposition', 'reverted',
                             'reverted_disposition', 'pay_out_to_hunter', 'from', 'cancelled', 'to', 'cancelled'));

  SELECT * INTO v_p FROM public.bounty_payments WHERE id = c_payment;
  RAISE NOTICE 'undo B AFTER payment: %', to_jsonb(v_p);
END $$;

ROLLBACK;  -- change to COMMIT to undo option B

-- ===========================================================================
-- UNDO C — back to captured, before any refund exists
-- ===========================================================================
BEGIN;

DO $$
DECLARE
  c_bounty  constant uuid := '5e96aaed-93bd-4ade-ae39-93b073d9daff';
  c_payment constant uuid := '7a665b48-5702-40a8-9184-fe7bf7a67daa';
  c_actor   constant uuid := 'f4bd948b-a0a6-4991-8e5d-d4a3978760e6';
  v_b public.bounties%rowtype;
  v_p public.bounty_payments%rowtype;
BEGIN
  SELECT * INTO v_b FROM public.bounties WHERE id = c_bounty FOR UPDATE;
  SELECT * INTO v_p FROM public.bounty_payments WHERE id = c_payment FOR UPDATE;
  IF v_p.stripe_refund_id IS NOT NULL OR v_p.status = 'refunded' THEN
    RAISE EXCEPTION 'undo C: Stripe refund % already exists; a refund cannot be undone', v_p.stripe_refund_id;
  END IF;
  IF v_p.status <> 'refund_pending'
     OR v_p.metadata->'admin_disposition'->>'source' IS DISTINCT FROM 'ops_script'
     OR v_p.metadata->'admin_disposition'->>'disposition' IS DISTINCT FROM 'refund_poster' THEN
    RAISE EXCEPTION 'undo C: state is not what option C wrote (payment %, disposition %)',
      v_p.status, v_p.metadata->'admin_disposition';
  END IF;

  RAISE NOTICE 'undo C BEFORE payment: %', to_jsonb(v_p);

  UPDATE public.bounty_payments
     SET status = 'captured',
         metadata = (metadata - 'admin_disposition')
                    || jsonb_build_object('admin_disposition_reverted', metadata->'admin_disposition')
   WHERE id = c_payment;

  INSERT INTO public.admin_action_log (admin_user_id, action_type, target_user_id, amount, reason, result, metadata)
  VALUES (c_actor, 'bounty_status_disposition', v_b.poster_id, v_p.amount,
          'undo of ops option C (scripts/ops/settle-5e96aaed-2026-11.rollback.sql)', 'success',
          jsonb_build_object('bounty_id', c_bounty, 'bounty_payment_id', c_payment, 'disposition', 'reverted',
                             'reverted_disposition', 'refund_poster', 'from', 'cancelled', 'to', 'cancelled'));

  SELECT * INTO v_p FROM public.bounty_payments WHERE id = c_payment;
  RAISE NOTICE 'undo C AFTER payment: %', to_jsonb(v_p);
END $$;

ROLLBACK;  -- change to COMMIT to undo option C
