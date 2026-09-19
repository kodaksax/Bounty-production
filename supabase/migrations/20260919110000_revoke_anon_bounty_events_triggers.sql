-- Migration: close anon EXECUTE on the bounty_events trigger functions
-- Created: 2026-09-19
--
-- 20260828130000_bounty_events_command_center.sql never applied to prod until
-- today (BNTY-10 needed it as a prerequisite). Applying it surfaced a security
-- advisor finding this database's default-grants-anon-EXECUTE behavior (see
-- anon-execute-default-grant memory / 20260828195437_revoke_anon_legacy_withdrawal_functions.sql)
-- also caught: the 7 trg_bounty_events_from_* SECURITY DEFINER trigger
-- functions never got an explicit REVOKE, unlike every other SECURITY
-- DEFINER function added since.
--
-- These RETURN trigger, so PostgREST cannot expose them as a callable RPC and
-- a direct SQL call fails with "trigger functions can only be called as
-- triggers" -- there was no live exploit path. This closes the grant
-- explicitly anyway, matching every other function in this file's family and
-- removing the advisor finding rather than relying on that incidental
-- protection.

REVOKE ALL ON FUNCTION public.trg_bounty_events_from_bounties() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_bounty_events_from_requests() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_bounty_events_from_completions() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_bounty_events_from_wallet() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_bounty_events_from_bounty_payments() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_bounty_events_from_disputes() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_bounty_events_from_reports() FROM PUBLIC, anon, authenticated;
