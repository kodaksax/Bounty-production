-- =====================================================================
-- ADR 0001 §2.3 — settlement_state is DERIVED, never assigned.
--
-- No writer sets this column. It is computed from the evidence already on the
-- row, on every INSERT and UPDATE. Three reasons this shape was chosen over
-- threading a new field through each caller:
--
--   1. It cannot drift from the evidence, because it *is* the evidence
--      restated. There is no code path that can set it wrong.
--   2. It requires zero changes to the Edge Functions that write ledger rows,
--      which is a far smaller blast radius on a live money path.
--   3. It covers writers no application change could reach — in particular
--      fn_release_wallet_escrow_for_dispute(), a SECURITY DEFINER PL/pgSQL
--      function that inserts type='release', status='completed' directly and
--      never touches /wallet/release. An app-layer guard would have missed it
--      entirely.
--
-- This mirrors, statement for statement, deriveSettlementState() in
-- supabase/functions/_shared/settlement-state.ts. __tests__/unit/
-- settlement-state.test.ts asserts the two agree; if you edit one, edit both.
-- =====================================================================

-- ─── The rule, as a callable function ───────────────────────────────────────
-- Extracted from the trigger body so the backfill can invoke the SAME code
-- rather than restating the CASE. A backfill that computes the value
-- independently is a second implementation that can disagree with the first,
-- and a settlement classification that disagrees with itself is worse than
-- none.
--
-- IMMUTABLE: output depends only on the arguments, so Postgres may inline it
-- into the trigger and the backfill alike.
CREATE OR REPLACE FUNCTION public.fn_settlement_state_for(
  p_type              text,
  p_payout_id         text,
  p_payout_status     text,
  p_transfer_id       text,
  p_charge_id         text,
  p_payment_intent_id text,
  p_refund_id         text
)
RETURNS public.settlement_state_enum
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  -- NOTE: there is no `status` parameter, and that is the point. `status` is
  -- what the application believes; a Stripe id is what Stripe can prove. Of the
  -- 27 withdrawals marked completed before 2026-08-16, 25 have no payout id —
  -- a rule that trusted `status` would certify exactly those as settled, which
  -- is the defect this whole migration set exists to close. Adding the
  -- parameter would be the regression.
  SELECT (
    CASE p_type
      WHEN 'withdrawal' THEN
        CASE
          WHEN NULLIF(TRIM(COALESCE(p_payout_id, '')), '') IS NULL
            THEN 'ledger_only'
          WHEN p_payout_status = 'paid'
            THEN 'stripe_settled'
          -- A payout Stripe rejected is neither settled nor in flight. Without
          -- this branch it would derive as 'stripe_pending', which the UI
          -- renders as "On its way" — false in the same direction as the bug
          -- this function exists to prevent.
          WHEN p_payout_status IN ('failed', 'canceled')
            THEN 'stripe_failed'
          ELSE 'stripe_pending'
        END
      WHEN 'deposit' THEN
        CASE
          WHEN NULLIF(TRIM(COALESCE(p_payment_intent_id, '')), '') IS NOT NULL
            OR NULLIF(TRIM(COALESCE(p_charge_id, '')), '') IS NOT NULL
            THEN 'stripe_settled'
          ELSE 'ledger_only'
        END
      WHEN 'release' THEN
        CASE
          WHEN NULLIF(TRIM(COALESCE(p_transfer_id, '')), '') IS NOT NULL
            THEN 'stripe_settled'
          ELSE 'ledger_only'
        END
      WHEN 'refund' THEN
        CASE
          WHEN NULLIF(TRIM(COALESCE(p_refund_id, '')), '') IS NOT NULL
            THEN 'stripe_settled'
          ELSE 'ledger_only'
        END
      ELSE 'ledger_only'
    END
  )::public.settlement_state_enum;
$$;

COMMENT ON FUNCTION public.fn_settlement_state_for IS
  'The settlement classification rule. Takes only Stripe evidence — deliberately no `status` parameter. Called by both fn_derive_settlement_state() and the backfill so there is exactly one implementation. Mirrors deriveSettlementState() in supabase/functions/_shared/settlement-state.ts.';

CREATE OR REPLACE FUNCTION public.fn_derive_settlement_state()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.settlement_state := public.fn_settlement_state_for(
    NEW.type::text,
    NEW.stripe_payout_id,
    NEW.stripe_payout_status,
    NEW.stripe_transfer_id,
    NEW.stripe_charge_id,
    NEW.stripe_payment_intent_id,
    NEW.stripe_refund_id
  );
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.fn_derive_settlement_state IS
  'BEFORE INSERT OR UPDATE on wallet_transactions. Recomputes settlement_state from the row''s Stripe evidence columns. Never reads status. See ADR 0001 §2.3.';

DROP TRIGGER IF EXISTS trg_wallet_tx_derive_settlement_state ON public.wallet_transactions;
CREATE TRIGGER trg_wallet_tx_derive_settlement_state
  BEFORE INSERT OR UPDATE ON public.wallet_transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_derive_settlement_state();

-- ─── bounty_payments (v2) ───────────────────────────────────────────────────
-- v2's own status vocabulary already carries the settlement fact; this only
-- projects it onto the shared column so clients read one field.
CREATE OR REPLACE FUNCTION public.fn_derive_bounty_payment_settlement_state()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.settlement_state :=
    CASE
      -- Only transfer.created may set 'released'; it always carries a transfer id.
      WHEN NEW.status = 'released'
        AND NULLIF(TRIM(COALESCE(NEW.stripe_transfer_id, '')), '') IS NOT NULL
        THEN 'stripe_settled'
      WHEN NEW.status IN ('captured', 'release_pending')
        THEN 'stripe_pending'
      WHEN NEW.status IN ('refunded', 'canceled')
        AND NULLIF(TRIM(COALESCE(NEW.stripe_refund_id, '')), '') IS NOT NULL
        THEN 'stripe_settled'
      ELSE 'ledger_only'
    END::public.settlement_state_enum;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bounty_payments_derive_settlement_state ON public.bounty_payments;
CREATE TRIGGER trg_bounty_payments_derive_settlement_state
  BEFORE INSERT OR UPDATE ON public.bounty_payments
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_derive_bounty_payment_settlement_state();
