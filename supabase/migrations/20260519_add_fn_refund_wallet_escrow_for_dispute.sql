-- Migration: Add fn_refund_wallet_escrow_for_dispute RPC
-- Created: 2026-05-19
--
-- Purpose:
--   When a bounty dispute is resolved in the poster's favour, the escrowed
--   funds must be returned to the poster. For Stripe-backed bounties the
--   refund is handled by paymentService.refundEscrow (which cancels/refunds
--   the PaymentIntent).  For wallet-escrowed bounties (no payment_intent_id),
--   funds were deducted from the poster's wallet at posting time via
--   apply_escrow and live in the wallet_transactions / profiles.balance
--   ledger — Stripe has no record of them, so they must be returned by
--   crediting the poster's balance and writing a `refund` ledger row.
--
--   Previously, dispute resolution for the wallet-escrow path only released
--   the balance_on_hold via fn_close_dispute_hold but never restored the
--   underlying balance, leaving the poster's funds permanently locked.
--   This RPC fills that gap.
--
-- Behaviour:
--   - Verifies the caller is an admin (service_role or authenticated JWT
--     with app_metadata.role = 'admin'), matching fn_close_dispute_hold.
--   - Loads the dispute → bounty and confirms it is a wallet-escrowed,
--     monetary, non-honor bounty (no Stripe payment_intent_id).
--   - Idempotent: if a completed `release` or `refund` already exists for
--     the bounty, returns applied=false without touching the balance.
--   - Inserts a `refund` wallet_transactions row for the full escrowed
--     amount and credits the poster's balance via update_balance() — all
--     in a single transaction. If either step fails the whole call rolls
--     back, so the ledger and balance stay consistent.
--
-- Depends on:
--   - update_balance(UUID, NUMERIC) RPC  (20260115_add_update_balance_rpc.sql)
--   - wallet_transactions.type CHECK includes 'refund' (baseline schema)

CREATE OR REPLACE FUNCTION public.fn_refund_wallet_escrow_for_dispute(
  p_dispute_id UUID
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
  v_poster_id          UUID;
  v_bounty_amount      NUMERIC;
  v_is_for_honor       BOOLEAN;
  v_payment_intent_id  TEXT;
  v_escrow_tx_id       UUID;
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
  SELECT bounty_id
    INTO v_bounty_id
    FROM public.bounty_disputes
   WHERE id = p_dispute_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dispute % not found', p_dispute_id
      USING ERRCODE = 'P0002';
  END IF;

  IF v_bounty_id IS NULL THEN
    -- Stripe-originated dispute with no local bounty link; nothing to refund here.
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::NUMERIC;
    RETURN;
  END IF;

  -- Load the bounty and confirm the wallet-escrow path applies.
  SELECT user_id, amount, is_for_honor, payment_intent_id
    INTO v_poster_id, v_bounty_amount, v_is_for_honor, v_payment_intent_id
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

  -- Stripe-backed bounties are refunded via Stripe (paymentService.refundEscrow);
  -- this RPC is for the wallet-escrow path only.
  IF v_payment_intent_id IS NOT NULL AND length(v_payment_intent_id) > 0 THEN
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

  -- Find the original escrow tx so the refund references it and uses the
  -- exact escrowed amount (in case bounty.amount has since drifted).
  SELECT id
    INTO v_escrow_tx_id
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
    v_bounty_amount,
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
  PERFORM public.update_balance(v_poster_id, v_bounty_amount);

  RETURN QUERY SELECT TRUE, v_refund_tx_id, v_bounty_amount;
END;
$$;

COMMENT ON FUNCTION public.fn_refund_wallet_escrow_for_dispute(UUID) IS
  'Refunds the poster''s wallet escrow when a dispute is resolved in their '
  'favour, for wallet-escrowed (non-Stripe) bounties only. Atomic: inserts a '
  'refund wallet_transactions row and credits profiles.balance in a single '
  'transaction. Idempotent — returns applied=false if a release/refund '
  'already exists. Callable by service_role or by authenticated users with '
  'app_metadata.role = admin.';

-- Restrict execution.  The function itself rejects non-admin JWTs, so granting
-- to authenticated is safe and matches fn_close_dispute_hold.
REVOKE EXECUTE ON FUNCTION public.fn_refund_wallet_escrow_for_dispute(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.fn_refund_wallet_escrow_for_dispute(UUID) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.fn_refund_wallet_escrow_for_dispute(UUID) TO service_role;
