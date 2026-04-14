-- Migration: Add Stripe dispute tracking columns
-- Created: 2026-04-14
-- Purpose: Support charge.dispute.created / charge.dispute.closed webhook handlers.
--   1. profiles.balance_frozen  — freeze wallet while a Stripe dispute is open.
--   2. bounty_disputes.bounty_id made nullable for Stripe-originated disputes.
--   3. bounty_disputes.stripe_dispute_id — Stripe dispute object ID (dp_xxx).
--   4. bounty_disputes.stripe_payment_intent_id — PI that triggered the dispute.
--   5. Extend bounty_disputes.status CHECK to accept the new Stripe-originated
--      statuses: 'stripe_dispute', 'resolved_won', 'resolved_lost'.
--   6. Extend wallet_transactions.type CHECK to include 'dispute_loss'.
--   7. Add assert_profile_balance_not_frozen() enforcement helper.

-- 1. Add balance_frozen to profiles (idempotent)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS balance_frozen BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.balance_frozen IS
  'Set to true when a Stripe chargeback dispute is open; withdrawal/spend paths must enforce this flag and reject balance-moving operations while it is true.';

-- 2. Allow Stripe-originated disputes to be recorded before they are linked
--    to a local bounty — make bounty_id nullable for chargeback rows.
ALTER TABLE public.bounty_disputes
  ALTER COLUMN bounty_id DROP NOT NULL;

COMMENT ON COLUMN public.bounty_disputes.bounty_id IS
  'Nullable for Stripe-originated disputes that may not yet be mapped to a local bounty.';

-- 3. Add Stripe dispute columns to bounty_disputes (idempotent)
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

-- 4. Extend the status CHECK constraint to include Stripe dispute statuses.
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

-- 5. Extend wallet_transactions.type CHECK to include 'dispute_loss'.
--    Drop the existing anonymous constraint and re-add with the full value set.
ALTER TABLE public.wallet_transactions
  DROP CONSTRAINT IF EXISTS wallet_transactions_type_check;

ALTER TABLE public.wallet_transactions
  ADD CONSTRAINT wallet_transactions_type_check
  CHECK (type IN ('escrow', 'release', 'refund', 'deposit', 'withdrawal', 'dispute_loss'));

-- 6. DB-level enforcement helper for withdrawal/spend paths.
--    Call from any RPC/function that moves wallet funds before debiting balance.
CREATE OR REPLACE FUNCTION public.assert_profile_balance_not_frozen(p_profile_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance_frozen BOOLEAN;
BEGIN
  SELECT balance_frozen
  INTO v_balance_frozen
  FROM public.profiles
  WHERE id = p_profile_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile % not found', p_profile_id
      USING ERRCODE = 'P0002';
  END IF;

  IF v_balance_frozen THEN
    RAISE EXCEPTION 'Balance is frozen for profile %', p_profile_id
      USING ERRCODE = 'P0001',
            HINT = 'Open Stripe disputes must be resolved before withdrawals or other balance-moving operations are allowed.';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.assert_profile_balance_not_frozen(UUID) IS
  'Raises when profiles.balance_frozen is true. Call from withdrawal/spend RPCs before moving wallet funds.';

GRANT EXECUTE ON FUNCTION public.assert_profile_balance_not_frozen(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assert_profile_balance_not_frozen(UUID) TO service_role;
