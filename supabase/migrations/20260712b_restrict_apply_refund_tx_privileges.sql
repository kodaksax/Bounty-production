-- Migration: Restrict apply_refund_tx to service_role only
-- Date: 2026-07-12
-- Purpose:
--   The apply_refund_tx migration (20260712_add_apply_refund_tx_rpc.sql) only
--   added a GRANT for service_role, but never revoked PostgreSQL's default
--   PUBLIC EXECUTE privilege granted automatically on function creation. As a
--   result the function was directly callable by the `anon` and
--   `authenticated` roles via PostgREST at /rest/v1/rpc/apply_refund_tx,
--   confirmed via information_schema.routine_privileges and flagged by the
--   Supabase database linter (0028_anon_security_definer_function_executable,
--   0029_authenticated_security_definer_function_executable).
--
--   This is a critical issue: the function is SECURITY DEFINER and accepts
--   p_amount as a caller-supplied argument rather than deriving it from the
--   transaction row. Any authenticated (or anonymous) caller who could
--   supply/guess a pending refund transaction's (id, user_id) pair could
--   invoke the RPC directly with an arbitrary p_amount and credit that amount
--   to the target profile's balance, bypassing the edge function's ownership
--   checks entirely. apply_release_tx (the function this one mirrors) does
--   not have this exposure because its migration never granted PUBLIC/anon/
--   authenticated access in the first place.
--
-- Fix: explicitly revoke EXECUTE from PUBLIC, anon, and authenticated, so
-- only the service_role used by Edge Functions can call it — matching
-- apply_release_tx's privilege set exactly.

REVOKE EXECUTE ON FUNCTION public.apply_refund_tx(UUID, UUID, NUMERIC) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.apply_refund_tx(UUID, UUID, NUMERIC) FROM anon;
REVOKE EXECUTE ON FUNCTION public.apply_refund_tx(UUID, UUID, NUMERIC) FROM authenticated;

-- Reload PostgREST schema cache so the privilege change takes effect immediately.
NOTIFY pgrst, 'reload schema';
