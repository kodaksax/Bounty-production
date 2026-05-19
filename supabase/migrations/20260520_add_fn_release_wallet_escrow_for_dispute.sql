-- Migration: Add fn_release_wallet_escrow_for_dispute RPC
-- Created: 2026-05-20
--
-- Purpose:
--   When a bounty dispute is resolved in the HUNTER's favour, the escrowed
--   funds must be paid out to the hunter.  For Stripe-backed bounties the
--   payout is handled by paymentService.releaseEscrow (which captures the
--   PaymentIntent and transfers to the hunter's Connect account).  For
--   wallet-escrowed bounties (no payment_intent_id), the funds were
--   deducted from the poster's wallet at posting time via apply_escrow
--   and live in the wallet_transactions / profiles.balance ledger — Stripe
--   has no record of them, so they must be credited to the hunter here.
--
--   Previously, dispute resolution for the wallet-escrow path simply
--   released the balance_on_hold via fn_close_dispute_hold and logged a
--   warning, leaving the hunter unpaid even though the dispute was
--   resolved in their favour.  This RPC closes the symmetric gap that
--   fn_refund_wallet_escrow_for_dispute solved for poster-wins.
--
-- Behaviour:
--   - Verifies the caller is an admin (service_role or authenticated JWT
--     with app_metadata.role = 'admin'), matching fn_close_dispute_hold
--     and fn_refund_wallet_escrow_for_dispute.
--   - Loads the dispute → bounty and confirms it is a wallet-escrowed,
--     monetary, non-honor bounty (no Stripe payment_intent_id) with a
--     resolved hunter_id.
--   - Idempotent: if a completed `release` or `refund` already exists for
--     the bounty, returns applied=false without touching balances.
--   - Calculates a 5% platform fee on the escrowed amount (matching the
--     normal completion-path release in consolidated-wallet-service.ts).
--   - Inserts a `release` wallet_transactions row for the net hunter
--     amount, records the platform fee in platform_ledger, and credits
--     the hunter's balance via update_balance() — all in a single
--     transaction.  If any step fails the whole call rolls back, so the
--     ledger and balance stay consistent.
--
-- Depends on:
--   - update_balance(UUID, NUMERIC) RPC  (20260115_add_update_balance_rpc.sql)
--   - platform_ledger table              (20260330_add_platform_ledger.sql)
--   - wallet_transactions.type CHECK includes 'release' (baseline schema)

CREATE OR REPLACE FUNCTION public.fn_release_wallet_escrow_for_dispute(
  p_dispute_id UUID
) RETURNS TABLE (
  applied        BOOLEAN,
  transaction_id UUID,
  release_amount NUMERIC,
  platform_fee   NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bounty_id            UUID;
  v_dispute_status       TEXT;
  v_dispute_winner       TEXT;
  v_poster_id            UUID;
  v_hunter_id            UUID;
  v_bounty_amount        NUMERIC;
  v_is_for_honor         BOOLEAN;
  v_payment_intent_id    TEXT;
  v_escrow_tx_id         UUID;
  v_escrow_tx_amount     NUMERIC;
  v_total_amount         NUMERIC;
  v_platform_fee_percent NUMERIC := 5;  -- matches services/api default
  v_platform_fee         NUMERIC;
  v_hunter_amount        NUMERIC;
  v_existing_settlement  UUID;
  v_release_tx_id        UUID;
BEGIN
  -- ── Authorization guard ────────────────────────────────────────────────
  -- Allow service_role (no JWT) or authenticated admins only.
  IF auth.role() = 'authenticated' THEN
    IF COALESCE((auth.jwt() -> 'app_metadata' ->> 'role'), '') <> 'admin' THEN
      RAISE EXCEPTION 'Admin role required to release wallet escrow for a dispute'
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

  -- Authorization-of-effect guard: only release when the dispute has actually
  -- been resolved in the hunter's favour. Accepts the canonical resolution
  -- status set by fn_close_dispute_hold and, as a belt-and-braces check, the
  -- winner column written by resolveDispute. An accidental or stale call for
  -- an open / poster-won / closed dispute must not credit the hunter.
  IF v_dispute_status <> 'resolved_hunter_wins'
     OR COALESCE(v_dispute_winner, '') <> 'hunter' THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::NUMERIC, NULL::NUMERIC;
    RETURN;
  END IF;

  IF v_bounty_id IS NULL THEN
    -- Stripe-originated dispute with no local bounty link; nothing to pay here.
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::NUMERIC, NULL::NUMERIC;
    RETURN;
  END IF;

  -- Load the bounty and confirm the wallet-escrow path applies.
  SELECT user_id, hunter_id, amount, is_for_honor, payment_intent_id
    INTO v_poster_id, v_hunter_id, v_bounty_amount, v_is_for_honor, v_payment_intent_id
    FROM public.bounties
   WHERE id = v_bounty_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bounty % not found for dispute %', v_bounty_id, p_dispute_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Honor or zero-amount bounties have no funds to release.
  IF COALESCE(v_is_for_honor, FALSE)
     OR v_bounty_amount IS NULL
     OR v_bounty_amount <= 0 THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::NUMERIC, NULL::NUMERIC;
    RETURN;
  END IF;

  -- Stripe-backed bounties pay out via Stripe (paymentService.releaseEscrow);
  -- this RPC is for the wallet-escrow path only.
  IF v_payment_intent_id IS NOT NULL AND length(v_payment_intent_id) > 0 THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::NUMERIC, NULL::NUMERIC;
    RETURN;
  END IF;

  -- A hunter must be assigned on the bounty to receive the payout.  This
  -- mirrors the normal completion-path requirement.
  IF v_hunter_id IS NULL THEN
    RAISE EXCEPTION 'Bounty % has no hunter_id; cannot release wallet escrow for dispute %',
      v_bounty_id, p_dispute_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Idempotency: do not double-release / release-after-refund.  If any
  -- completed `release` or `refund` for this bounty already exists, treat
  -- this call as a no-op.  Mirrors the guard in services/api
  -- consolidated-wallet-service.releaseEscrow.
  SELECT id
    INTO v_existing_settlement
    FROM public.wallet_transactions
   WHERE bounty_id = v_bounty_id
     AND type IN ('refund', 'release')
     AND status = 'completed'
   LIMIT 1;

  IF v_existing_settlement IS NOT NULL THEN
    RETURN QUERY SELECT FALSE, v_existing_settlement, NULL::NUMERIC, NULL::NUMERIC;
    RETURN;
  END IF;

  -- Find the original escrow transaction so the release references it AND
  -- uses the exact escrowed amount.  We rely on the ledger row's recorded
  -- amount (not bounties.amount) to guard against drift between the bounty
  -- value and the actually-held wallet amount.  Stored as a negative outflow,
  -- so the gross release amount is abs(amount).
  SELECT id, amount
    INTO v_escrow_tx_id, v_escrow_tx_amount
    FROM public.wallet_transactions
   WHERE bounty_id = v_bounty_id
     AND type      = 'escrow'
     AND status    = 'completed'
   LIMIT 1;

  IF v_escrow_tx_id IS NULL THEN
    -- No escrow row to release against. Nothing safely payable here.
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::NUMERIC, NULL::NUMERIC;
    RETURN;
  END IF;

  v_total_amount := ABS(COALESCE(v_escrow_tx_amount, 0));

  IF v_total_amount <= 0 THEN
    -- Escrow tx exists but recorded a zero amount; nothing to release.
    RETURN QUERY SELECT FALSE, v_escrow_tx_id, NULL::NUMERIC, NULL::NUMERIC;
    RETURN;
  END IF;

  -- Compute the platform fee and the net hunter amount.  Rounded to 2dp
  -- to match the cents-precision accounting used elsewhere.
  v_platform_fee  := ROUND((v_total_amount * v_platform_fee_percent) / 100.0, 2);
  v_hunter_amount := v_total_amount - v_platform_fee;

  IF v_hunter_amount <= 0 THEN
    -- Defensive: a sub-cent bounty could in theory round the entire amount
    -- to fee.  Don't write a zero-credit release.
    RETURN QUERY SELECT FALSE, v_escrow_tx_id, NULL::NUMERIC, NULL::NUMERIC;
    RETURN;
  END IF;

  -- Insert the release ledger row.  Positive amount = credit to hunter.
  INSERT INTO public.wallet_transactions (
    user_id,
    bounty_id,
    type,
    amount,
    description,
    status,
    metadata
  ) VALUES (
    v_hunter_id,
    v_bounty_id,
    'release',
    v_hunter_amount,
    format('Dispute %s resolved in hunter''s favour; escrow released.', p_dispute_id),
    'completed',
    jsonb_build_object(
      'bounty_id',             v_bounty_id,
      'dispute_id',            p_dispute_id,
      'escrow_transaction_id', v_escrow_tx_id,
      'platform_fee',          v_platform_fee,
      'reason',                'dispute_resolved_hunter_wins',
      'released_at',           NOW()
    )
  )
  RETURNING id INTO v_release_tx_id;

  -- Record the platform fee in the dedicated platform_ledger table.
  -- Best-effort within this transaction: if the insert fails the whole
  -- release is rolled back.
  IF v_platform_fee > 0 THEN
    INSERT INTO public.platform_ledger (
      bounty_id,
      amount,
      fee_type,
      description,
      metadata
    ) VALUES (
      v_bounty_id,
      v_platform_fee,
      'platform_fee',
      format('Platform fee for bounty %s (dispute %s)', v_bounty_id, p_dispute_id),
      jsonb_build_object(
        'source_transaction_id', v_release_tx_id,
        'dispute_id',            p_dispute_id,
        'reason',                'dispute_resolved_hunter_wins'
      )
    );
  END IF;

  -- Credit the hunter's balance in the same transaction.  If this raises,
  -- the wallet_transactions / platform_ledger inserts above are rolled
  -- back too, leaving the ledger and balance consistent.
  PERFORM public.update_balance(v_hunter_id, v_hunter_amount);

  RETURN QUERY SELECT TRUE, v_release_tx_id, v_hunter_amount, v_platform_fee;
END;
$$;

COMMENT ON FUNCTION public.fn_release_wallet_escrow_for_dispute(UUID) IS
  'Releases the escrowed funds to the hunter when a dispute is resolved in '
  'their favour, for wallet-escrowed (non-Stripe) bounties only. Atomic: '
  'inserts a release wallet_transactions row, records the platform fee in '
  'platform_ledger, and credits profiles.balance for the hunter in a single '
  'transaction. Idempotent — returns applied=false if a release/refund '
  'already exists. Callable by service_role or by authenticated users with '
  'app_metadata.role = admin.';

-- Restrict execution.  The function itself rejects non-admin JWTs, so granting
-- to authenticated is safe and matches fn_close_dispute_hold /
-- fn_refund_wallet_escrow_for_dispute.
REVOKE EXECUTE ON FUNCTION public.fn_release_wallet_escrow_for_dispute(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.fn_release_wallet_escrow_for_dispute(UUID) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.fn_release_wallet_escrow_for_dispute(UUID) TO service_role;
