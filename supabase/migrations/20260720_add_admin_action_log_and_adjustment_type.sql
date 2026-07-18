-- Migration: Admin withdrawal-recovery audit log + admin_adjustment ledger type
-- Created: 2026-07-20
-- Purpose:
--   Supports the new `admin-withdrawals` Edge Function (force-retry a
--   permanently_failed withdrawal beyond the 3-attempt client cap, or apply a
--   manual balance credit/debit for CRITICAL/orphaned-reconciliation cases).
--   Previously there was no admin/support-side tool for this at all — every
--   "manual reconciliation required" path resolved to a human running SQL
--   directly against production (see docs/payments/BOUNTY_WITHDRAWAL_TECHNICAL_
--   SPECIFICATION.md §4.8 item 5, §9.4).
--
--   1. `admin_action_log` — audit trail for every admin-initiated recovery
--      action. RLS is enabled with NO policies at all: service_role bypasses
--      RLS by default (BYPASSRLS), so the edge function (which always
--      connects as service_role) can read/write freely, while anon/
--      authenticated clients are locked out entirely — there is no legitimate
--      reason for a direct client read or write here, unlike dispute_audit_log
--      (which has legitimate client-side inserts and needed a trigger-based
--      actor-override instead). Support staff read this log through the admin
--      tool's own `list_log` action, not a direct table query, keeping this
--      table out of the same anon-key-admin-panel pattern already flagged as
--      risky elsewhere (profiles SELECT RLS).
--
--   2. `wallet_transactions_type_check` gains `admin_adjustment` so a manual
--      balance correction shows up as a real ledger row (not just an opaque
--      profiles.balance change) — this keeps scripts/reconcile_and_triage.sql
--      and the new scheduled reconciliation job's balance-drift check
--      (profiles.balance vs SUM(completed wallet_transactions)) accurate
--      instead of flagging every admin adjustment as unexplained drift.
--      Mirrors the exact pattern used to add 'dispute_loss' in
--      20260414_add_stripe_dispute_columns.sql.

CREATE TABLE IF NOT EXISTS public.admin_action_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id UUID NOT NULL,
  action_type TEXT NOT NULL CHECK (action_type IN ('force_retry_withdrawal', 'manual_balance_adjustment')),
  target_user_id UUID NOT NULL,
  target_transaction_id UUID,
  amount NUMERIC(12, 2),
  reason TEXT NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('success', 'failure')),
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_action_log_target_user ON public.admin_action_log (target_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_action_log_admin_user ON public.admin_action_log (admin_user_id, created_at DESC);

ALTER TABLE public.admin_action_log ENABLE ROW LEVEL SECURITY;
-- Deliberately no policies: locks out anon/authenticated entirely.
-- service_role bypasses RLS (BYPASSRLS) and is the only writer/reader.

COMMENT ON TABLE public.admin_action_log IS
  'Audit trail for admin-initiated withdrawal recovery actions (force-retry, manual balance adjustment), written exclusively by the admin-withdrawals Edge Function via service_role.';

-- Widen wallet_transactions.type to accept manual admin adjustments, same
-- DROP+ADD pattern used to add 'dispute_loss'.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'wallet_transactions_type_check'
  ) THEN
    ALTER TABLE public.wallet_transactions DROP CONSTRAINT wallet_transactions_type_check;
  END IF;
END $$;

ALTER TABLE public.wallet_transactions
  ADD CONSTRAINT wallet_transactions_type_check
  CHECK (type IN ('escrow', 'release', 'refund', 'deposit', 'withdrawal', 'dispute_loss', 'admin_adjustment'));
