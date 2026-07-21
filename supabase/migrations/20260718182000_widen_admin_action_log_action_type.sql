-- Migration: Widen admin_action_log.action_type to include mark_externally_settled_withdrawal
-- Created: 2026-07-18
--
-- BACKGROUND: the new `mark_externally_settled` admin-withdrawals action
-- (added alongside force_retry and manual_adjustment) writes
-- action_type = 'mark_externally_settled_withdrawal' to admin_action_log,
-- but the original migration's CHECK constraint only allowed the two action
-- types that existed at the time. Caught live when the first real use of the
-- new action (the jordenhoward2 historical settlement) failed with a CHECK
-- violation — verified via pg_get_constraintdef before writing this fix,
-- confirming admin_action_log.action_type is a TEXT + CHECK constraint (not
-- an ENUM, unlike wallet_transactions.type/status).

ALTER TABLE public.admin_action_log
  DROP CONSTRAINT IF EXISTS admin_action_log_action_type_check;

ALTER TABLE public.admin_action_log
  ADD CONSTRAINT admin_action_log_action_type_check
  CHECK (action_type = ANY (ARRAY[
    'force_retry_withdrawal'::text,
    'manual_balance_adjustment'::text,
    'mark_externally_settled_withdrawal'::text,
    'reverse_stripe_transfer'::text
  ]));
