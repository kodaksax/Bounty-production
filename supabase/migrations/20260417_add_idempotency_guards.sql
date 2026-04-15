-- Migration: Add idempotency guards to charge.refunded and payout event handlers
-- Created: 2026-04-17
-- Purpose:
--   1. Add a stripe_refund_id column to wallet_transactions plus a unique
--      partial index on wallet_transactions(stripe_refund_id) so the
--      charge.refunded webhook handler can use the Stripe refund ID for
--      idempotency without blocking legitimate partial/multi-refund rows
--      that share the same stripe_charge_id.
--   2. Add a stripe_payout_id column to notifications and a corresponding
--      unique index on (user_id, type, stripe_payout_id) so payout.paid /
--      payout.failed webhook handlers can ignore duplicate notification inserts
--      on Stripe retries.

-- ============================================================
-- 1. wallet_transactions — refund-level idempotency guard
-- ============================================================

-- Store the Stripe refund ID on refund-related wallet transactions so
-- webhook handlers can deduplicate retries per refund while still allowing
-- multiple refund rows for the same Stripe charge (partial/multi-refund flows).
ALTER TABLE public.wallet_transactions
  ADD COLUMN IF NOT EXISTS stripe_refund_id text;

-- Keep stripe_charge_id indexed for lookup/query performance, but do not
-- enforce uniqueness because a single charge may have multiple refunds.
CREATE INDEX IF NOT EXISTS idx_wallet_tx_stripe_charge_id
  ON public.wallet_transactions(stripe_charge_id)
  WHERE stripe_charge_id IS NOT NULL;

COMMENT ON INDEX idx_wallet_tx_stripe_charge_id
  IS 'Non-unique index on stripe_charge_id for wallet transaction lookups; supports charges with multiple related refund rows';

-- Unique partial index: one wallet transaction per Stripe refund ID.
-- This enables refund-level idempotency on webhook replay without
-- preventing legitimate multi-refund flows on the same charge.
CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_tx_stripe_refund_id_unique
  ON public.wallet_transactions(stripe_refund_id)
  WHERE stripe_refund_id IS NOT NULL;

COMMENT ON INDEX idx_wallet_tx_stripe_refund_id_unique
  IS 'Unique index on stripe_refund_id to prevent duplicate refund wallet transactions when Stripe retries charge.refunded events';

-- ============================================================
-- 2. notifications — stripe_payout_id column + dedup index
-- ============================================================

-- Store the Stripe payout ID on payout-related notifications so we can
-- deduplicate them on webhook replay.
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS stripe_payout_id text;

-- Unique partial index: one payout notification per (user, type, payout).
-- Allows a user to receive separate payout.paid and payout.failed
-- notifications for different payouts while preventing duplicates caused by
-- Stripe retries of the same event.
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_payout_dedup
  ON public.notifications(user_id, type, stripe_payout_id)
  WHERE stripe_payout_id IS NOT NULL;

COMMENT ON INDEX idx_notifications_payout_dedup
  IS 'Unique index on (user_id, type, stripe_payout_id) to prevent duplicate payout notifications when Stripe retries payout.paid or payout.failed events';
