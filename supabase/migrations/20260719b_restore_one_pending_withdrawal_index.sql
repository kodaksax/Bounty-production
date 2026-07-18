-- Migration: Restore the one-pending-withdrawal-per-user guard
-- Created: 2026-07-19
--
-- BACKGROUND: same drift story as 20260719_restore_profiles_balance_floor.sql
-- — supabase/migrations/20260410_harden_withdrawal_flow.sql already defined
-- `idx_wallet_tx_one_pending_withdrawal` but it was never actually applied to
-- production (confirmed absent via pg_indexes on 2026-07-18; the migration's
-- version never appears in supabase_migrations.schema_migrations). This is a
-- new file rather than re-running the old one so its application is
-- trackable on its own version going forward.
--
-- RISK PROFILE: per docs/payments/WITHDRAWAL_SYSTEM_RUNBOOK.md and
-- BOUNTY_WITHDRAWAL_TECHNICAL_SPECIFICATION.md, a wallet_transactions row is
-- essentially never actually left in 'pending' status under the current
-- synchronous-transfer design in supabase/functions/connect/index.ts — rows
-- are inserted directly as 'completed'. This index is defense-in-depth for
-- (a) the one historical regression where 'pending' rows briefly existed,
-- and (b) any future change that reintroduces a genuinely async pending
-- window. A live read-only query immediately before writing this migration
-- confirmed there are currently 0 rows of any status in wallet_transactions
-- with type='withdrawal' AND status='pending' — safe to add.
--
-- IMPORTANT — DO NOT wrap this file in an explicit transaction, and do not
-- apply it via a tool that auto-wraps DDL in one. CREATE INDEX CONCURRENTLY
-- cannot run inside a transaction block; it is used here specifically so
-- index creation does not hold a table-wide lock against concurrent
-- withdrawal writes on wallet_transactions. If this statement is submitted
-- inside a transaction, Postgres will reject it outright (error:
-- "CREATE INDEX CONCURRENTLY cannot run inside a transaction block") rather
-- than silently falling back to a blocking index build — verify the
-- statement is executed standalone before considering this migration
-- applied.

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_wallet_tx_one_pending_withdrawal
  ON public.wallet_transactions (user_id)
  WHERE type = 'withdrawal' AND status = 'pending';

COMMENT ON INDEX idx_wallet_tx_one_pending_withdrawal IS
  'Prevents more than one pending withdrawal per user at any time. Restored '
  '2026-07-19 after being found unapplied on production; see '
  'docs/payments/BOUNTY_WITHDRAWAL_TECHNICAL_SPECIFICATION.md §2.1.';
