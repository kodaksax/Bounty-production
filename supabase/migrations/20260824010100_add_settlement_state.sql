-- =====================================================================
-- ADR 0001 §2 — settlement_state
--
--     A record may only be described to a user as settled when a Stripe
--     object confirms it. Everything else is described as what it is.
--
-- Four states. `stripe_pending` is where every correctly-behaving
-- withdrawal lives for the 1-2 business days a standard payout takes to land.
-- Collapsing it into `stripe_settled` is exactly the 2026-08-13 incident — a
-- submitted payout called paid. Collapsing it into `ledger_only` would erase
-- the fact that real money is in flight.
--
-- `stripe_failed` was not in the ADR's original three-state design. It was
-- added during implementation because without it a payout Stripe had rejected
-- derived as `stripe_pending`, which the UI renders as "On its way" — false in
-- the same direction as the bug this migration set exists to fix.
--
-- WHAT THIS IS NOT
-- This column does not duplicate `status`. They answer different questions:
--
--   status            — is our ledger finished with this row?
--   settlement_state  — did money actually move at Stripe?
--
-- The entire 2026-08-24 audit is the story of those two being conflated. A v1
-- release is legitimately status='completed' AND settlement_state='ledger_only':
-- the ledger is done, and nothing left the platform. Both are true; only saying
-- the first is what misled people.
-- =====================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'settlement_state_enum') THEN
    CREATE TYPE public.settlement_state_enum AS ENUM (
      'ledger_only',    -- money moved only inside this database
      'stripe_pending', -- a Stripe object exists; it has not reached terminal success
      'stripe_settled', -- Stripe confirmed terminal success
      'stripe_failed'   -- Stripe tried and explicitly did not deliver
    );
  END IF;
END $$;

-- ─── wallet_transactions ────────────────────────────────────────────────────
-- Defaulting to 'ledger_only' is the safe direction: a row that somehow escapes
-- the derive trigger claims the least, not the most.
ALTER TABLE public.wallet_transactions
  ADD COLUMN IF NOT EXISTS settlement_state public.settlement_state_enum
  NOT NULL DEFAULT 'ledger_only';

COMMENT ON COLUMN public.wallet_transactions.settlement_state IS
  'What Stripe can prove about this row, derived from the evidence columns by fn_derive_settlement_state() — never set by a writer, and never derived from `status`. Distinct from `status`: `status` is whether the ledger is finished, this is whether money moved. See ADR 0001 §2.';

-- The user-facing query this exists to make expressible. Before this column the
-- anomaly class could only be described as a date-bounded heuristic; now it is
-- a predicate: "our ledger says this withdrawal completed and Stripe has no
-- record of it."
CREATE INDEX IF NOT EXISTS idx_wallet_tx_settlement_state
  ON public.wallet_transactions (type, settlement_state);

-- ─── bounty_payments (v2) ───────────────────────────────────────────────────
-- v2 already encodes this in `status` (only transfer.created may write
-- 'released'). The column is added for a uniform API contract so clients read
-- one field across both architectures rather than branching on version.
ALTER TABLE public.bounty_payments
  ADD COLUMN IF NOT EXISTS settlement_state public.settlement_state_enum
  NOT NULL DEFAULT 'ledger_only';

COMMENT ON COLUMN public.bounty_payments.settlement_state IS
  'Derived from bounty_payments.status by fn_derive_bounty_payment_settlement_state(). Present so clients read one settlement field across v1 and v2 rather than branching on payment_architecture_version. See ADR 0001 §2.6.';
