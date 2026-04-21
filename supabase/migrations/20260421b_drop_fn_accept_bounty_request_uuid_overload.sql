-- Migration: drop uuid overload of fn_accept_bounty_request
-- Created: 2026-04-21
-- Issue: #534 — "Could not choose the best candidate function between
--         public.fn_accept_bounty_request(p_request_id => text),
--         public.fn_accept_bounty_request(p_request_id => uuid)"
--
-- Root Cause:
--   A previous version of fn_accept_bounty_request was created with a `uuid`
--   parameter type. The 20260421 migration used CREATE OR REPLACE with a `text`
--   parameter, which only replaces a function with the EXACT same signature.
--   The `uuid` overload remained, giving PostgREST two candidates for every
--   RPC call. PostgREST (PGRST203) refuses to choose between ambiguous
--   overloads and returns an error, causing the Accept Failed alert in the app.
--
-- Fix:
--   Drop the uuid overload. The canonical signature is (p_request_id text)
--   because the Supabase JS client always passes the request ID as a string.

DROP FUNCTION IF EXISTS public.fn_accept_bounty_request(uuid);

-- Reload PostgREST schema cache so it sees only the single text overload.
NOTIFY pgrst, 'reload schema';
