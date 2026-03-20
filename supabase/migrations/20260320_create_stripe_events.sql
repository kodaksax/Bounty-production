-- Migration: create stripe_events table for Stripe webhook idempotency
-- Created: 2026-03-20

CREATE TABLE IF NOT EXISTS public.stripe_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  stripe_event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  processed BOOLEAN NOT NULL DEFAULT FALSE,
  processed_at TIMESTAMPTZ,
  event_data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stripe_events_processed ON public.stripe_events (processed);
CREATE INDEX IF NOT EXISTS idx_stripe_events_event_type ON public.stripe_events (event_type);
