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

CREATE OR REPLACE FUNCTION public.fn_derive_settlement_state()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- NOTE: NEW.status is deliberately never read. `status` is what the
  -- application believes; a Stripe id is what Stripe can prove. Of the 27
  -- withdrawals marked completed before 2026-08-16, 25 have no payout id — a
  -- rule that trusted `status` would certify exactly those as settled, which
  -- is the defect this whole migration set exists to close.
  NEW.settlement_state :=
    CASE NEW.type
      WHEN 'withdrawal' THEN
        CASE
          WHEN NULLIF(TRIM(COALESCE(NEW.stripe_payout_id, '')), '') IS NULL
            THEN 'ledger_only'
          WHEN NEW.stripe_payout_status = 'paid'
            THEN 'stripe_settled'
          -- A payout Stripe rejected is neither settled nor in flight. Without
          -- this branch it would derive as 'stripe_pending', which the UI
          -- renders as "On its way" — false in the same direction as the bug
          -- this trigger exists to prevent.
          WHEN NEW.stripe_payout_status IN ('failed', 'canceled')
            THEN 'stripe_failed'
          ELSE 'stripe_pending'
        END
      WHEN 'deposit' THEN
        CASE
          WHEN NULLIF(TRIM(COALESCE(NEW.stripe_payment_intent_id, '')), '') IS NOT NULL
            OR NULLIF(TRIM(COALESCE(NEW.stripe_charge_id, '')), '') IS NOT NULL
            THEN 'stripe_settled'
          ELSE 'ledger_only'
        END
      WHEN 'release' THEN
        CASE
          WHEN NULLIF(TRIM(COALESCE(NEW.stripe_transfer_id, '')), '') IS NOT NULL
            THEN 'stripe_settled'
          ELSE 'ledger_only'
        END
      WHEN 'refund' THEN
        CASE
          WHEN NULLIF(TRIM(COALESCE(NEW.stripe_refund_id, '')), '') IS NOT NULL
            THEN 'stripe_settled'
          ELSE 'ledger_only'
        END
      ELSE 'ledger_only'
    END::public.settlement_state_enum;

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
