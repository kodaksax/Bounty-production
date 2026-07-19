-- Migration: Document/backfill fn_accept_bounty_request's authorization guard
-- Created: 2026-07-19
--
-- BACKGROUND: A backend security audit this session flagged
-- fn_accept_bounty_request(text) (added 20260323, "fixed" for search_path in
-- 20260421_fix_fn_accept_bounty_request.sql) as CRITICAL -- SECURITY DEFINER,
-- no caller-identity check, callable directly by any authenticated client
-- (lib/services/bounty-request-service.ts's real/primary acceptRequest() path
-- calls `supabase.rpc('fn_accept_bounty_request', ...)` directly, bypassing
-- the accept-bounty-request Edge Function that DOES have an ownership check
-- but is unreachable in production since it's only called from a dead
-- isSupabaseConfigured===false branch).
--
-- Verified against the LIVE function definition (pg_get_functiondef), not
-- just git: production already has an authorization guard --
--   IF auth.role() = 'authenticated' THEN
--     IF bounty_row.poster_id IS NULL OR bounty_row.poster_id <> auth.uid() THEN
--       RAISE EXCEPTION 'Only the bounty poster can accept a request' USING ERRCODE = '42501';
--     END IF;
--   END IF;
-- This is tracked in production's schema_migrations as version 20260717232206,
-- name "harden_fn_accept_bounty_request_authz" -- but NO git file has ever
-- existed for it (confirmed: no file in supabase/migrations/, no commit in
-- `git log --all --grep`). It was applied directly to production, live, and
-- never backfilled into git. This migration closes that gap so the fix is
-- reproducible from source instead of only existing as a live DB object --
-- same remediation pattern as this session's other formalize-untracked-drift
-- fixes (public_profiles view, balance_on_hold column).
--
-- Pure CREATE OR REPLACE of the existing function, identical to what's
-- already live -- verified via pg_get_functiondef before writing this file,
-- not reconstructed from memory. Safe/idempotent to (re-)apply.

CREATE OR REPLACE FUNCTION public.fn_accept_bounty_request(p_request_id text)
RETURNS TABLE(bounty json, accepted_request json)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  req_row         RECORD;
  bounty_row      RECORD;
  updated_bounty  RECORD;
  updated_request RECORD;
  v_request_id    uuid := p_request_id::uuid;
BEGIN
  -- Lock the request row to prevent concurrent acceptance
  SELECT * INTO req_row FROM public.bounty_requests WHERE id = v_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'request_not_found';
  END IF;

  IF req_row.status IS NULL OR req_row.status::text <> 'pending' THEN
    RAISE EXCEPTION 'request_not_pending';
  END IF;

  -- Lock the bounty row
  SELECT * INTO bounty_row FROM public.bounties WHERE id = req_row.bounty_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bounty_not_found';
  END IF;

  -- ── Authorization guard ────────────────────────────────────────────────
  -- Only the bounty poster may accept a request. Service-role callers (edge
  -- functions, no JWT) are allowed; authenticated end-users must be the poster.
  -- Mirrors accept_bounty_request(uuid) and the dispute-RPC guard pattern.
  IF auth.role() = 'authenticated' THEN
    IF bounty_row.poster_id IS NULL OR bounty_row.poster_id <> auth.uid() THEN
      RAISE EXCEPTION 'Only the bounty poster can accept a request'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  -- ── End authorization guard ────────────────────────────────────────────

  IF bounty_row.status IS NULL OR bounty_row.status::text <> 'open' THEN
    RAISE EXCEPTION 'bounty_not_open';
  END IF;

  -- Atomically transition the bounty to in_progress
  UPDATE public.bounties
  SET
    status              = 'in_progress',
    accepted_request_id = v_request_id,
    accepted_by         = req_row.hunter_id,
    updated_at          = now()
  WHERE id = bounty_row.id;

  -- Mark the accepted request
  UPDATE public.bounty_requests
  SET status = 'accepted', updated_at = now()
  WHERE id = v_request_id;

  -- Reject all other pending requests for this bounty
  UPDATE public.bounty_requests
  SET status = 'rejected', updated_at = now()
  WHERE bounty_id = bounty_row.id
    AND id <> v_request_id
    AND status::text = 'pending';

  -- Read back the authoritative updated rows
  SELECT * INTO updated_bounty  FROM public.bounties        WHERE id = bounty_row.id;
  SELECT * INTO updated_request FROM public.bounty_requests WHERE id = v_request_id;

  RETURN QUERY SELECT row_to_json(updated_bounty), row_to_json(updated_request);
EXCEPTION
  WHEN others THEN
    RAISE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_accept_bounty_request(text) TO authenticated;

NOTIFY pgrst, 'reload schema';
