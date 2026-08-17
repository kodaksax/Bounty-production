-- Phase 2 Stripe transfer settlement states.
-- `release_pending` means Stripe accepted the transfer request but the app has
-- not yet received the authoritative transfer.created confirmation. It is not a
-- user-facing paid state.

ALTER TABLE public.bounty_payments
  DROP CONSTRAINT IF EXISTS bounty_payments_status_check;

ALTER TABLE public.bounty_payments
  ADD CONSTRAINT bounty_payments_status_check CHECK (
    status IN (
      'pending_payment',
      'authorized',
      'captured',
      'release_pending',
      'released',
      'refund_pending',
      'refunded',
      'canceled',
      'disputed',
      'failed'
    )
  );

NOTIFY pgrst, 'reload schema';