-- Migration: Restrict run_withdrawal_reconciliation() to service_role only
-- Created: 2026-07-18
--
-- BACKGROUND: caught live via get_advisors (security) — this SECURITY DEFINER
-- function had EXECUTE granted to `anon` and `authenticated`, meaning any
-- unauthenticated or logged-in client could call it directly via
-- POST /rest/v1/rpc/run_withdrawal_reconciliation. Not a fund-movement risk
-- (the function only inserts diagnostic rows into reconciliation_findings),
-- but it's an unauthenticated write/DoS surface with no legitimate client
-- use case — only the admin-withdrawals Edge Function (service_role) and the
-- daily pg_cron job should ever call this. Matches the access model already
-- documented in docs/withdrawals/03-engineering-runbook.md ("all service_role-only").
--
-- Unclear whether this predates this session's CREATE OR REPLACE FUNCTION
-- calls on this function or was already present — CREATE OR REPLACE does not
-- reset existing grants, so this could not have been introduced by simply
-- replacing the function body. Fixing regardless since it's wrong either way.

REVOKE EXECUTE ON FUNCTION public.run_withdrawal_reconciliation() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.run_withdrawal_reconciliation() FROM anon;
REVOKE EXECUTE ON FUNCTION public.run_withdrawal_reconciliation() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.run_withdrawal_reconciliation() TO service_role;
