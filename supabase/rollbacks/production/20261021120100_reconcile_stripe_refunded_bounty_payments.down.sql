-- Rollback for 20261021120100_reconcile_stripe_refunded_bounty_payments.sql.
--
-- The migration only adds two functions and writes no rows. If the apply was
-- run, undo it FIRST, while the revert function still exists:
--   SELECT public.admin_revert_stripe_refund_reconciliation();
-- then run this file.

BEGIN;

DROP FUNCTION IF EXISTS public.admin_reconcile_stripe_refunded_bounty_payments(boolean);
DROP FUNCTION IF EXISTS public.admin_revert_stripe_refund_reconciliation();

COMMIT;
