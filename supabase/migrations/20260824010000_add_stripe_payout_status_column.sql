-- =====================================================================
-- ADR 0001 §2.3 — record the Stripe payout status as a first-class column.
--
-- WHY THIS COLUMN EXISTS
--
-- Deriving settlement from the ledger's own `status` is the bug this ADR
-- closes: 25 of the 27 withdrawals marked `completed` before 2026-08-16 have
-- no Stripe payout behind them at all. So `status` is out as a signal.
--
-- That leaves a real gap. With `status` excluded, nothing on the row
-- distinguished "payout created, in transit" from "payout paid". The obvious
-- candidate — `metadata->>'payout_status'` — turned out to be NULL on all 30
-- withdrawal rows in production: writers for it exist (connect/index.ts sets it
-- at insert, the payout webhooks patch it) but no live row predates or reaches
-- them. It is also structurally the wrong home: buried in JSONB, unconstrained,
-- unindexed, and read elsewhere as a refund-once marker rather than as
-- settlement evidence.
--
-- So: record the Stripe fact explicitly instead of inferring it.
--
-- WRITE DISCIPLINE
-- Only the payout.paid / payout.failed / payout.canceled webhook handlers in
-- supabase/functions/webhooks/index.ts may write this column, and only from
-- Stripe's own `payout.status`. No other writer sets it. It is evidence, not
-- state — nothing derived may be stored here.
-- =====================================================================

ALTER TABLE public.wallet_transactions
  ADD COLUMN IF NOT EXISTS stripe_payout_status text;

ALTER TABLE public.wallet_transactions
  DROP CONSTRAINT IF EXISTS wallet_transactions_stripe_payout_status_valid;

ALTER TABLE public.wallet_transactions
  ADD CONSTRAINT wallet_transactions_stripe_payout_status_valid
  CHECK (
    stripe_payout_status IS NULL
    OR stripe_payout_status IN ('paid', 'pending', 'in_transit', 'canceled', 'failed')
  );

COMMENT ON COLUMN public.wallet_transactions.stripe_payout_status IS
  'Stripe''s own payout.status, copied verbatim by the payout webhook handlers. Evidence, never inference: this is the only thing permitted to promote a withdrawal to settlement_state = stripe_settled. NULL means Stripe has told us nothing yet. See ADR 0001 §2.3.';

-- A withdrawal cannot carry a payout status without a payout to have a status.
ALTER TABLE public.wallet_transactions
  DROP CONSTRAINT IF EXISTS wallet_transactions_payout_status_requires_payout_id;

ALTER TABLE public.wallet_transactions
  ADD CONSTRAINT wallet_transactions_payout_status_requires_payout_id
  CHECK (stripe_payout_status IS NULL OR stripe_payout_id IS NOT NULL);

-- Supports the settlement sweep, which scans all time rather than a window.
CREATE INDEX IF NOT EXISTS idx_wallet_tx_payout_status
  ON public.wallet_transactions (stripe_payout_status)
  WHERE stripe_payout_status IS NOT NULL;
