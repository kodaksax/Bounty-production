-- Durable per-user rate limit for the contact-support edge function.
-- One row per support email sent (or in flight). Only the edge function
-- (service role) reads or writes it; clients have no access.

CREATE TABLE IF NOT EXISTS public.support_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subject text NOT NULL,
  email_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS support_requests_user_created_idx
  ON public.support_requests (user_id, created_at DESC);

ALTER TABLE public.support_requests ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.support_requests FROM anon, authenticated;
