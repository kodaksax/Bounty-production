-- Create unique index for stripe_payment_intent_id to support ON CONFLICT
-- Created: 2026-03-11
-- Purpose: Ensure `apply_deposit` RPC can use `ON CONFLICT (stripe_payment_intent_id)`

-- Drop the previous non-unique index if it exists
DROP INDEX IF EXISTS idx_wallet_tx_stripe_payment_intent;

-- Create a unique partial index so that `ON CONFLICT (stripe_payment_intent_id)`
-- has a matching unique constraint/index. The partial index ignores NULLs.
CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_tx_stripe_payment_intent_unique
ON wallet_transactions(stripe_payment_intent_id)
WHERE stripe_payment_intent_id IS NOT NULL;

COMMENT ON INDEX idx_wallet_tx_stripe_payment_intent_unique IS 'Unique index on stripe_payment_intent_id to enforce one wallet transaction per Stripe PaymentIntent';
