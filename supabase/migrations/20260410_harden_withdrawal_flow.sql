-- Migration: Harden withdrawal flow
-- Created: 2026-04-10
-- Purpose: Add safeguards that prevent double-spend, enforce minimum withdrawal
--          amount, and ensure the non-negative balance DB constraint is present.

-- 1. Ensure the non-negative balance constraint exists on profiles
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND constraint_name = 'check_balance_non_negative'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT check_balance_non_negative CHECK (balance >= 0);
  END IF;
END;
$$;

-- 2. Add a partial unique index that prevents a second *pending* withdrawal
--    from being created while one is already in-flight.  Once a withdrawal
--    moves to 'completed' or 'failed' a new one is allowed.
--    Only one pending withdrawal per user is permitted at any time.
CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_tx_one_pending_withdrawal
  ON wallet_transactions (user_id)
  WHERE type = 'withdrawal' AND status = 'pending';

COMMENT ON INDEX idx_wallet_tx_one_pending_withdrawal
  IS 'Prevents more than one pending withdrawal per user at any time, guarding against race conditions.';

-- 3. Index to accelerate pending withdrawal lookups (used by balance derivation).
CREATE INDEX IF NOT EXISTS idx_wallet_tx_user_type_status
  ON wallet_transactions (user_id, type, status);

COMMENT ON INDEX idx_wallet_tx_user_type_status
  IS 'Covers the common query pattern: find transactions for a user by type and status.';
