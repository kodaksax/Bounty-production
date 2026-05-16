-- Store one client-generated idempotency key per bounty create attempt.
-- This lets retrying clients receive the created bounty instead of a false
-- duplicate error after the first request already committed.

ALTER TABLE public.bounties
  ADD COLUMN IF NOT EXISTS client_request_id text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_bounties_poster_client_request_id
  ON public.bounties (poster_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

COMMENT ON COLUMN public.bounties.client_request_id IS
  'Client-generated idempotency key used to make bounty creation retries safe.';
