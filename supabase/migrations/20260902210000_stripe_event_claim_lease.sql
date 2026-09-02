-- Stripe webhook event claim — standalone, concurrency-safe.
--
-- WHY THIS EXISTS SEPARATELY FROM THE COMMAND CENTER MIGRATION
-- ------------------------------------------------------------
-- `claim_stripe_event()` was introduced inside
-- 20260828130000_bounty_events_command_center.sql, alongside the bounty_events
-- ledger, seven triggers on live tables and a dozen admin RPCs. That migration
-- was never applied to production, but `supabase/functions/webhooks` — which
-- calls the RPC and deliberately fails closed when the claim errors — WAS
-- deployed (v76, 2026-08-31). Result: every signature-valid Stripe event has
-- returned 500 since, with PostgREST reporting
--   PGRST202: Could not find the function public.claim_stripe_event(...)
--
-- Restoring webhook processing must not be coupled to shipping the whole
-- observability package onto live tables. This migration therefore creates
-- ONLY the object the webhook endpoint requires.
--
-- SIGNATURE COMPATIBILITY: this deliberately keeps the Command Center
-- migration's exact (text, text, jsonb) signature so that whichever migration
-- is applied last is a true CREATE OR REPLACE. Adding a fourth (lease)
-- parameter would instead create an OVERLOAD, and PostgREST resolving a
-- 3-named-argument call against two candidates fails with PGRST203 — turning
-- a fix into the same total outage it repairs. The lease is a constant below.
--
-- Production also carries `fn_claim_stripe_event` /
-- `fn_mark_stripe_event_processed` — untracked functions with no source in the
-- repository, which nothing calls (the deployed code calls the unprefixed
-- name). They are LEFT IN PLACE: dropping objects of unknown provenance is a
-- separate, deliberate decision. See the audit report.
--
-- CONCURRENCY FIX vs. the Command Center version
-- ----------------------------------------------
-- That version gated the claim on `processed IS DISTINCT FROM true` alone,
-- which only dedupes against COMPLETED events. Two deliveries of the same
-- event arriving while the first is still in flight would BOTH claim it and
-- both run the handler — the exact scenario the dedupe exists to prevent
-- (Stripe redelivers on any timeout, and a slow handler is when timeouts
-- happen). This version adds a processing lease: a row already claimed and
-- still within its lease cannot be re-claimed, so concurrent deliveries
-- serialise on the conflicting row and exactly one proceeds.
--
-- The lease expires so a crashed or timed-out worker cannot strand an event
-- forever: afterwards a Stripe retry may re-claim it. 300s comfortably exceeds
-- the Edge Function wall-clock limit, so a lease can only lapse on a worker
-- that is genuinely gone.

CREATE OR REPLACE FUNCTION public.claim_stripe_event(
  p_stripe_event_id text,
  p_event_type      text,
  p_event_data      jsonb DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- Processing lease. Must stay above the Edge Function wall-clock limit.
  c_lease_seconds constant integer := 300;
  v_claimed uuid;
BEGIN
  IF p_stripe_event_id IS NULL OR length(p_stripe_event_id) = 0 THEN
    RAISE EXCEPTION 'claim_stripe_event: p_stripe_event_id is required';
  END IF;

  INSERT INTO public.stripe_events (
    stripe_event_id, event_type, event_data, processed, status, last_retry_at
  )
  VALUES (
    p_stripe_event_id, p_event_type, p_event_data, false, 'processing',
    -- Stamped on INSERT too, not only on the conflict path. Without it a
    -- freshly inserted row has last_retry_at IS NULL, the lease predicate
    -- below reads that as "no live lease", and the second of two concurrent
    -- deliveries claims the event the first is actively processing.
    now()
  )
  ON CONFLICT (stripe_event_id) DO UPDATE
    SET status        = 'processing',
        last_retry_at = now(),
        retry_count   = COALESCE(public.stripe_events.retry_count, 0) + 1,
        event_data    = COALESCE(EXCLUDED.event_data, public.stripe_events.event_data)
    WHERE public.stripe_events.processed IS DISTINCT FROM true
      -- Never re-enter a handler that is still running. A row left in
      -- 'processing' by a dead worker becomes claimable again once its lease
      -- lapses; a row marked 'failed' by record_stripe_event_failure() is
      -- immediately claimable, which is what lets Stripe's retry work.
      AND (
        public.stripe_events.status IS DISTINCT FROM 'processing'
        OR public.stripe_events.last_retry_at IS NULL
        OR public.stripe_events.last_retry_at < now() - make_interval(secs => c_lease_seconds)
      )
  RETURNING id INTO v_claimed;

  RETURN v_claimed IS NOT NULL;
END;
$$;

COMMENT ON FUNCTION public.claim_stripe_event(text, text, jsonb) IS
  'Atomically claims a Stripe webhook event for processing. Returns true only '
  'to the single caller that won the claim; false for an already-processed '
  'event or one currently held under a live 300s processing lease.';

REVOKE ALL ON FUNCTION public.claim_stripe_event(text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_stripe_event(text, text, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.claim_stripe_event(text, text, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_stripe_event(text, text, jsonb) TO service_role;

-- Surfaces events stuck mid-flight: claimed, lease long lapsed, never
-- completed. Under normal operation this is empty. A row here means a worker
-- died holding the event, or the handler throws on every Stripe retry.
CREATE INDEX IF NOT EXISTS stripe_events_stuck_processing_idx
  ON public.stripe_events (last_retry_at)
  WHERE processed IS DISTINCT FROM true AND status = 'processing';
