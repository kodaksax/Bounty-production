-- Migration: Fix fn_refund_wallet_escrow_for_dispute parameter type UUID → INTEGER
-- Created: 2026-05-20
--
-- Problem:
--   fn_refund_wallet_escrow_for_dispute was created with p_dispute_id UUID, but
--   bounty_disputes.id is an INTEGER column (matching fn_close_dispute_hold which was
--   already corrected to INTEGER in 20260418_fix_dispute_hold_permissions.sql).
--   Calling the RPC with a numeric dispute id (e.g. 16) caused:
--     "invalid input syntax for type uuid: \"16\""
--   because PostgreSQL tried to coerce the integer to UUID.
--
-- Fix:
--   Drop the UUID overload and recreate the function with p_dispute_id INTEGER,
--   matching the actual bounty_disputes.id column type and the pattern established
--   by fn_close_dispute_hold(INTEGER, TEXT).

-- Drop the incorrectly typed UUID overload first.
DROP FUNCTION IF EXISTS public.fn_refund_wallet_escrow_for_dispute(UUID);

CREATE OR REPLACE FUNCTION public.fn_refund_wallet_escrow_for_dispute(
  p_dispute_id INTEGER
) RETURNS TABLE (
  applied        BOOLEAN,
  transaction_id UUID,
  refund_amount  NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bounty_id          UUID;
  v_dispute_status     TEXT;
  v_dispute_winner     TEXT;
  v_poster_id          UUID;
  v_bounty_amount      NUMERIC;
  v_is_for_honor       BOOLEAN;
  v_escrow_tx_id       UUID;
  v_escrow_tx_amount   NUMERIC;
  v_refund_amount      NUMERIC;
  v_existing_settlement UUID;
  v_refund_tx_id       UUID;
BEGIN
  -- ── Authorization guard ────────────────────────────────────────────────
  -- Allow service_role (no JWT) or authenticated admins only.
  IF auth.role() = 'authenticated' THEN
    IF COALESCE((auth.jwt() -> 'app_metadata' ->> 'role'), '') <> 'admin' THEN
      RAISE EXCEPTION 'Admin role required to refund wallet escrow for a dispute'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  -- ── End authorization guard ────────────────────────────────────────────

  -- Lock the dispute row.
  SELECT bounty_id, status, winner
    INTO v_bounty_id, v_dispute_status, v_dispute_winner
    FROM public.bounty_disputes
   WHERE id = p_dispute_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dispute % not found', p_dispute_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Authorization-of-effect guard: only refund when the dispute has actually
  -- been resolved in the poster's favour. Accepts the canonical resolution
  -- status set by fn_close_dispute_hold and, as a belt-and-braces check, the
  -- winner column written by resolveDispute. An accidental or stale call for
  -- an open / hunter-won / closed dispute must not credit the poster.
  IF v_dispute_status <> 'resolved_poster_wins'
     OR COALESCE(v_dispute_winner, '') <> 'poster' THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::NUMERIC;
    RETURN;
  END IF;

  IF v_bounty_id IS NULL THEN
    -- Stripe-originated dispute with no local bounty link; nothing to refund here.
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::NUMERIC;
    RETURN;
  END IF;

  -- Load the bounty and confirm the wallet-escrow path applies.
  -- Note: payment_intent_id is not a column on bounties; the TypeScript caller
  -- already guarantees this RPC is only invoked for wallet-escrowed bounties.
  SELECT user_id, amount, is_for_honor
    INTO v_poster_id, v_bounty_amount, v_is_for_honor
    FROM public.bounties
   WHERE id = v_bounty_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bounty % not found for dispute %', v_bounty_id, p_dispute_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Honor or zero-amount bounties have no funds to refund.
  IF COALESCE(v_is_for_honor, FALSE)
     OR v_bounty_amount IS NULL
     OR v_bounty_amount <= 0 THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::NUMERIC;
    RETURN;
  END IF;

  -- Idempotency: do not double-refund / refund-after-release.  If any completed
  -- `refund` or `release` for this bounty already exists, treat this call as a
  -- no-op.  Mirrors the guard in services/api consolidated-wallet-service.refundEscrow.
  SELECT id
    INTO v_existing_settlement
    FROM public.wallet_transactions
   WHERE bounty_id = v_bounty_id
     AND type IN ('refund', 'release')
     AND status = 'completed'
   LIMIT 1;

  IF v_existing_settlement IS NOT NULL THEN
    RETURN QUERY SELECT FALSE, v_existing_settlement, NULL::NUMERIC;
    RETURN;
  END IF;

  -- Find the original escrow transaction so the refund references it AND
  -- uses the exact escrowed amount.  We rely on the ledger row's recorded
  -- amount (not bounties.amount) to guard against drift between the bounty
  -- value and the actually-held wallet amount.  Stored as a negative outflow,
  -- so the refund credit is abs(amount).
  SELECT id, amount
    INTO v_escrow_tx_id, v_escrow_tx_amount
    FROM public.wallet_transactions
   WHERE bounty_id = v_bounty_id
     AND type      = 'escrow'
     AND status    = 'completed'
   LIMIT 1;

  IF v_escrow_tx_id IS NULL THEN
    -- No escrow row to refund against. Nothing safely refundable.
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::NUMERIC;
    RETURN;
  END IF;

  v_refund_amount := ABS(COALESCE(v_escrow_tx_amount, 0));

  IF v_refund_amount <= 0 THEN
    -- Escrow tx exists but recorded a zero amount; nothing to refund.
    RETURN QUERY SELECT FALSE, v_escrow_tx_id, NULL::NUMERIC;
    RETURN;
  END IF;

  -- Insert the refund ledger row.  Positive amount = credit to poster.
  INSERT INTO public.wallet_transactions (
    user_id,
    bounty_id,
    type,
    amount,
    description,
    status,
    metadata
  ) VALUES (
    v_poster_id,
    v_bounty_id,
    'refund',
    v_refund_amount,
    format('Dispute %s resolved in poster''s favour; escrow refunded.', p_dispute_id),
    'completed',
    jsonb_build_object(
      'bounty_id',            v_bounty_id,
      'dispute_id',           p_dispute_id,
      'escrow_transaction_id', v_escrow_tx_id,
      'reason',               'dispute_resolved_poster_wins',
      'refunded_at',          NOW()
    )
  )
  RETURNING id INTO v_refund_tx_id;

  -- Credit the poster's balance in the same transaction.  If this raises,
  -- the wallet_transactions INSERT above is rolled back too, leaving the
  -- ledger consistent.
  PERFORM public.update_balance(v_poster_id, v_refund_amount);

  RETURN QUERY SELECT TRUE, v_refund_tx_id, v_refund_amount;
END;
$$;

COMMENT ON FUNCTION public.fn_refund_wallet_escrow_for_dispute(INTEGER) IS
  'Refunds the poster''s wallet escrow when a dispute is resolved in their '
  'favour, for wallet-escrowed (non-Stripe) bounties only. Atomic: inserts a '
  'refund wallet_transactions row and credits profiles.balance in a single '
  'transaction. Idempotent — returns applied=false if a release/refund '
  'already exists. Callable by service_role or by authenticated users with '
  'app_metadata.role = admin.';

-- Restrict execution.  The function itself rejects non-admin JWTs, so granting
-- to authenticated is safe and matches fn_close_dispute_hold(INTEGER, TEXT).
REVOKE EXECUTE ON FUNCTION public.fn_refund_wallet_escrow_for_dispute(INTEGER) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.fn_refund_wallet_escrow_for_dispute(INTEGER) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.fn_refund_wallet_escrow_for_dispute(INTEGER) TO service_role;
