-- Migration: fix fn_accept_bounty_request
-- Created: 2026-04-21
-- Issue: #534 — Accepting a bounty request fails
--
-- Root Cause:
--   The fn_accept_bounty_request SECURITY DEFINER function (added 20260323) is
--   missing two things present in every newer SECURITY DEFINER function in this
--   project (apply_escrow, rpc_create_conversation, apply_deposit, etc.):
--
--   1. SET search_path = public
--      Without this, PostgreSQL uses the DEFINER role's default search_path
--      when executing the function. On Supabase projects with security
--      hardening enabled (or any project where the postgres role's search_path
--      has been tightened), the unqualified table references
--      (bounty_requests, bounties) cannot be resolved and the function throws
--      "relation does not exist". This error code (42P01) is not one of the
--      handled RPC error codes, so it bypasses the PGRST202 fallback and
--      propagates as an "Accept Failed" error to the user.
--
--   2. GRANT EXECUTE ON FUNCTION TO authenticated
--      No explicit EXECUTE grant was included. Although PostgreSQL defaults to
--      granting EXECUTE to PUBLIC for new functions, Supabase projects that
--      have had PUBLIC privileges revoked (via "Revoke public schema privileges"
--      security hardening, or custom role configuration) will deny the call
--      from the authenticated / anon roles.
--
-- Fix:
--   Recreate the function with SET search_path = public and an explicit GRANT.
--   Logic is unchanged from the original 20260323 migration.

CREATE OR REPLACE FUNCTION public.fn_accept_bounty_request(p_request_id text)
RETURNS TABLE(bounty json, accepted_request json)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

-- Grant explicit EXECUTE to authenticated users (mobile app calls this via
-- the Supabase JS client, which runs as the authenticated role).
GRANT EXECUTE ON FUNCTION public.fn_accept_bounty_request(text) TO authenticated;

-- Reload PostgREST schema cache so the updated function signature is visible.
NOTIFY pgrst, 'reload schema';
