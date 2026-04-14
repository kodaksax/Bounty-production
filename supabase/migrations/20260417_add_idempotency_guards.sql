-- Migration: Add idempotency guards to charge.refunded and payout event handlers
-- Created: 2026-04-17
-- Purpose:
--   1. Add a unique index on wallet_transactions(stripe_charge_id) so the
--      charge.refunded webhook handler can use ON CONFLICT to avoid duplicate
--      refund rows when Stripe retries the event.
--   2. Add a stripe_payout_id column to notifications and a corresponding
--      unique index on (user_id, type, stripe_payout_id) so payout.paid /
--      payout.failed webhook handlers can ignore duplicate notification inserts
--      on Stripe retries.

-- ============================================================
-- 1. wallet_transactions — unique guard on stripe_charge_id
-- ============================================================

-- A unique partial index lets the webhook upsert use
--   ON CONFLICT (stripe_charge_id) DO NOTHING
-- preventing a second refund transaction row when Stripe retries the
-- charge.refunded event.
CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_tx_stripe_charge_id_unique
  ON public.wallet_transactions(stripe_charge_id)
  WHERE stripe_charge_id IS NOT NULL;

COMMENT ON INDEX idx_wallet_tx_stripe_charge_id_unique
  IS 'Unique index on stripe_charge_id to enforce one wallet transaction per Stripe Charge; enables ON CONFLICT idempotency in the charge.refunded webhook handler';

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
