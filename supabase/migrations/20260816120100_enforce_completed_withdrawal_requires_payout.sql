-- =====================================================================
-- THE INVARIANT
--
--   No completed withdrawal may exist without a Stripe payout id.
--
-- On 2026-08-13, thirteen withdrawals totalling $275 were written as
-- `completed` because a Stripe *Transfer* had succeeded. A Transfer moves
-- money from the platform balance into a connected account; it puts nothing
-- in a hunter's bank. Those rows carried no `stripe_payout_id`, and because
-- every control in the system (payout.paid, payout.failed, the reconciliation
-- sweep) keys off that column, a null there removed them from the reach of
-- every safety net at once.
--
-- Application code now only writes `completed` from the payout.paid webhook.
-- This constraint is the independent storage-level guarantee: even a future
-- edit, a manual UPDATE or an admin tool cannot reintroduce the state.
--
-- GRANDFATHERING
-- The 25 historical rows that violate this ($526.65, newest 2026-08-14
-- 14:44 UTC) are deliberately NOT modified — remediating them requires
-- confirming against Stripe whether each hunter was actually paid, which is a
-- human decision. The cutoff below exempts exactly those rows so the
-- constraint can be added as VALID (checked on every future INSERT *and*
-- UPDATE) instead of NOT VALID (which would let a later UPDATE of a legacy
-- row fail unpredictably). Those rows remain visible: the reconciliation job's
-- `completed_withdrawal_without_payout` finding reports them on every run.
--
-- The cutoff MUST sit in the past. An earlier draft used 2026-08-17, which
-- was tomorrow when the migration ran — every row written on the day of the
-- fix satisfied the escape clause and the constraint was silently inert. A
-- cutoff between the newest violating row (2026-08-14 14:44) and now is what
-- makes it bite immediately; 2026-08-15 00:00 UTC is comfortably both.
--
-- Scoped to withdrawals only. Deposits, escrow, releases and refunds have no
-- payout and legitimately complete without one. `manually_paid` is likewise
-- exempt by construction: it is the explicit "settled outside Stripe" state.
-- =====================================================================

ALTER TABLE public.wallet_transactions
  DROP CONSTRAINT IF EXISTS wallet_transactions_completed_withdrawal_requires_payout;

ALTER TABLE public.wallet_transactions
  ADD CONSTRAINT wallet_transactions_completed_withdrawal_requires_payout
  CHECK (
    type <> 'withdrawal'::wallet_tx_type_enum
    OR status <> 'completed'::wallet_tx_status_enum
    OR stripe_payout_id IS NOT NULL
    -- Historical rows from the pre-fix flow. See GRANDFATHERING above.
    OR created_at < TIMESTAMPTZ '2026-08-15 00:00:00+00'
  );

COMMENT ON CONSTRAINT wallet_transactions_completed_withdrawal_requires_payout
  ON public.wallet_transactions IS
  'A withdrawal may only be completed when a Stripe payout id records which payout settled it. Rows created before 2026-08-15 are grandfathered (the instant-payout fallback incident); every row after that date must carry the evidence. See supabase/functions/_shared/payout-state.ts.';

-- Supports the reconciliation invariant sweep, which scans all time rather
-- than a rolling window.
CREATE INDEX IF NOT EXISTS idx_wallet_tx_completed_withdrawal_no_payout
  ON public.wallet_transactions (created_at DESC)
  WHERE type = 'withdrawal'::wallet_tx_type_enum
    AND status = 'completed'::wallet_tx_status_enum
    AND stripe_payout_id IS NULL;

-- Payout ids must be unique across the ledger: one Stripe payout can settle
-- at most one withdrawal. Without this, a webhook bug or a manual fix could
-- attach the same payout to two rows and book one delivery as two payments.
-- Partial so the many legacy NULLs do not collide.
CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_tx_stripe_payout_id_unique
  ON public.wallet_transactions (stripe_payout_id)
  WHERE stripe_payout_id IS NOT NULL;
