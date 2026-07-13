-- Migration: Add atomic apply_refund_tx RPC
-- Date: 2026-07-12
-- Purpose:
--   Fixes a non-atomic balance credit in the POST /wallet/refund Edge Function
--   handler (bounty-cancellation refunds back to the poster). The handler
--   inserted a 'pending' wallet_transactions row, then performed a separate
--   read-balance -> write-balance round trip, then a separate UPDATE to
--   promote the row to 'completed'. That has two problems:
--
--   1. Lost-update race: two concurrent balance-affecting requests for the
--      same user (e.g. two refunds, or a refund racing a deposit) can both
--      read the same starting balance and each write back
--      `currentBalance + refundAmount`, silently dropping one of the
--      credits. Every other balance mutation in this codebase (deposits,
--      escrow, release, withdrawals) goes through an atomic RPC for exactly
--      this reason — refund was the one path that hadn't been migrated.
--
--   2. No crash recovery: if the process crashed after inserting the
--      'pending' row but before crediting the balance, the existing-
--      settlement check in the handler treats ANY 'pending' refund row as a
--      terminal 409 "already pending" — there was no path to ever finish
--      crediting the user, permanently stranding their escrowed funds. This
--      mirrors the exact bug already fixed for the release path via
--      apply_release_tx (see 20260418_add_apply_release_rpc.sql); refund
--      never received the equivalent fix.
--
--   apply_refund_tx wraps both mutations in a single database transaction,
--   matching apply_release_tx's shape:
--     1. UPDATE wallet_transactions SET status='completed' WHERE id=p_tx_id
--          AND user_id=p_user_id AND status='pending'  <- idempotency guard
--     2. IF the UPDATE affected a row (FOUND), credit the user's balance.
--
--   Returns (applied BOOLEAN):
--     true  — status was promoted and balance was credited (first call)
--     false — transaction was already completed; no balance change (idempotent)
--
-- Used by:
--   - supabase/functions/wallet/index.ts (POST /wallet/refund, normal + recovery path)

CREATE OR REPLACE FUNCTION public.apply_refund_tx(
  p_tx_id   UUID,
  p_user_id UUID,
  p_amount  NUMERIC  -- positive: amount to credit back to the poster
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
    AND  user_id    = p_user_id  -- security: caller cannot target another user's tx
    AND  status     = 'pending';

  IF FOUND THEN
    -- Status was just promoted; credit the balance in the same transaction.
    UPDATE public.profiles
    SET    balance    = COALESCE(balance, 0) + p_amount,
           updated_at = NOW()
    WHERE  id = p_user_id;

    IF NOT FOUND THEN
      -- Profile is missing. Roll back the status promotion by raising an
      -- exception; the caller receives an error and can investigate.
      RAISE EXCEPTION 'Profile not found for user %', p_user_id
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
GRANT EXECUTE ON FUNCTION public.apply_refund_tx(UUID, UUID, NUMERIC)
  TO service_role;

COMMENT ON FUNCTION public.apply_refund_tx(UUID, UUID, NUMERIC) IS
'Atomically promotes a pending refund wallet_transaction to completed and credits profiles.balance in one transaction; idempotent on (id, user_id, status=pending). Mirrors apply_release_tx for the refund side of bounty settlement.';
