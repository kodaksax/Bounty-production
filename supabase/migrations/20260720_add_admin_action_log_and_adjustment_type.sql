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
--   2. wallet_transactions.type gains 'admin_adjustment' so a manual balance
--      correction shows up as a real ledger row (not just an opaque
--      profiles.balance change) — this keeps scripts/reconcile_and_triage.sql
--      and the new scheduled reconciliation job's balance-drift check
--      (profiles.balance vs SUM(completed wallet_transactions)) accurate
--      instead of flagging every admin adjustment as unexplained drift.
--
--      ⚠ Live-schema correction made while applying this migration: the
--      migration files (20251001_baseline_schema.sql,
--      20260414_add_stripe_dispute_columns.sql) describe `type` as a plain
--      TEXT column governed by a `wallet_transactions_type_check` CHECK
--      constraint — but the LIVE column is actually a Postgres ENUM
--      (`wallet_tx_type_enum`, confirmed via information_schema/pg_enum),
--      with no such CHECK constraint present. This is the same git/prod
--      drift pattern documented throughout this project's other withdrawal
--      migrations — the DROP/ADD CONSTRAINT approach below (copied from the
--      'dispute_loss' migration's own described approach) does not apply
--      live; `ALTER TYPE ... ADD VALUE` is used instead, guarded so it's
--      also correct if a future environment genuinely has the CHECK-
--      constraint version instead of the enum.

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

-- Widen wallet_transactions.type to accept manual admin adjustments. Live
-- schema uses a Postgres ENUM (wallet_tx_type_enum, confirmed via
-- information_schema/pg_enum against project xwlwqzzphmmhghiqvkeu, PG17) —
-- NOT the CHECK-constraint version described by the migration files.
-- ALTER TYPE ... ADD VALUE must run as a standalone top-level statement (not
-- inside a DO block/PL-pgSQL body, and applied outside apply_migration's
-- transaction wrapper — same constraint class as CREATE INDEX CONCURRENTLY
-- in 20260719b_restore_one_pending_withdrawal_index.sql). Deployed via
-- execute_sql, not apply_migration, for that reason; this statement is
-- captured here for the record and to keep git in sync with what's live.
ALTER TYPE public.wallet_tx_type_enum ADD VALUE IF NOT EXISTS 'admin_adjustment';
