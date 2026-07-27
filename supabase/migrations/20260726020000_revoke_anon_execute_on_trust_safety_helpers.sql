-- Migration: Revoke anon EXECUTE on internal SECURITY DEFINER helper functions
-- Created: 2026-07-26
--
-- Supabase auto-grants EXECUTE directly to the `anon` role on every newly
-- created function in the public schema (a direct grant, not inherited via
-- PUBLIC), so `REVOKE ALL ... FROM PUBLIC` in the two migrations applied
-- today (enforce_account_status, add_user_follows_rls_and_notifications) did
-- not actually remove anon's access -- confirmed via the security advisor
-- immediately after applying them. The same gap exists on the two SECURITY
-- DEFINER helpers from 20260725150000_trust_safety_hardening.sql. None of
-- these five functions are meant to be called directly by unauthenticated
-- clients -- they exist only to be called from inside RLS policies and
-- SECURITY DEFINER RPC bodies (which run as `authenticated` or bypass RLS
-- entirely), so anon access is pure unintended surface, not a used feature.
REVOKE EXECUTE ON FUNCTION public.is_account_active(UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.assert_account_active(UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.conversation_has_inactive_participant(UUID, UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_blocked_pair(UUID, UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.conversation_has_block(UUID, UUID) FROM anon;

NOTIFY pgrst, 'reload schema';
