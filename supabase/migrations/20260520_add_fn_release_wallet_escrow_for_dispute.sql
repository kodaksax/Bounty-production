-- Migration: Add fn_release_wallet_escrow_for_dispute RPC
-- Created: 2026-05-20
--
-- Purpose:
--   When a bounty dispute is resolved in the hunter's favour, the escrowed
--   funds must be released to the hunter. For Stripe-backed bounties the
--   release is handled by paymentService.releaseEscrow (which captures the
--   PaymentIntent and transfers to the hunter's Connect account).  For
--   wallet-escrowed bounties (no payment_intent_id), funds were deducted
--   from the poster's wallet at posting time via apply_escrow and live in
--   the wallet_transactions / profiles.balance ledger — the hunter must
--   receive a credit by inserting a `release` ledger row and calling
--   update_balance(hunter_id, amount).
--
--   Previously, dispute resolution for the wallet-escrow + hunter-wins path
--   only released the balance_on_hold via fn_close_dispute_hold but never
--   credited the hunter, leaving the escrowed funds in limbo and triggering
--   the "Bounty completed but escrow still funded locally" monitoring alert.
--   This RPC fills that gap.
--
-- Behaviour:
--   - Verifies the caller is an admin (service_role or authenticated JWT
--     with app_metadata.role = 'admin'), matching fn_close_dispute_hold.
--   - Loads the dispute → bounty and confirms it is a wallet-escrowed,
--     monetary, non-honor bounty (no Stripe payment_intent_id).
--   - Verifies the dispute is resolved with winner = 'hunter'.
--   - Idempotent: if a completed `release` or `refund` already exists for
--     the bounty, returns applied=false without touching any balance.
--   - Inserts a `release` wallet_transactions row for the full escrowed
--     amount (credited to the hunter) and credits the hunter's balance via
--     update_balance() — all in a single transaction. If either step fails
--     the whole call rolls back, so the ledger and balance stay consistent.
--
-- IMPORTANT: p_dispute_id is INTEGER (matching bounty_disputes.id), NOT UUID.
--   This mirrors the type correction applied to fn_refund_wallet_escrow_for_dispute
--   in 20260520_fix_fn_refund_wallet_escrow_param_type.sql.
--
-- Depends on:
--   - update_balance(UUID, NUMERIC) RPC  (20260115_add_update_balance_rpc.sql)
--   - wallet_transactions.type CHECK includes 'release' (baseline schema)
--   - bounties.accepted_by column (stores the winning hunter's user_id)

CREATE OR REPLACE FUNCTION public.fn_release_wallet_escrow_for_dispute(
  p_dispute_id INTEGER
) RETURNS TABLE (
  applied        BOOLEAN,
  transaction_id UUID,
  release_amount NUMERIC
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
  v_hunter_id          UUID;
  v_bounty_amount      NUMERIC;
  v_is_for_honor       BOOLEAN;
  v_payment_intent_id  TEXT;
  v_escrow_tx_id       UUID;
  v_escrow_tx_amount   NUMERIC;
  v_release_amount     NUMERIC;
  v_existing_settlement UUID;
  v_release_tx_id      UUID;
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
  -- been resolved in the hunter's favour. An accidental or stale call for
  -- an open / poster-won / closed dispute must not credit the hunter.
  IF v_dispute_status <> 'resolved_hunter_wins'
     OR COALESCE(v_dispute_winner, '') <> 'hunter' THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::NUMERIC;
    RETURN;
  END IF;

  IF v_bounty_id IS NULL THEN
    -- Stripe-originated dispute with no local bounty link; nothing to release here.
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::NUMERIC;
    RETURN;
  END IF;

  -- Load the bounty and confirm the wallet-escrow path applies.
  SELECT user_id, amount, is_for_honor, payment_intent_id, accepted_by
    INTO v_poster_id, v_bounty_amount, v_is_for_honor, v_payment_intent_id, v_hunter_id
    FROM public.bounties
   WHERE id = v_bounty_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bounty % not found for dispute %', v_bounty_id, p_dispute_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Only handle wallet-escrow bounties (no Stripe PaymentIntent).
  -- Stripe-backed bounties are handled by paymentService.releaseEscrow on the client.
  IF v_payment_intent_id IS NOT NULL AND v_payment_intent_id <> '' THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::NUMERIC;
    RETURN;
  END IF;

  -- Honor or zero-amount bounties have no funds to release.
  IF COALESCE(v_is_for_honor, FALSE)
     OR v_bounty_amount IS NULL
     OR v_bounty_amount <= 0 THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::NUMERIC;
    RETURN;
  END IF;

  -- The hunter must be known (accepted_by) to receive the funds.
  IF v_hunter_id IS NULL THEN
    RAISE EXCEPTION 'Bounty % has no accepted_by hunter; cannot release funds for dispute %',
      v_bounty_id, p_dispute_id
      USING ERRCODE = 'P0001';
  END IF;

  -- Idempotency: do not double-release / release-after-refund.  If any completed
  -- `release` or `refund` for this bounty already exists, treat this call as a
  -- no-op.  Mirrors the guard in fn_refund_wallet_escrow_for_dispute.
  SELECT id
    INTO v_existing_settlement
    FROM public.wallet_transactions
   WHERE bounty_id = v_bounty_id
     AND type IN ('release', 'refund')
     AND status = 'completed'
   LIMIT 1;

  IF v_existing_settlement IS NOT NULL THEN
    RETURN QUERY SELECT FALSE, v_existing_settlement, NULL::NUMERIC;
    RETURN;
  END IF;

  -- Find the original escrow transaction so the release references it AND
  -- uses the exact escrowed amount.  We rely on the ledger row's recorded
  -- amount (stored as a negative outflow) so the release credit is abs(amount).
  SELECT id, amount
    INTO v_escrow_tx_id, v_escrow_tx_amount
    FROM public.wallet_transactions
   WHERE bounty_id = v_bounty_id
     AND type      = 'escrow'
     AND status    = 'completed'
   LIMIT 1;

  IF v_escrow_tx_id IS NULL THEN
    -- No escrow row to release against. Nothing safely releasable.
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::NUMERIC;
    RETURN;
  END IF;

  v_release_amount := ABS(COALESCE(v_escrow_tx_amount, 0));

  IF v_release_amount <= 0 THEN
    -- Escrow tx exists but recorded a zero amount; nothing to release.
    RETURN QUERY SELECT FALSE, v_escrow_tx_id, NULL::NUMERIC;
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
    v_release_amount,
    format('Dispute %s resolved in hunter''s favour; escrow released to hunter.', p_dispute_id),
    'completed',
    jsonb_build_object(
      'bounty_id',            v_bounty_id,
      'dispute_id',           p_dispute_id,
      'escrow_transaction_id', v_escrow_tx_id,
      'poster_id',            v_poster_id,
      'reason',               'dispute_resolved_hunter_wins',
      'released_at',          NOW()
    )
  )
  RETURNING id INTO v_release_tx_id;

  -- Credit the hunter's balance in the same transaction.  If this raises,
  -- the wallet_transactions INSERT above is rolled back too, leaving the
  -- ledger consistent.
  PERFORM public.update_balance(v_hunter_id, v_release_amount);

  RETURN QUERY SELECT TRUE, v_release_tx_id, v_release_amount;
END;
$$;

COMMENT ON FUNCTION public.fn_release_wallet_escrow_for_dispute(INTEGER) IS
  'Releases the escrowed funds to the hunter when a dispute is resolved in their '
  'favour, for wallet-escrowed (non-Stripe) bounties only. Atomic: inserts a '
  'release wallet_transactions row and credits the hunter''s profiles.balance in a '
  'single transaction. Idempotent — returns applied=false if a release/refund '
  'already exists. Callable by service_role or by authenticated users with '
  'app_metadata.role = admin.';

-- Restrict execution.  The function itself rejects non-admin JWTs, so granting
-- to authenticated is safe and matches fn_close_dispute_hold(INTEGER, TEXT).
REVOKE EXECUTE ON FUNCTION public.fn_release_wallet_escrow_for_dispute(INTEGER) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.fn_release_wallet_escrow_for_dispute(INTEGER) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.fn_release_wallet_escrow_for_dispute(INTEGER) TO service_role;
