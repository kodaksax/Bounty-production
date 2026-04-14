-- Migration: Add apply_refund atomic RPC
-- Date: 2026-04-18
-- Purpose:
--   Provides an atomic, idempotent function for processing Stripe charge
--   refunds. The function inserts the wallet_transactions row and updates
--   profiles.balance inside a single database transaction so that a partial
--   failure (insert succeeds but balance update fails) can never leave the
--   system in an inconsistent state.
--
--   On a Stripe webhook retry the INSERT hits the unique partial index on
--   stripe_refund_id and does nothing; the function returns applied=false,
--   skipping the balance update — preserving correctness without double-
--   decrementing the user's balance.
--
-- Depends on:
--   - wallet_transactions.stripe_refund_id column and
--     idx_wallet_tx_stripe_refund_id_unique partial index
--     (added in 20260417_add_idempotency_guards.sql)

CREATE OR REPLACE FUNCTION public.apply_refund(
  p_user_id         UUID,
  p_amount          NUMERIC,        -- negative value; e.g. -10.00 reverses a $10 deposit
  p_stripe_refund_id TEXT,
  p_stripe_charge_id TEXT,
  p_description     TEXT    DEFAULT 'Payment refunded',
  p_metadata        JSONB   DEFAULT '{}'::jsonb
) RETURNS TABLE (applied boolean, tx_id UUID) AS $$
DECLARE
  v_tx_id       UUID;
  v_new_balance NUMERIC;
BEGIN
  -- Attempt to insert the refund transaction.  If a row with the same
  -- stripe_refund_id already exists (partial unique index) the ON CONFLICT
  -- clause silently suppresses the insert and v_tx_id stays NULL.
  INSERT INTO public.wallet_transactions (
    user_id,
    type,
    amount,
    description,
    status,
    stripe_charge_id,
    stripe_refund_id,
    metadata,
    created_at,
    updated_at
  ) VALUES (
    p_user_id,
    'refund',
    p_amount,
    p_description,
    'completed',
    p_stripe_charge_id,
    p_stripe_refund_id,
    p_metadata,
    NOW(),
    NOW()
  )
  ON CONFLICT (stripe_refund_id) WHERE stripe_refund_id IS NOT NULL
  DO NOTHING
  RETURNING id INTO v_tx_id;

  IF v_tx_id IS NOT NULL THEN
    -- Row was freshly inserted; update the balance atomically in the same
    -- transaction so neither operation can be committed without the other.
    UPDATE public.profiles
    SET    balance    = COALESCE(balance, 0) + p_amount,
           updated_at = NOW()
    WHERE  id = p_user_id
    RETURNING balance INTO v_new_balance;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Profile not found for user %', p_user_id;
    END IF;

    -- Mirror the non-negative guard enforced by the update_balance RPC.
    IF v_new_balance < 0 THEN
      RAISE EXCEPTION 'Insufficient funds: new balance would be %', v_new_balance
        USING ERRCODE = '23514';
    END IF;

    RETURN QUERY SELECT true, v_tx_id;
  ELSE
    -- Duplicate refund ID detected; return applied=false so the caller can
    -- log the no-op without attempting a second balance update.
    RETURN QUERY SELECT false, NULL::UUID;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.apply_refund(UUID, NUMERIC, TEXT, TEXT, TEXT, JSONB)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_refund(UUID, NUMERIC, TEXT, TEXT, TEXT, JSONB)
  TO service_role;

COMMENT ON FUNCTION public.apply_refund(UUID, NUMERIC, TEXT, TEXT, TEXT, JSONB) IS
  'Atomically inserts a refund wallet_transaction and decrements profiles.balance; '
  'idempotent by stripe_refund_id. Returns (applied=true, tx_id) on first call, '
  '(applied=false, NULL) on duplicate Stripe webhook retries.';
