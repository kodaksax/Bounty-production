-- Migration: Add atomic RPC to apply dispute_loss transactions
-- Created: 2026-04-15
-- Purpose: Atomically deduct a dispute loss from a user's balance and
-- insert the corresponding wallet_transactions row in a single DB
-- transaction. Also add a uniqueness index to prevent duplicate dispute
-- transaction inserts for the same Stripe dispute ID.

-- 1. Unique index to make dispute handling idempotent at the DB level
CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_tx_stripe_dispute_id_dispute_loss
  ON public.wallet_transactions ((metadata->>'stripe_dispute_id'))
  WHERE (metadata->>'stripe_dispute_id') IS NOT NULL AND type = 'dispute_loss';

-- 2. RPC: apply_dispute_loss_transaction
--    Performs an atomic update: calls existing update_balance RPC (which
--    enforces non-negative balances) and inserts a completed wallet
--    transaction. If a completed dispute_loss for the same Stripe dispute
--    already exists, the function returns that row (idempotent).
CREATE OR REPLACE FUNCTION public.apply_dispute_loss_transaction(
  p_user_id uuid,
  p_amount numeric,
  p_description text,
  p_stripe_dispute_id text,
  p_stripe_payment_intent_id text
) RETURNS TABLE (
  id uuid,
  user_id uuid,
  type text,
  amount numeric,
  description text,
  status text,
  metadata jsonb
) LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_existing_id uuid;
  v_inserted_id uuid;
BEGIN
  IF p_stripe_dispute_id IS NOT NULL THEN
    SELECT id INTO v_existing_id
    FROM public.wallet_transactions
    WHERE type = 'dispute_loss'
      AND (metadata->>'stripe_dispute_id') = p_stripe_dispute_id
      AND status = 'completed'
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
      RETURN QUERY
      SELECT id, user_id, type::text, amount, description, status::text, metadata
      FROM public.wallet_transactions
      WHERE id = v_existing_id;
      RETURN;
    END IF;
  END IF;

  -- Update balance (will raise on insufficient funds or other errors).
  PERFORM update_balance(p_user_id, p_amount);

  -- Insert the completed wallet transaction.
  INSERT INTO public.wallet_transactions (user_id, type, amount, description, status, metadata)
  VALUES (
    p_user_id,
    'dispute_loss',
    p_amount,
    p_description,
    'completed',
    jsonb_build_object('stripe_dispute_id', p_stripe_dispute_id, 'stripe_payment_intent_id', p_stripe_payment_intent_id)
  ) RETURNING id INTO v_inserted_id;

  RETURN QUERY
  SELECT id, user_id, type::text, amount, description, status::text, metadata
  FROM public.wallet_transactions
  WHERE id = v_inserted_id;
END;
$$;

-- Grant execute to service and authenticated roles
GRANT EXECUTE ON FUNCTION public.apply_dispute_loss_transaction(uuid, numeric, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_dispute_loss_transaction(uuid, numeric, text, text, text) TO authenticated;

COMMENT ON FUNCTION public.apply_dispute_loss_transaction IS 'Atomically applies a dispute_loss: updates balance and inserts wallet_transactions in one transaction. Returns existing completed dispute_loss row if present (idempotent).';
