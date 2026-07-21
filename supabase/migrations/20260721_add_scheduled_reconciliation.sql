-- Migration: Scheduled withdrawal/wallet reconciliation
-- Created: 2026-07-21
-- Purpose:
--   scripts/reconcile_and_triage.sql has always been manual-run only (see
--   docs/payments/BOUNTY_WITHDRAWAL_TECHNICAL_SPECIFICATION.md §4.8 item 6,
--   §8) — nothing runs it on a schedule, so drift/stuck-withdrawal findings
--   are only ever discovered when a support ticket or an engineer happens to
--   go looking. This adds a daily pg_cron job that runs a SQL translation of
--   that script's automatable sections (everything except §3b, which needs
--   live Stripe API access this function doesn't have) and records findings
--   in a new table instead of just printing query results to whoever happens
--   to run them.
--
--   Read-only against wallet_transactions/profiles — this function performs
--   no UPDATE/DELETE on financial data, only INSERTs into the new findings
--   table. Safe to enable live.

CREATE TABLE IF NOT EXISTS public.reconciliation_findings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finding_type TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  user_id UUID,
  details JSONB NOT NULL,
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by UUID
);

CREATE INDEX IF NOT EXISTS idx_reconciliation_findings_unacked
  ON public.reconciliation_findings (run_at DESC)
  WHERE acknowledged_at IS NULL;

ALTER TABLE public.reconciliation_findings ENABLE ROW LEVEL SECURITY;
-- No policies: service_role only (the cron job and any future admin-read
-- endpoint both connect as service_role and bypass RLS), same reasoning as
-- admin_action_log in 20260720_add_admin_action_log_and_adjustment_type.sql.

COMMENT ON TABLE public.reconciliation_findings IS
  'Findings from the daily run_withdrawal_reconciliation() pg_cron job — a scheduled, storable version of scripts/reconcile_and_triage.sql''s automatable checks.';

CREATE OR REPLACE FUNCTION public.run_withdrawal_reconciliation()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_finding_count INTEGER := 0;
  v_run_at TIMESTAMPTZ := now();
BEGIN
  -- 1. Balance drift: cached profiles.balance vs. SUM(completed wallet_transactions).
  INSERT INTO public.reconciliation_findings (run_at, finding_type, severity, user_id, details)
  SELECT
    v_run_at,
    'balance_drift',
    'critical',
    p.id,
    jsonb_build_object(
      'cached_balance', p.balance,
      'ledger_balance', COALESCE(SUM(wt.amount) FILTER (WHERE wt.status = 'completed'), 0),
      'drift', p.balance - COALESCE(SUM(wt.amount) FILTER (WHERE wt.status = 'completed'), 0)
    )
  FROM public.profiles p
  LEFT JOIN public.wallet_transactions wt ON wt.user_id = p.id
  GROUP BY p.id, p.balance
  HAVING p.balance <> COALESCE(SUM(wt.amount) FILTER (WHERE wt.status = 'completed'), 0);
  GET DIAGNOSTICS v_finding_count = ROW_COUNT;

  -- 1b. Negative/inconsistent balances (defense-in-depth: check_balance_non_negative
  -- should already prevent this at the DB level, but a finding here would mean
  -- that constraint was somehow bypassed or is missing again).
  INSERT INTO public.reconciliation_findings (run_at, finding_type, severity, user_id, details)
  SELECT v_run_at, 'negative_or_inconsistent_balance', 'critical', id,
    jsonb_build_object('balance', balance, 'balance_on_hold', balance_on_hold)
  FROM public.profiles
  WHERE balance < 0 OR balance_on_hold < 0 OR balance_on_hold > balance;

  -- 2. Orphaned wallet_transactions (user_id doesn't resolve to a profile).
  INSERT INTO public.reconciliation_findings (run_at, finding_type, severity, user_id, details)
  SELECT v_run_at, 'orphaned_transaction', 'warning', wt.user_id,
    jsonb_build_object('transaction_id', wt.id, 'type', wt.type, 'amount', wt.amount, 'status', wt.status)
  FROM public.wallet_transactions wt
  LEFT JOIN public.profiles p ON p.id = wt.user_id
  WHERE wt.user_id IS NOT NULL AND p.id IS NULL;

  -- 2b. Stuck pending withdrawals. Per docs/payments/BOUNTY_WITHDRAWAL_TECHNICAL_
  -- SPECIFICATION.md §1.2, a correctly-behaving /connect/transfer never leaves a
  -- row 'pending' for more than the duration of one request — anything still
  -- 'pending' after an hour is the known deploy-drift-regression signature, not
  -- normal latency, so this is flagged 'critical' well before the 3-day window
  -- scripts/reconcile_and_triage.sql uses for a human skimming query results.
  INSERT INTO public.reconciliation_findings (run_at, finding_type, severity, user_id, details)
  SELECT v_run_at, 'stuck_pending_withdrawal', 'critical', user_id,
    jsonb_build_object('transaction_id', id, 'amount', amount, 'age_seconds', EXTRACT(EPOCH FROM (v_run_at - created_at)))
  FROM public.wallet_transactions
  WHERE type = 'withdrawal' AND status = 'pending' AND created_at < v_run_at - INTERVAL '1 hour';

  -- 2c. Withdrawals with no stripe_transfer_id — the "transfer succeeded but
  -- the history row insert failed" CRITICAL path, or a transfer.created
  -- backfill that never landed.
  INSERT INTO public.reconciliation_findings (run_at, finding_type, severity, user_id, details)
  SELECT v_run_at, 'withdrawal_missing_transfer_id', 'warning', user_id,
    jsonb_build_object('transaction_id', id, 'amount', amount, 'status', status)
  FROM public.wallet_transactions
  WHERE type = 'withdrawal' AND stripe_transfer_id IS NULL
    AND created_at < v_run_at - INTERVAL '10 minutes'; -- allow the transfer.created backfill webhook time to land

  -- 3. Duplicate idempotency keys (should be impossible given
  -- idx_wallet_tx_withdrawal_idempotency — belt-and-suspenders).
  INSERT INTO public.reconciliation_findings (run_at, finding_type, severity, user_id, details)
  SELECT v_run_at, 'duplicate_idempotency_key', 'critical', user_id,
    jsonb_build_object('idempotency_key', idempotency_key, 'transaction_ids', array_agg(id))
  FROM public.wallet_transactions
  WHERE type = 'withdrawal' AND idempotency_key IS NOT NULL
  GROUP BY user_id, idempotency_key
  HAVING COUNT(*) > 1;

  -- More than one pending withdrawal per user (should be impossible given
  -- idx_wallet_tx_one_pending_withdrawal — belt-and-suspenders).
  INSERT INTO public.reconciliation_findings (run_at, finding_type, severity, user_id, details)
  SELECT v_run_at, 'multiple_pending_withdrawals', 'critical', user_id,
    jsonb_build_object('transaction_ids', array_agg(id))
  FROM public.wallet_transactions
  WHERE type = 'withdrawal' AND status = 'pending'
  GROUP BY user_id
  HAVING COUNT(*) > 1;

  -- Reused stripe_transfer_id across more than one withdrawal row.
  INSERT INTO public.reconciliation_findings (run_at, finding_type, severity, user_id, details)
  SELECT v_run_at, 'duplicate_transfer_id', 'critical', NULL,
    jsonb_build_object('stripe_transfer_id', stripe_transfer_id, 'transaction_ids', array_agg(id))
  FROM public.wallet_transactions
  WHERE type = 'withdrawal' AND stripe_transfer_id IS NOT NULL
  GROUP BY stripe_transfer_id
  HAVING COUNT(*) > 1;

  -- 3c. Withdrawal's recorded Connect account no longer matches the user's
  -- current one (e.g. disconnected/reconnected between withdrawals).
  INSERT INTO public.reconciliation_findings (run_at, finding_type, severity, user_id, details)
  SELECT v_run_at, 'connect_account_mismatch', 'info', wt.user_id,
    jsonb_build_object('transaction_id', wt.id, 'tx_account', wt.stripe_connect_account_id, 'current_account', p.stripe_connect_account_id)
  FROM public.wallet_transactions wt
  JOIN public.profiles p ON p.id = wt.user_id
  WHERE wt.type = 'withdrawal'
    AND wt.stripe_connect_account_id IS NOT NULL
    AND wt.stripe_connect_account_id IS DISTINCT FROM p.stripe_connect_account_id;

  SELECT COUNT(*) INTO v_finding_count
  FROM public.reconciliation_findings
  WHERE run_at = v_run_at;

  RETURN v_finding_count;
END;
$$;

COMMENT ON FUNCTION public.run_withdrawal_reconciliation() IS
  'Runs the automatable checks from scripts/reconcile_and_triage.sql and records any findings in reconciliation_findings. Scheduled daily via pg_cron. Read-only against wallet/profile data.';

-- Only service_role may execute (the cron job runs as the database owner,
-- which already has this; this GRANT is defense-in-depth documentation of
-- intent, matching update_balance/withdraw_balance's live grant pattern).
REVOKE ALL ON FUNCTION public.run_withdrawal_reconciliation() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.run_withdrawal_reconciliation() TO service_role;

-- Schedule daily at 09:00 UTC. pg_cron must already be enabled on this
-- project (Supabase enables it via Database > Extensions); this statement
-- is a no-op guard in case it isn't.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'withdrawal-reconciliation-daily';
    PERFORM cron.schedule(
      'withdrawal-reconciliation-daily',
      '0 9 * * *',
      $cron$SELECT public.run_withdrawal_reconciliation();$cron$
    );
  ELSE
    RAISE WARNING 'pg_cron extension is not enabled on this project — run_withdrawal_reconciliation() was created but NOT scheduled. Enable pg_cron (Database > Extensions in the Supabase dashboard) and re-run the cron.schedule(...) call from this migration manually.';
  END IF;
END $$;
