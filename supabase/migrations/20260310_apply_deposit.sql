-- Atomic apply_deposit function
-- Purpose: Insert a wallet transaction for a Stripe PaymentIntent and
-- atomically update the user's balance if the transaction was inserted.
-- Ensures idempotency using stripe_payment_intent_id unique constraint.

CREATE OR REPLACE FUNCTION apply_deposit(
  p_user_id UUID,
  p_amount NUMERIC,
  p_payment_intent_id TEXT,
  p_metadata JSONB DEFAULT '{}'::jsonb
) RETURNS TABLE (applied boolean, tx_id UUID) AS $$
DECLARE
  v_tx_id UUID;
BEGIN
  -- Try to insert the wallet transaction. If a transaction with the same
  -- stripe_payment_intent_id already exists (unique constraint), do nothing.
  INSERT INTO wallet_transactions(
    user_id, type, amount, description, status, stripe_payment_intent_id, metadata, created_at, updated_at
  ) VALUES (
    p_user_id, 'deposit', p_amount, 'Wallet deposit via Stripe', 'completed', p_payment_intent_id, p_metadata, NOW(), NOW()
  ) ON CONFLICT (stripe_payment_intent_id) WHERE (stripe_payment_intent_id IS NOT NULL) DO NOTHING
  RETURNING id INTO v_tx_id;

  IF v_tx_id IS NOT NULL THEN
    -- A new transaction row was inserted; update the profile balance atomically
    UPDATE profiles
    SET balance = COALESCE(balance, 0) + p_amount,
        updated_at = NOW()
    WHERE id = p_user_id;

    RETURN QUERY SELECT true, v_tx_id;
  ELSE
    -- Transaction already existed; do not change balance
    RETURN QUERY SELECT false, NULL::UUID;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION apply_deposit(UUID, NUMERIC, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION apply_deposit(UUID, NUMERIC, TEXT, JSONB) TO service_role;

COMMENT ON FUNCTION apply_deposit(UUID, NUMERIC, TEXT, JSONB) IS 'Atomically insert deposit transaction and update profile balance; idempotent by payment intent id.';
