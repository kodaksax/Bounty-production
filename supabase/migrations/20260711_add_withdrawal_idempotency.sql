-- Migration: Add withdrawal idempotency guard to wallet_transactions
-- Created: 2026-07-11
-- Purpose:
--   Prevent duplicate Stripe Connect payouts when the client retries a
--   withdrawal request (double-tap, network timeout retry, etc).
--
--   The mobile app sends a stable `idempotencyKey` with each withdrawal
--   attempt.  The /connect/transfer edge function now:
--     1. Replays the previously recorded withdrawal when a transaction with
--        the same (user_id, idempotency_key) already exists.
--     2. Persists the key on the withdrawal wallet_transactions row so the
--        unique partial index below rejects concurrent duplicates.

ALTER TABLE public.wallet_transactions
  ADD COLUMN IF NOT EXISTS idempotency_key text;

COMMENT ON COLUMN public.wallet_transactions.idempotency_key
  IS 'Client-supplied idempotency key used to deduplicate withdrawal requests';

-- Unique partial index: one withdrawal per (user, idempotency key).
-- Scoped to type = 'withdrawal' so other transaction flows (which manage
-- idempotency through their RPCs) are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_tx_withdrawal_idempotency
  ON public.wallet_transactions(user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL AND type = 'withdrawal';

COMMENT ON INDEX idx_wallet_tx_withdrawal_idempotency
  IS 'Prevents duplicate withdrawal transactions for the same client idempotency key';
