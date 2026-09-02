-- P0 payment idempotency backstops.
--
-- Application code uses Stripe idempotency keys, but the database must still
-- reject shapes that would represent one bounty or Stripe object twice. This
-- migration is deliberately fail-loud: if live duplicate active payment rows
-- already exist, an operator must reconcile those Stripe objects before adding
-- the constraint rather than letting the migration pick a winner.

DO $$
DECLARE
  v_duplicate_bounty_id uuid;
BEGIN
  SELECT bounty_id INTO v_duplicate_bounty_id
  FROM public.bounty_payments
  WHERE status NOT IN ('canceled', 'failed')
  GROUP BY bounty_id
  HAVING count(*) > 1
  LIMIT 1;

  IF v_duplicate_bounty_id IS NOT NULL THEN
    RAISE EXCEPTION
      'Cannot add bounty_payments_one_live_row_per_bounty_idx; duplicate active bounty_payments rows exist for bounty_id %',
      v_duplicate_bounty_id;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS bounty_payments_one_live_row_per_bounty_idx
  ON public.bounty_payments (bounty_id)
  WHERE status NOT IN ('canceled', 'failed');

CREATE UNIQUE INDEX IF NOT EXISTS bounty_payments_stripe_transfer_unique_idx
  ON public.bounty_payments (stripe_transfer_id)
  WHERE stripe_transfer_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS bounty_payments_stripe_refund_unique_idx
  ON public.bounty_payments (stripe_refund_id)
  WHERE stripe_refund_id IS NOT NULL;

-- v3 writes release evidence directly to ledger_entries. A retry after Stripe
-- accepted the transfer may execute the insert again; this index turns that
-- into a single durable release row instead of duplicate audit evidence.
CREATE UNIQUE INDEX IF NOT EXISTS ledger_entries_one_transfer_leg_idx
  ON public.ledger_entries (leg, stripe_transfer_id)
  WHERE stripe_transfer_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ledger_entries_one_payout_leg_idx
  ON public.ledger_entries (leg, stripe_payout_id)
  WHERE stripe_payout_id IS NOT NULL;

COMMENT ON INDEX public.bounty_payments_one_live_row_per_bounty_idx IS
  'At most one non-canceled/non-failed Stripe-native payment record may exist per bounty.';
COMMENT ON INDEX public.bounty_payments_stripe_transfer_unique_idx IS
  'A Stripe Transfer may be attached to only one bounty payment.';
COMMENT ON INDEX public.bounty_payments_stripe_refund_unique_idx IS
  'A Stripe Refund may be attached to only one bounty payment.';
COMMENT ON INDEX public.ledger_entries_one_transfer_leg_idx IS
  'A Stripe Transfer may produce only one ledger entry for a given leg.';
COMMENT ON INDEX public.ledger_entries_one_payout_leg_idx IS
  'A Stripe Payout may produce only one ledger entry for a given leg.';