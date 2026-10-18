-- Admin financial-action guards (admin panel audit, 2026-10-12)
--
-- Requires 20261012120000_admin_authorization_hardening.sql (is_admin(),
-- admin_action_log constraint).
--
-- 1. admin_set_bounty_status() could end a bounty that still held money.
--    It validated the lifecycle edge only, and fn_bounties_guard_lifecycle()
--    deliberately skips admins and SECURITY DEFINER callers, so nothing
--    checked escrow. "Mark completed" closed a job without paying the hunter;
--    "Cancel"/"Archive" left the poster's escrow stranded with no admin refund
--    path anywhere in the console. Confirmed live: bounty 5e96aaed was
--    cancelled by an admin on 2026-10-07 (reason NULL) while its $35 Stripe
--    payment stayed `captured`.
--    Ending or reopening a bounty now fails with SQLSTATE 55000 while escrow
--    is unsettled; the money has to go through the cancellation-approval
--    (refund) or dispute (release/refund) flows first. A reason is required.
--    Moderation takedowns (admin_moderation_transition) are NOT changed:
--    removing an abusive listing must stay possible regardless of money.
--
-- 2. Manual balance adjustments were neither atomic nor idempotent, and their
--    ledger row could never be written:
--      - admin-withdrawals called update_balance() and then inserted the
--        wallet_transactions row as two separate requests;
--      - that insert uses type 'admin_adjustment', which the enum allows but
--        wallet_transactions_type_check (prod) rejects, so every adjustment
--        would have changed a balance with no ledger row while the console
--        reported "Adjustment applied";
--      - a retried request (timeout, double tap) credited twice;
--      - nothing stopped an admin crediting their own balance.
--    admin_apply_balance_adjustment() does balance + ledger + audit in one
--    transaction, keyed by a caller-supplied idempotency key, and refuses
--    self-adjustment. service_role only.
--
-- Rollback: supabase/rollbacks/production/20261012120100_admin_financial_action_guards.down.sql

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Escrow-state guard for admin lifecycle overrides
-- ---------------------------------------------------------------------------
-- NULL = nothing held. Otherwise a short machine-readable reason.
CREATE OR REPLACE FUNCTION public.fn_bounty_unsettled_escrow_reason(p_bounty_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT CASE
    WHEN EXISTS (
           SELECT 1 FROM public.wallet_transactions w
            WHERE w.bounty_id = p_bounty_id
              AND w.type::text = 'escrow'
              AND w.status::text = 'completed')
     AND NOT EXISTS (
           SELECT 1 FROM public.wallet_transactions w
            WHERE w.bounty_id = p_bounty_id
              AND w.type::text IN ('release', 'refund')
              AND w.status::text = 'completed')
      THEN 'wallet_escrow_held'
    WHEN EXISTS (
           SELECT 1 FROM public.bounty_payments bp
            WHERE bp.bounty_id = p_bounty_id
              AND (
                bp.status IN ('pending_payment', 'authorized', 'captured', 'release_pending', 'refund_pending', 'disputed')
                OR (bp.status = 'failed' AND bp.stripe_charge_id IS NOT NULL)
              ))
      THEN 'stripe_payment_' || (
           SELECT bp.status FROM public.bounty_payments bp
            WHERE bp.bounty_id = p_bounty_id
              AND (
                bp.status IN ('pending_payment', 'authorized', 'captured', 'release_pending', 'refund_pending', 'disputed')
                OR (bp.status = 'failed' AND bp.stripe_charge_id IS NOT NULL)
              )
            ORDER BY bp.created_at DESC
            LIMIT 1)
    WHEN EXISTS (
           SELECT 1 FROM public.bounty_v3_funding f
            WHERE f.bounty_id = p_bounty_id
              AND (
                f.state IN ('authorizing', 'authorized', 'awaiting_hunter_onboarding', 'capturing')
                OR (
                  f.state = 'capture_failed'
                  AND (
                    f.last_error_code IS DISTINCT FROM 'capture_failed_expired'
                    OR f.captured_at IS NOT NULL
                    OR f.stripe_charge_id IS NOT NULL
                  )
                )
              ))
      THEN 'v3_funding_held'
    ELSE NULL
  END;
$$;

REVOKE ALL ON FUNCTION public.fn_bounty_unsettled_escrow_reason(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_bounty_unsettled_escrow_reason(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_bounty_unsettled_escrow_reason(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_set_bounty_status(
  p_bounty_id uuid,
  p_status    text,
  p_reason    text DEFAULT NULL::text
)
RETURNS bounties
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_row  public.bounties%rowtype;
  v_from text;
  v_held text;
BEGIN
  PERFORM public.admin_assert_role();

  IF p_status NOT IN ('open','in_progress','completed','archived','cancelled','cancellation_requested','deleted') THEN
    RAISE EXCEPTION 'invalid bounty status: %', p_status USING ERRCODE = '22023';
  END IF;

  -- Lock the row so the escrow check and the update see the same state.
  SELECT * INTO v_row FROM public.bounties WHERE id = p_bounty_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bounty % not found', p_bounty_id USING ERRCODE = 'P0002';
  END IF;

  v_from := v_row.status::text;

  -- Idempotent no-op: already in the requested status (double submission,
  -- stale admin list, or a race with another admin session).
  IF v_from = p_status THEN
    RETURN v_row;
  END IF;

  IF NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'a reason is required for an admin status change' USING ERRCODE = '22023';
  END IF;

  IF NOT public.admin_bounty_status_transition_allowed(v_from, p_status) THEN
    RAISE EXCEPTION 'illegal bounty status transition: % -> %', v_from, p_status USING ERRCODE = '22023';
  END IF;

  -- Anything that ends the engagement, or puts it back on the market, must
  -- not leave money behind. Resuming (cancellation_requested -> in_progress)
  -- and starting work (open -> in_progress) keep the escrow where it is.
  IF p_status IN ('completed', 'cancelled', 'archived', 'deleted', 'open') THEN
    v_held := public.fn_bounty_unsettled_escrow_reason(p_bounty_id);
    IF v_held IS NOT NULL THEN
      RAISE EXCEPTION 'escrow_unsettled:%', v_held
        USING ERRCODE = '55000',
              HINT = 'Settle the money first: approve the cancellation (refunds the poster) or resolve the dispute (release or refund).';
    END IF;
  END IF;

  EXECUTE format('UPDATE public.bounties SET status = %L, updated_at = now() WHERE id = $1', p_status)
    USING p_bounty_id;

  IF to_regprocedure(
       'public.record_bounty_event(text,text,text,uuid,uuid,timestamptz,numeric,text,jsonb)'
     ) IS NOT NULL THEN
    PERFORM public.record_bounty_event(
      'admin.status_changed:' || p_bounty_id::text || ':'
        || to_char(now() AT TIME ZONE 'UTC', 'YYYYMMDD"T"HH24MISS.US'),
      'admin.status_changed', 'system', p_bounty_id, auth.uid(), now(), NULL, NULL,
      jsonb_build_object('from', v_from, 'to', p_status, 'reason', btrim(p_reason)));
  END IF;

  SELECT * INTO v_row FROM public.bounties WHERE id = p_bounty_id;
  RETURN v_row;
END;
$$;

-- Same grants as before: callable by signed-in users, gated by admin_assert_role().
REVOKE ALL ON FUNCTION public.admin_set_bounty_status(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_set_bounty_status(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_set_bounty_status(uuid, text, text) TO authenticated, service_role;

-- Pin the search_path the advisor flagged on the transition table.
ALTER FUNCTION public.admin_bounty_status_transition_allowed(text, text) SET search_path TO 'public', 'pg_temp';

-- ---------------------------------------------------------------------------
-- 2. Atomic, idempotent manual balance adjustment
-- ---------------------------------------------------------------------------
-- wallet_transactions.type is wallet_tx_type_enum, which already constrains
-- the column. The extra CHECK on prod predates the enum's admin_adjustment
-- label (20260720) and silently rejected it; it duplicates the enum and has
-- already drifted from it once, so it is dropped rather than re-listed.
-- (Staging has no such CHECK, and its enum differs: posting_fee, no
-- admin_adjustment / dispute_loss.)
ALTER TABLE public.wallet_transactions DROP CONSTRAINT IF EXISTS wallet_transactions_type_check;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = 'wallet_tx_type_enum' AND e.enumlabel = 'admin_adjustment'
  ) THEN
    EXECUTE $idx$
      CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_tx_admin_adjustment_idempotency
        ON public.wallet_transactions (user_id, idempotency_key)
        WHERE idempotency_key IS NOT NULL AND type = 'admin_adjustment'::public.wallet_tx_type_enum
    $idx$;
  ELSE
    RAISE NOTICE 'wallet_tx_type_enum has no admin_adjustment label here; manual adjustments stay unavailable until it is added';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_apply_balance_adjustment(
  p_admin_id               uuid,
  p_user_id                uuid,
  p_amount                 numeric,
  p_reason                 text,
  p_idempotency_key        text,
  p_related_transaction_id uuid DEFAULT NULL
)
RETURNS TABLE (transaction_id uuid, new_balance numeric, replayed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_reason   text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_key      text := NULLIF(btrim(COALESCE(p_idempotency_key, '')), '');
  v_existing public.wallet_transactions%rowtype;
  v_tx_id    uuid;
  v_balance  numeric;
BEGIN
  IF p_admin_id IS NULL OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'admin and target user are required' USING ERRCODE = '22023';
  END IF;
  IF p_admin_id = p_user_id THEN
    RAISE EXCEPTION 'admins cannot adjust their own balance' USING ERRCODE = '42501';
  END IF;
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'reason is required' USING ERRCODE = '22023';
  END IF;
  IF v_key IS NULL OR length(v_key) < 8 OR length(v_key) > 200 THEN
    RAISE EXCEPTION 'idempotency key must be 8-200 characters' USING ERRCODE = '22023';
  END IF;
  IF p_amount IS NULL OR p_amount = 0 OR abs(p_amount) > 10000 OR p_amount <> round(p_amount, 2) THEN
    RAISE EXCEPTION 'amount must be non-zero, whole cents, and at most $10,000' USING ERRCODE = '22023';
  END IF;

  -- Serialise concurrent submissions of the same key.
  PERFORM pg_advisory_xact_lock(hashtextextended('admin_adjustment:' || p_user_id::text || ':' || v_key, 0));

  SELECT * INTO v_existing
    FROM public.wallet_transactions w
   WHERE w.user_id = p_user_id
     AND w.idempotency_key = v_key
     AND w.type = 'admin_adjustment'::public.wallet_tx_type_enum;

  IF FOUND THEN
    IF v_existing.amount <> p_amount THEN
      RAISE EXCEPTION 'idempotency key already used for a different amount' USING ERRCODE = '23505';
    END IF;
    SELECT p.balance INTO v_balance FROM public.profiles p WHERE p.id = p_user_id;
    RETURN QUERY SELECT v_existing.id, v_balance, true;
    RETURN;
  END IF;

  -- update_balance() raises (and rolls everything back) for an unknown user
  -- or a balance that would go negative.
  v_balance := public.update_balance(p_user_id, p_amount);

  INSERT INTO public.wallet_transactions
    (user_id, type, amount, status, description, idempotency_key, metadata)
  VALUES (
    p_user_id,
    'admin_adjustment',
    p_amount,
    'completed',
    'Manual admin adjustment: ' || left(v_reason, 200),
    v_key,
    jsonb_build_object(
      'admin_user_id',          p_admin_id,
      'reason',                 v_reason,
      'related_transaction_id', p_related_transaction_id
    )
  )
  RETURNING id INTO v_tx_id;

  INSERT INTO public.admin_action_log
    (admin_user_id, action_type, target_user_id, target_transaction_id, amount, reason, result, metadata)
  VALUES (
    p_admin_id, 'manual_balance_adjustment', p_user_id, p_related_transaction_id, p_amount, v_reason, 'success',
    jsonb_build_object('ledger_transaction_id', v_tx_id, 'new_balance', v_balance, 'idempotency_key', v_key)
  );

  RETURN QUERY SELECT v_tx_id, v_balance, false;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_apply_balance_adjustment(uuid, uuid, numeric, text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_apply_balance_adjustment(uuid, uuid, numeric, text, text, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_apply_balance_adjustment(uuid, uuid, numeric, text, text, uuid) TO service_role;

COMMIT;
