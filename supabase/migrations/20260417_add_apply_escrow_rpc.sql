-- Migration: Add atomic apply_escrow RPC
-- Created: 2026-04-17
-- Purpose: Replace the four non-atomic operations in the /wallet/escrow Edge
-- Function (existence check → balance read → insert tx → update balance) with
-- a single SECURITY DEFINER RPC that executes entirely within one Postgres
-- transaction.  This eliminates the TOCTOU race condition where two concurrent
-- requests for the same bounty both pass the application-level existence check
-- before either commits, resulting in duplicate escrow rows and an incorrect
-- final balance.

-- 1. Partial unique index — DB-level guard against duplicate completed escrows
--    for the same bounty.  ON CONFLICT is used in the RPC below; the index also
--    serves as a hard backstop if the RPC is ever bypassed.
CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_tx_one_escrow_per_bounty
  ON public.wallet_transactions (bounty_id)
  WHERE type = 'escrow' AND status = 'completed';

-- 2. RPC: apply_escrow
--    Atomically:
--      a. Returns the existing completed escrow row if one exists (idempotent).
--      b. Inserts the escrow transaction (ON CONFLICT DO NOTHING for the
--         unique index, as a secondary idempotency guard).  Returns
--         applied=false immediately if a conflict is detected — no balance
--         change has occurred at that point.
--      c. Deducts the balance via update_balance() only after the INSERT
--         succeeds.  If update_balance raises SQLSTATE 23514 (insufficient
--         funds) the whole transaction rolls back, including the INSERT.
--      d. Returns the new transaction row.
--
--    Callers receive a single row.  If `applied` is false the escrow already
--    existed (caller should return 409 Conflict).
CREATE OR REPLACE FUNCTION public.apply_escrow(
  p_user_id    uuid,
  p_bounty_id  uuid,
  p_amount     numeric,
  p_description text,
  p_metadata   jsonb DEFAULT '{}'::jsonb
) RETURNS TABLE (
  applied        boolean,
  transaction_id uuid,
  new_balance    numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_id uuid;
  v_tx_id       uuid;
  v_new_balance numeric;
BEGIN
  -- Check for an already-committed escrow for this bounty (idempotency).
  SELECT id INTO v_existing_id
  FROM public.wallet_transactions
  WHERE bounty_id = p_bounty_id
    AND type      = 'escrow'
    AND status    = 'completed'
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    RETURN QUERY SELECT false, v_existing_id, NULL::numeric;
    RETURN;
  END IF;

  -- Insert the escrow transaction first.  The ON CONFLICT clause protects
  -- against any concurrent race that passes the idempotency check above
  -- simultaneously.  We insert BEFORE touching the balance so that if a
  -- conflict occurs we return early without any balance change — avoiding the
  -- bug where update_balance() deducts funds and then the INSERT silently
  -- no-ops, committing a balance reduction with no corresponding escrow row.
  INSERT INTO public.wallet_transactions (
    user_id, bounty_id, type, amount, description, status, metadata
  ) VALUES (
    p_user_id, p_bounty_id, 'escrow', -p_amount, p_description, 'completed', p_metadata
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_tx_id;

  IF v_tx_id IS NULL THEN
    -- Another concurrent call won the insert race; treat as duplicate.
    -- No balance change has occurred yet, so no rollback is needed.
    SELECT id INTO v_tx_id
    FROM public.wallet_transactions
    WHERE bounty_id = p_bounty_id
      AND type      = 'escrow'
      AND status    = 'completed'
    LIMIT 1;
    RETURN QUERY SELECT false, v_tx_id, NULL::numeric;
    RETURN;
  END IF;

  -- Deduct the balance only after the INSERT has succeeded.
  -- update_balance raises SQLSTATE 23514 ('insufficient_funds') if the
  -- result would be negative, which aborts the whole transaction and
  -- rolls back the INSERT above — no orphaned escrow row is left behind.
  v_new_balance := update_balance(p_user_id, -p_amount);

  RETURN QUERY SELECT true, v_tx_id, v_new_balance;
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_escrow(uuid, uuid, numeric, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_escrow(uuid, uuid, numeric, text, jsonb) TO service_role;

COMMENT ON FUNCTION public.apply_escrow IS
  'Atomically checks balance, inserts an escrow wallet_transactions row, and '
  'deducts from profiles.balance in one database transaction.  Idempotent: '
  'returns applied=false if a completed escrow for the bounty already exists.';
