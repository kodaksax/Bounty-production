-- Migration: Enforce RLS policies on wallet_transactions, bounty_disputes, dispute_evidence, and stripe_events
-- Created: 2026-04-13
-- Purpose: Make the intended RLS behavior explicit where wallet_transactions had RLS enabled but
--          NO policies. Under PostgreSQL, RLS with no applicable permissive policy already denies
--          access to anon/authenticated client roles, so the gap was not unintended client access;
--          it was missing explicit documentation of deny intent and a missing SELECT policy to let
--          users read only their own transaction rows.
--
-- Policy summary
--   wallet_transactions
--     SELECT  : user_id = auth.uid()  (own rows only)
--     INSERT  : denied from client    (no permissive policy + explicit restrictive for clarity)
--     UPDATE  : denied from client
--     DELETE  : denied from client
--   bounty_disputes
--     INSERT  : no additional policies needed (existing policies in 20260303_admin_only_dispute_updates.sql and 20260317_workflow_stage_disputes.sql cover this)
--     UPDATE  : admin-only (already enforced)
--     DELETE  : explicitly deny from any authenticated client
--   dispute_evidence
--     UPDATE  : deny from client (evidence is immutable once submitted)
--     DELETE  : deny from client
--   stripe_events
--     All operations denied from client (no permissive policy — service role bypasses RLS)
--     The explicit restrictive policy below makes the deny intent self-documenting.

-- ============================================================
-- 1. wallet_transactions
-- ============================================================

-- Drop any pre-existing policies to avoid conflicts on re-run
DROP POLICY IF EXISTS "wallet_transactions_select_own"   ON public.wallet_transactions;
DROP POLICY IF EXISTS "wallet_transactions_insert_deny"  ON public.wallet_transactions;
DROP POLICY IF EXISTS "wallet_transactions_update_deny"  ON public.wallet_transactions;
DROP POLICY IF EXISTS "wallet_transactions_delete_deny"  ON public.wallet_transactions;

-- Users may only read their own transactions.
-- Backend operations always use the service role which bypasses RLS.
CREATE POLICY "wallet_transactions_select_own"
  ON public.wallet_transactions
  FOR SELECT
  USING (user_id = auth.uid());

-- Clients must not insert transactions directly.
-- All writes go through SECURITY DEFINER RPCs (apply_deposit, fn_accept_bounty_request, etc.)
-- or the service-role backend.  Marked AS RESTRICTIVE so this deny cannot be bypassed by any
-- future permissive INSERT policy (restrictive policies are AND-ed, permissive are OR-ed).
CREATE POLICY "wallet_transactions_insert_deny"
  ON public.wallet_transactions
  AS RESTRICTIVE
  FOR INSERT
  WITH CHECK (false);

-- Transactions are immutable from the client.
CREATE POLICY "wallet_transactions_update_deny"
  ON public.wallet_transactions
  FOR UPDATE
  USING (false);

-- Transactions must not be deleted by clients.
CREATE POLICY "wallet_transactions_delete_deny"
  ON public.wallet_transactions
  FOR DELETE
  USING (false);

-- ============================================================
-- 2. bounty_disputes – add explicit DELETE denial
--    (SELECT / INSERT / UPDATE policies already exist from
--     20260303_admin_only_dispute_updates.sql and
--     20260317_workflow_stage_disputes.sql)
-- ============================================================

DROP POLICY IF EXISTS "bounty_disputes_delete_deny" ON public.bounty_disputes;

CREATE POLICY "bounty_disputes_delete_deny"
  ON public.bounty_disputes
  FOR DELETE
  USING (false);

-- ============================================================
-- 3. dispute_evidence – add explicit UPDATE and DELETE denial
--    (SELECT / INSERT policies already exist from
--     20260109_comprehensive_dispute_system.sql and
--     20260317_workflow_stage_disputes.sql)
-- ============================================================

DROP POLICY IF EXISTS "dispute_evidence_update_deny" ON public.dispute_evidence;
DROP POLICY IF EXISTS "dispute_evidence_delete_deny" ON public.dispute_evidence;

-- Evidence is immutable once submitted; only the service role may modify evidence records.
CREATE POLICY "dispute_evidence_update_deny"
  ON public.dispute_evidence
  FOR UPDATE
  USING (false);

CREATE POLICY "dispute_evidence_delete_deny"
  ON public.dispute_evidence
  FOR DELETE
  USING (false);

-- ============================================================
-- 4. stripe_events – already locked down by having RLS enabled
--    with no permissive policy.  Add an explicit restrictive
--    policy as documentation and a safeguard against accidental
--    future GRANT additions.
-- ============================================================

DROP POLICY IF EXISTS "stripe_events_deny_all_clients" ON public.stripe_events;

-- No authenticated user should ever read or write stripe_events.
-- The service role (webhooks Edge Function) bypasses RLS.
CREATE POLICY "stripe_events_deny_all_clients"
  ON public.stripe_events
  FOR ALL
  USING (false)
  WITH CHECK (false);
