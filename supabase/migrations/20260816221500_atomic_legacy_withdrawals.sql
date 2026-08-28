-- Atomically reserve legacy withdrawals before any Stripe money movement.
--
-- The legacy /connect/transfer and /connect/instant-payout routes debit
-- profiles.balance and then talk to Stripe. The pending withdrawal row is the
-- serialization guard that prevents a second concurrent debit/payout. Reserve
-- that row inside the same database transaction as the balance debit so a
-- unique-index race can never occur after money has already moved.

CREATE OR REPLACE FUNCTION public.begin_legacy_withdrawal(
  p_user_id UUID,
  p_amount NUMERIC,
  p_description TEXT,
  p_payout_method TEXT,
  p_idempotency_key TEXT DEFAULT NULL,
  p_stripe_connect_account_id TEXT DEFAULT NULL,
  p_instant_fee_amount NUMERIC DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS TABLE(tx_id UUID, new_balance NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tx_id UUID;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Withdrawal amount must be positive, got %', p_amount
      USING ERRCODE = 'P0001';
  END IF;

  IF p_payout_method NOT IN ('standard', 'instant') THEN
    RAISE EXCEPTION 'Unsupported payout method: %', p_payout_method
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.wallet_transactions (
    user_id,
    type,
    amount,
    description,
    status,
    payout_method,
    stripe_connect_account_id,
    idempotency_key,
    instant_fee_amount,
    metadata
  )
  VALUES (
    p_user_id,
    'withdrawal',
    -p_amount,
    p_description,
    'pending',
    p_payout_method,
    p_stripe_connect_account_id,
    p_idempotency_key,
    p_instant_fee_amount,
    COALESCE(p_metadata, '{}'::jsonb)
  )
  RETURNING id INTO v_tx_id;

  new_balance := public.withdraw_balance(p_user_id, p_amount);
  tx_id := v_tx_id;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.begin_legacy_withdrawal(UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT, NUMERIC, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.begin_legacy_withdrawal(UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT, NUMERIC, JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.begin_legacy_withdrawal(UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT, NUMERIC, JSONB) TO service_role;

COMMENT ON FUNCTION public.begin_legacy_withdrawal(UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT, NUMERIC, JSONB) IS
  'Atomically inserts a pending legacy withdrawal row and debits profiles.balance. Used before any Stripe transfer/payout call so unique-index conflicts happen before money moves.';

CREATE OR REPLACE FUNCTION public.retry_failed_withdrawal(
  p_transaction_id UUID,
  p_user_id UUID,
  p_amount NUMERIC
)
RETURNS TABLE(tx_id UUID, new_balance NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Withdrawal amount must be positive, got %', p_amount
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.wallet_transactions
     SET status = 'pending',
         stripe_transfer_id = NULL,
         stripe_payout_id = NULL,
         updated_at = NOW(),
         metadata = (
           COALESCE(metadata, '{}'::jsonb)
           - 'payout_status'
           - 'payout_failure_code'
           - 'payout_failure_message'
           - 'payout_id'
           - 'payout_creation_failed'
           || jsonb_build_object('retry_reserved_at', NOW())
         )
   WHERE id = p_transaction_id
     AND user_id = p_user_id
     AND type = 'withdrawal'
     AND status = 'failed';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Failed withdrawal % not found for user %', p_transaction_id, p_user_id
      USING ERRCODE = 'P0002';
  END IF;

  new_balance := public.withdraw_balance(p_user_id, p_amount);
  tx_id := p_transaction_id;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.retry_failed_withdrawal(UUID, UUID, NUMERIC) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.retry_failed_withdrawal(UUID, UUID, NUMERIC) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.retry_failed_withdrawal(UUID, UUID, NUMERIC) TO service_role;

COMMENT ON FUNCTION public.retry_failed_withdrawal(UUID, UUID, NUMERIC) IS
  'Atomically re-reserves a failed legacy withdrawal for retry by moving it back to pending, clearing stale Stripe ids, and debiting profiles.balance before any new Stripe call.';

CREATE OR REPLACE FUNCTION public.fail_legacy_withdrawal(
  p_transaction_id UUID,
  p_user_id UUID,
  p_stripe_transfer_id TEXT DEFAULT NULL,
  p_stripe_payout_id TEXT DEFAULT NULL,
  p_metadata_patch JSONB DEFAULT '{}'::jsonb
)
RETURNS TABLE(refunded BOOLEAN, refund_amount NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_amount NUMERIC;
  v_metadata JSONB;
BEGIN
  SELECT amount, metadata
    INTO v_amount, v_metadata
    FROM public.wallet_transactions
   WHERE id = p_transaction_id
     AND user_id = p_user_id
     AND type = 'withdrawal'
     AND status = 'pending'
   FOR UPDATE;

  IF NOT FOUND THEN
    refunded := FALSE;
    refund_amount := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  refund_amount := ABS(v_amount);
  PERFORM public.update_balance(p_user_id, refund_amount);

  UPDATE public.wallet_transactions
     SET status = 'failed',
         stripe_transfer_id = COALESCE(p_stripe_transfer_id, stripe_transfer_id),
         stripe_payout_id = COALESCE(p_stripe_payout_id, stripe_payout_id),
         updated_at = NOW(),
         metadata = COALESCE(v_metadata, '{}'::jsonb) || COALESCE(p_metadata_patch, '{}'::jsonb)
   WHERE id = p_transaction_id;

  refunded := TRUE;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.fail_legacy_withdrawal(UUID, UUID, TEXT, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fail_legacy_withdrawal(UUID, UUID, TEXT, TEXT, JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fail_legacy_withdrawal(UUID, UUID, TEXT, TEXT, JSONB) TO service_role;

COMMENT ON FUNCTION public.fail_legacy_withdrawal(UUID, UUID, TEXT, TEXT, JSONB) IS
  'Atomically credits profiles.balance and marks a pending legacy withdrawal failed. Used for payout.failed/canceled handling so retries can reapply the whole effect if needed.';
