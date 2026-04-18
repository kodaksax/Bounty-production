-- Migration: Add atomic apply_release_tx RPC
-- Date: 2026-04-18
-- Purpose:
--   Fixes a non-idempotent recovery path in the /wallet/release Edge Function
--   where the balance credit and the transaction-status promotion were two
--   separate Postgres calls from Deno.  If the process crashed between those
--   two calls, the pending transaction would remain, and on the next retry the
--   recovery path would credit the hunter's balance a second time.
--
--   apply_release_tx wraps both mutations in a single database transaction:
--     1. UPDATE wallet_transactions SET status='completed' WHERE id=p_tx_id
--          AND status='pending'         <- conditional guard (idempotency)
--     2. IF the UPDATE affected a row (FOUND), credit the hunter's balance.
--
--   Because both steps live in one PG transaction they either both commit or
--   both roll back.  A pending transaction therefore reliably means "balance
--   not yet credited", eliminating the double-credit window.
--
--   Returns (applied BOOLEAN):
--     true  — status was promoted and balance was credited (first call)
--     false — transaction was already completed; no balance change (idempotent)
--
-- Used by:
--   - supabase/functions/wallet/index.ts  (normal release path + recovery path)

CREATE OR REPLACE FUNCTION public.apply_release_tx(
  p_tx_id     UUID,
  p_hunter_id UUID,
  p_amount    NUMERIC  -- positive: amount to credit to hunter
) RETURNS TABLE (applied BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Attempt to promote the transaction from 'pending' → 'completed'.
  -- The WHERE status = 'pending' clause is the idempotency guard: it ensures
  -- the UPDATE is a no-op on a second call when the row is already 'completed'.
  UPDATE public.wallet_transactions
  SET    status     = 'completed',
         updated_at = NOW()
  WHERE  id         = p_tx_id
    AND  user_id    = p_hunter_id   -- security: caller cannot target another user's tx
    AND  status     = 'pending';

  IF FOUND THEN
    -- Status was just promoted; credit the balance in the same transaction.
    UPDATE public.profiles
    SET    balance    = COALESCE(balance, 0) + p_amount,
           updated_at = NOW()
    WHERE  id = p_hunter_id;

    IF NOT FOUND THEN
      -- Hunter profile is missing.  Roll back the status promotion by raising
      -- an exception; the caller receives an error and can investigate.
      RAISE EXCEPTION 'Hunter profile not found for user %', p_hunter_id
        USING ERRCODE = 'P0002';
    END IF;

    RETURN QUERY SELECT TRUE;
  ELSE
    -- Transaction was already 'completed' (or belongs to a different user).
    -- Idempotent no-op — do not touch the balance.
    RETURN QUERY SELECT FALSE;
  END IF;
END;
$$;

-- Grant execute to the service role used by Edge Functions.
GRANT EXECUTE ON FUNCTION public.apply_release_tx(UUID, UUID, NUMERIC)
  TO service_role;
