-- Migration: Add notifications_outbox table for queued notifications
-- Stores pending notifications to be processed by an Edge Function or worker

CREATE TABLE IF NOT EXISTS public.notifications_outbox (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  scheduled_at timestamptz NULL,
  status text NOT NULL DEFAULT 'pending', -- pending | sending | sent | failed
  attempts integer NOT NULL DEFAULT 0,
  last_error text NULL,
  bounty_id text NULL,
  recipients jsonb NULL, -- array of profile ids
  title text NULL,
  body text NULL,
  data jsonb NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes for processing
CREATE INDEX IF NOT EXISTS idx_notifications_outbox_status_scheduled ON public.notifications_outbox (status, scheduled_at);

-- Trigger to maintain updated_at
CREATE OR REPLACE FUNCTION public.refresh_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notifications_outbox_updated_at ON public.notifications_outbox;
CREATE TRIGGER trg_notifications_outbox_updated_at
  BEFORE UPDATE ON public.notifications_outbox
  FOR EACH ROW EXECUTE FUNCTION public.refresh_updated_at();

-- Enable Row Level Security (policies to be added by operators if desired)
ALTER TABLE public.notifications_outbox ENABLE ROW LEVEL SECURITY;
