-- Migration: Add Instant Cash Out tracking columns to wallet_transactions
-- Created: 2026-07-22
-- Purpose:
--   Supports the new POST /connect/instant-payout route (Stripe Connect
--   Instant Payouts to a debit-card external account), alongside the
--   existing standard bank-account withdrawal path. Every withdrawal row
--   (standard or instant) is still a single wallet_transactions row of
--   type='withdrawal' — these columns only distinguish *how* the payout
--   leg was fulfilled, they do not introduce a parallel ledger.
--
--   payout_method defaults to 'standard' so every pre-existing withdrawal
--   row (and every new standard withdrawal, which never sets this column
--   explicitly) is correctly classified without a backfill.
--
--   No new `profiles` columns are added by this migration, so the
--   `prevent_client_writes_to_protected_profile_columns` trigger allowlist
--   (20260717_revoke_client_writes_on_sensitive_profile_columns.sql) does not
--   need to change. Debit cards themselves are not cached in the database —
--   same convention as bank accounts today (Stripe's listExternalAccounts is
--   the live source of truth) — so no new table is introduced either.

ALTER TABLE wallet_transactions
  ADD COLUMN IF NOT EXISTS payout_method text NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS stripe_payout_id text,
  ADD COLUMN IF NOT EXISTS instant_fee_amount numeric(12, 2);

ALTER TABLE wallet_transactions
  DROP CONSTRAINT IF EXISTS wallet_transactions_payout_method_check;

ALTER TABLE wallet_transactions
  ADD CONSTRAINT wallet_transactions_payout_method_check
    CHECK (payout_method IN ('standard', 'instant'));

CREATE INDEX IF NOT EXISTS idx_wallet_transactions_stripe_payout_id
  ON wallet_transactions (stripe_payout_id)
  WHERE stripe_payout_id IS NOT NULL;

COMMENT ON COLUMN wallet_transactions.payout_method IS
  'How the payout leg of a withdrawal was fulfilled: ''standard'' (Stripe''s automatic payout sweep to a bank account, the existing default behavior) or ''instant'' (an explicit stripe.payouts.create(..., {method:''instant''}) call to a debit-card external account, initiated by POST /connect/instant-payout). Always ''standard'' for deposit/escrow/refund rows and for every withdrawal created before this column existed.';
COMMENT ON COLUMN wallet_transactions.stripe_payout_id IS
  'Stripe Payout object id (po_...) for withdrawals fulfilled via an explicit payouts.create() call (currently only the instant path — standard withdrawals rely on Stripe''s automatic sweep, whose Payout id is only ever learned after the fact via payout.paid/payout.failed webhooks and is not guaranteed to be captured here).';
COMMENT ON COLUMN wallet_transactions.instant_fee_amount IS
  'Stripe''s instant-payout fee in USD, charged to the hunter (deducted from the payout amount) for payout_method=''instant'' rows. Populated from the authoritative Stripe payout object/webhook, not the pre-submission UI estimate.';
