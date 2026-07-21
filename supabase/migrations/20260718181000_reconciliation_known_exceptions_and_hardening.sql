-- Migration: reconciliation_known_exceptions table + harden run_withdrawal_reconciliation()
-- Created: 2026-07-18
--
-- BACKGROUND: the first live run of run_withdrawal_reconciliation() (added
-- 2026-07-18) surfaced 5 findings. Investigating them end to end found two
-- real bugs in the reconciliation job itself, plus a need for a durable way
-- to record "this is a known, deliberately-accepted state, don't flag it
-- again" for cases where the drift is not a bug (e.g. a documented balance
-- write-off) rather than trying to hard-code a special case into the SQL.
--
-- BUG 1 (withdrawal_missing_transfer_id false positive): the check flagged
-- ANY withdrawal missing a stripe_transfer_id, including 'failed' rows —
-- but a withdrawal that failed before Stripe ever created a Transfer object
-- (e.g. a pre-flight Stripe error) legitimately has no transfer id. Verified
-- live: user deon1111's flagged $32.65 'failed' row was exactly this case,
-- followed by a normal successful retry — no real issue. Only a 'completed'
-- withdrawal missing a transfer id is actually anomalous.
--
-- BUG 2 (balance_drift ledger math excludes in-flight/manually-resolved
-- debits): ledger_balance summed only status='completed' transactions. A
-- withdrawal stuck in 'pending' (the jordenhoward2 incident) or newly
-- resolved as 'manually_paid' represents a real, final debit that should
-- count toward the reconstructed ledger balance even though its status
-- isn't 'completed'. Without this, a manually-settled withdrawal would be
-- flagged as permanent balance_drift forever.
--
-- reconciliation_known_exceptions: for drift that is real (by the naive
-- ledger math) but intentional and already decided — e.g. the Wallet Phase 2
-- write-offs described in docs/payments/WITHDRAWAL_SYSTEM_RUNBOOK.md §11.1,
-- which by design leave no offsetting ledger row — there is no SQL fix that
-- can distinguish "bug" from "deliberate write-off" automatically. This table
-- is an explicit, audited allowlist of (finding_type, user_id) pairs a human
-- has reviewed and decided are not actionable, so the daily job stops
-- re-surfacing them without silently special-casing specific user IDs in
-- application logic.
--
-- Also adds basic dedup: each check now skips inserting a finding if an
-- unacknowledged finding with the same natural key already exists, so the
-- daily job doesn't pile up N duplicate rows for the same unresolved issue
-- before a human gets to it.

CREATE TABLE IF NOT EXISTS public.reconciliation_known_exceptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  finding_type TEXT NOT NULL,
  user_id UUID REFERENCES public.profiles(id),
  reason TEXT NOT NULL,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.reconciliation_known_exceptions ENABLE ROW LEVEL SECURITY;
-- Zero policies deliberately: service_role (used exclusively by the
-- run_withdrawal_reconciliation() SECURITY DEFINER function and admin
-- tooling) bypasses RLS; no legitimate client-side use case, same pattern as
-- admin_action_log and reconciliation_findings.

COMMENT ON TABLE public.reconciliation_known_exceptions IS
  'Audited allowlist of (finding_type, user_id) pairs a human has reviewed and decided are not actionable (e.g. an intentional balance write-off), so run_withdrawal_reconciliation() stops re-flagging them daily.';

CREATE OR REPLACE FUNCTION public.run_withdrawal_reconciliation()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_finding_count INTEGER := 0;
  v_run_at TIMESTAMPTZ := now();
BEGIN
  -- balance_drift: ledger reconstruction now includes 'manually_paid' rows
  -- (a real, final debit outside the normal completed-transfer path), and
  -- skips users with a recorded known exception for this finding type.
  INSERT INTO public.reconciliation_findings (run_at, finding_type, severity, user_id, details)
  SELECT
    v_run_at,
    'balance_drift',
    'critical',
    p.id,
    jsonb_build_object(
      'cached_balance', p.balance,
      'ledger_balance', COALESCE(SUM(wt.amount) FILTER (WHERE wt.status IN ('completed', 'manually_paid')), 0),
      'drift', p.balance - COALESCE(SUM(wt.amount) FILTER (WHERE wt.status IN ('completed', 'manually_paid')), 0)
    )
  FROM public.profiles p
  LEFT JOIN public.wallet_transactions wt ON wt.user_id = p.id
  WHERE NOT EXISTS (
    SELECT 1 FROM public.reconciliation_known_exceptions e
    WHERE e.finding_type = 'balance_drift' AND e.user_id = p.id
  )
  GROUP BY p.id, p.balance
  HAVING p.balance <> COALESCE(SUM(wt.amount) FILTER (WHERE wt.status IN ('completed', 'manually_paid')), 0)
    AND NOT EXISTS (
      SELECT 1 FROM public.reconciliation_findings f
      WHERE f.finding_type = 'balance_drift' AND f.user_id = p.id AND f.acknowledged_at IS NULL
    );
  GET DIAGNOSTICS v_finding_count = ROW_COUNT;

  INSERT INTO public.reconciliation_findings (run_at, finding_type, severity, user_id, details)
  SELECT v_run_at, 'negative_or_inconsistent_balance', 'critical', id,
    jsonb_build_object('balance', balance, 'balance_on_hold', balance_on_hold)
  FROM public.profiles p
  WHERE (balance < 0 OR balance_on_hold < 0 OR balance_on_hold > balance)
    AND NOT EXISTS (
      SELECT 1 FROM public.reconciliation_findings f
      WHERE f.finding_type = 'negative_or_inconsistent_balance' AND f.user_id = p.id AND f.acknowledged_at IS NULL
    );

  INSERT INTO public.reconciliation_findings (run_at, finding_type, severity, user_id, details)
  SELECT v_run_at, 'orphaned_transaction', 'warning', wt.user_id,
    jsonb_build_object('transaction_id', wt.id, 'type', wt.type, 'amount', wt.amount, 'status', wt.status)
  FROM public.wallet_transactions wt
  LEFT JOIN public.profiles p ON p.id = wt.user_id
  WHERE wt.user_id IS NOT NULL AND p.id IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.reconciliation_findings f
      WHERE f.finding_type = 'orphaned_transaction' AND (f.details->>'transaction_id') = wt.id::text AND f.acknowledged_at IS NULL
    );

  -- stuck_pending_withdrawal naturally excludes 'manually_paid' rows since it
  -- filters status = 'pending'.
  INSERT INTO public.reconciliation_findings (run_at, finding_type, severity, user_id, details)
  SELECT v_run_at, 'stuck_pending_withdrawal', 'critical', wt.user_id,
    jsonb_build_object('transaction_id', wt.id, 'amount', wt.amount, 'age_seconds', EXTRACT(EPOCH FROM (v_run_at - wt.created_at)))
  FROM public.wallet_transactions wt
  WHERE wt.type = 'withdrawal' AND wt.status = 'pending' AND wt.created_at < v_run_at - INTERVAL '1 hour'
    AND NOT EXISTS (
      SELECT 1 FROM public.reconciliation_findings f
      WHERE f.finding_type = 'stuck_pending_withdrawal' AND (f.details->>'transaction_id') = wt.id::text AND f.acknowledged_at IS NULL
    );

  -- withdrawal_missing_transfer_id: only 'completed' withdrawals are actually
  -- anomalous without a transfer id. A 'failed' withdrawal legitimately can
  -- lack one if it failed before Stripe ever created the Transfer object.
  INSERT INTO public.reconciliation_findings (run_at, finding_type, severity, user_id, details)
  SELECT v_run_at, 'withdrawal_missing_transfer_id', 'warning', wt.user_id,
    jsonb_build_object('transaction_id', wt.id, 'amount', wt.amount, 'status', wt.status)
  FROM public.wallet_transactions wt
  WHERE wt.type = 'withdrawal' AND wt.status = 'completed' AND wt.stripe_transfer_id IS NULL
    AND wt.created_at < v_run_at - INTERVAL '10 minutes'
    AND NOT EXISTS (
      SELECT 1 FROM public.reconciliation_findings f
      WHERE f.finding_type = 'withdrawal_missing_transfer_id' AND (f.details->>'transaction_id') = wt.id::text AND f.acknowledged_at IS NULL
    );

  INSERT INTO public.reconciliation_findings (run_at, finding_type, severity, user_id, details)
  SELECT v_run_at, 'duplicate_idempotency_key', 'critical', user_id,
    jsonb_build_object('idempotency_key', idempotency_key, 'transaction_ids', array_agg(id))
  FROM public.wallet_transactions wt
  WHERE type = 'withdrawal' AND idempotency_key IS NOT NULL
  GROUP BY user_id, idempotency_key
  HAVING COUNT(*) > 1
    AND NOT EXISTS (
      SELECT 1 FROM public.reconciliation_findings f
      WHERE f.finding_type = 'duplicate_idempotency_key' AND (f.details->>'idempotency_key') = wt.idempotency_key AND f.acknowledged_at IS NULL
    );

  INSERT INTO public.reconciliation_findings (run_at, finding_type, severity, user_id, details)
  SELECT v_run_at, 'multiple_pending_withdrawals', 'critical', user_id,
    jsonb_build_object('transaction_ids', array_agg(id))
  FROM public.wallet_transactions wt
  WHERE type = 'withdrawal' AND status = 'pending'
  GROUP BY user_id
  HAVING COUNT(*) > 1
    AND NOT EXISTS (
      SELECT 1 FROM public.reconciliation_findings f
      WHERE f.finding_type = 'multiple_pending_withdrawals' AND f.user_id = wt.user_id AND f.acknowledged_at IS NULL
    );

  INSERT INTO public.reconciliation_findings (run_at, finding_type, severity, user_id, details)
  SELECT v_run_at, 'duplicate_transfer_id', 'critical', NULL,
    jsonb_build_object('stripe_transfer_id', stripe_transfer_id, 'transaction_ids', array_agg(id))
  FROM public.wallet_transactions wt
  WHERE type = 'withdrawal' AND stripe_transfer_id IS NOT NULL
  GROUP BY stripe_transfer_id
  HAVING COUNT(*) > 1
    AND NOT EXISTS (
      SELECT 1 FROM public.reconciliation_findings f
      WHERE f.finding_type = 'duplicate_transfer_id' AND (f.details->>'stripe_transfer_id') = wt.stripe_transfer_id AND f.acknowledged_at IS NULL
    );

  INSERT INTO public.reconciliation_findings (run_at, finding_type, severity, user_id, details)
  SELECT v_run_at, 'connect_account_mismatch', 'info', wt.user_id,
    jsonb_build_object('transaction_id', wt.id, 'tx_account', wt.stripe_connect_account_id, 'current_account', p.stripe_connect_account_id)
  FROM public.wallet_transactions wt
  JOIN public.profiles p ON p.id = wt.user_id
  WHERE wt.type = 'withdrawal'
    AND wt.stripe_connect_account_id IS NOT NULL
    AND wt.stripe_connect_account_id IS DISTINCT FROM p.stripe_connect_account_id
    AND NOT EXISTS (
      SELECT 1 FROM public.reconciliation_findings f
      WHERE f.finding_type = 'connect_account_mismatch' AND (f.details->>'transaction_id') = wt.id::text AND f.acknowledged_at IS NULL
    );

  SELECT COUNT(*) INTO v_finding_count
  FROM public.reconciliation_findings
  WHERE run_at = v_run_at;

  RETURN v_finding_count;
END;
$function$;
