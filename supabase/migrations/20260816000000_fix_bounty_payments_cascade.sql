-- Migration: fix_bounty_payments_cascade
-- Date: 2026-08-16
-- Purpose: The bounty_payments table was created with a plain REFERENCES bounties(id)
--          constraint (no ON DELETE action), which defaults to RESTRICT.  This means
--          any attempt to hard-delete a bounty that has associated payment records fails
--          with a foreign key violation.  Bounties that have been "applied for" (i.e.
--          have bounty_requests) cannot be deleted because the payment flow may have
--          created a bounty_payments row (e.g. an authorised Stripe PaymentIntent).
--
--          This migration changes the FK to ON DELETE CASCADE so that deleting a bounty
--          automatically removes its payment audit rows.  Financial history is still
--          preserved via wallet_transactions (which uses ON DELETE SET NULL) and
--          Stripe's own dashboard records.

ALTER TABLE public.bounty_payments
  DROP CONSTRAINT IF EXISTS bounty_payments_bounty_id_fkey,
  ADD CONSTRAINT bounty_payments_bounty_id_fkey
    FOREIGN KEY (bounty_id)
    REFERENCES public.bounties(id)
    ON DELETE CASCADE;
