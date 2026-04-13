-- Migration: Add Stripe dispute tracking columns
-- Created: 2026-04-14
-- Purpose: Support charge.dispute.created / charge.dispute.closed webhook handlers.
--   1. profiles.balance_frozen  — freeze wallet while a Stripe dispute is open.
--   2. bounty_disputes.stripe_dispute_id — Stripe dispute object ID (dp_xxx).
--   3. bounty_disputes.stripe_payment_intent_id — PI that triggered the dispute.
--   4. Extend bounty_disputes.status CHECK to accept the new Stripe-originated
--      statuses: 'stripe_dispute', 'resolved_won', 'resolved_lost'.

-- 1. Add balance_frozen to profiles (idempotent)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS balance_frozen BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.balance_frozen IS
  'Set to true when a Stripe chargeback dispute is open so that the poster cannot withdraw frozen funds.';

-- 2. Add Stripe dispute columns to bounty_disputes (idempotent)
ALTER TABLE public.bounty_disputes
  ADD COLUMN IF NOT EXISTS stripe_dispute_id TEXT,
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id TEXT;

COMMENT ON COLUMN public.bounty_disputes.stripe_dispute_id IS
  'Stripe Dispute object ID (dp_xxx) from charge.dispute.created event.';
COMMENT ON COLUMN public.bounty_disputes.stripe_payment_intent_id IS
  'Stripe PaymentIntent ID that the disputed charge belongs to.';

-- Unique index so the upsert in the webhook is idempotent
CREATE UNIQUE INDEX IF NOT EXISTS idx_bounty_disputes_stripe_dispute_id
  ON public.bounty_disputes (stripe_dispute_id)
  WHERE stripe_dispute_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bounty_disputes_stripe_payment_intent
  ON public.bounty_disputes (stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;

-- 3. Extend the status CHECK constraint to include Stripe dispute statuses.
--    The original anonymous constraint is named bounty_disputes_status_check
--    by PostgreSQL convention.  Drop it and re-add with the full value set.
ALTER TABLE public.bounty_disputes
  DROP CONSTRAINT IF EXISTS bounty_disputes_status_check;

ALTER TABLE public.bounty_disputes
  ADD CONSTRAINT bounty_disputes_status_check
  CHECK (status IN (
    'open',
    'under_review',
    'resolved',
    'closed',
    'stripe_dispute',
    'resolved_won',
    'resolved_lost'
  ));
