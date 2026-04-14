-- Migration: Add stripe_payment_intent_id to notifications_outbox for idempotent deposit notifications
-- Allows upsert on conflict so Stripe webhook retries do not enqueue duplicate notifications.

ALTER TABLE public.notifications_outbox
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id text NULL;

-- Partial unique index: only enforce uniqueness when the column is set
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_outbox_stripe_payment_intent_id
  ON public.notifications_outbox (stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;

COMMENT ON COLUMN public.notifications_outbox.stripe_payment_intent_id IS
  'Set for deposit notifications to prevent duplicate enqueues on Stripe webhook retries.';
