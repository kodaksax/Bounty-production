-- Migration: allow 'role_change' in admin_action_log.action_type
-- Created: 2026-09-03
--
-- BACKGROUND: the admin console's only server-side path for mutating a user
-- (admin-profiles Edge Function) gains an `updateRole` action that grants or
-- revokes the `admin` role claim in the GoTrue user's app_metadata -- the
-- claim every admin RLS policy and every admin-* Edge Function actually checks
-- (auth.jwt() -> app_metadata ->> 'role'), NOT profiles.role (dead, always
-- NULL in prod).
--
-- Like the suspend/ban path added in 20260726000000_enforce_account_status.sql,
-- every role change is written to admin_action_log with a required `reason`.
-- The action_type CHECK constraint enumerates allowed values, so it must learn
-- 'role_change' or the audit insert fails (silently, since the Edge Function
-- treats the audit write as non-blocking).

ALTER TABLE public.admin_action_log
  DROP CONSTRAINT IF EXISTS admin_action_log_action_type_check;
ALTER TABLE public.admin_action_log
  ADD CONSTRAINT admin_action_log_action_type_check
  CHECK (action_type IN (
    'force_retry_withdrawal',
    'manual_balance_adjustment',
    'mark_externally_settled_withdrawal',
    'reverse_stripe_transfer',
    'run_stripe_balance_sync',
    'acknowledge_reconciliation_finding',
    'account_status_change',
    'role_change'
  ));

NOTIFY pgrst, 'reload schema';
