-- Migration: Restore the non-negative balance floor on profiles.balance
-- Created: 2026-07-19
--
-- BACKGROUND: supabase/migrations/20260410_harden_withdrawal_flow.sql already
-- attempted this exact change, but a live-schema audit on 2026-07-18 found
-- `check_balance_non_negative` does not exist on production and that
-- migration's version never appears in supabase_migrations.schema_migrations.
-- Root cause: this project's migrations are not deployed via a `supabase db
-- push` pass over supabase/migrations/ in order — individual migrations are
-- applied ad hoc (via the Supabase MCP `apply_migration`/`execute_sql` tools
-- during working sessions), each recording its own synthetic timestamp
-- version disconnected from the git filename. A migration file being
-- committed to git has never guaranteed it was actually run against
-- production on this project. This is a new file (rather than re-running the
-- 2026-04-10 one) so its application is trackable going forward on its own
-- version, and so this file's safety checks reflect the schema as it
-- actually stands today rather than assumptions from 2026-04-10.
--
-- SAFETY: verified via a live read-only query against production
-- (xwlwqzzphmmhghiqvkeu) immediately before writing this migration:
--   SELECT count(*) FROM public.profiles WHERE balance < 0;   -- returned 0
-- The DO block below re-verifies this at migration time and raises a clear,
-- actionable error instead of a generic constraint-violation message if that
-- has changed by the time this runs. Uses NOT VALID + a separate
-- VALIDATE CONSTRAINT step (rather than a single ADD CONSTRAINT) so that:
--   1. New/updated rows are protected immediately (NOT VALID still enforces
--      the check for all writes after this point; it only skips checking
--      pre-existing rows at creation time).
--   2. The full-table validation scan runs under a much lighter
--      SHARE UPDATE EXCLUSIVE lock instead of blocking concurrent writes for
--      the whole table scan.
-- Given the explicit pre-check below, VALIDATE CONSTRAINT is expected to
-- succeed immediately in the same statement — the two-step form is kept as
-- defense in depth in case of a race between the pre-check and the ALTER.

DO $$
DECLARE
  v_negative_count BIGINT;
BEGIN
  SELECT count(*) INTO v_negative_count FROM public.profiles WHERE balance < 0;
  IF v_negative_count > 0 THEN
    RAISE EXCEPTION
      'Refusing to add check_balance_non_negative: % profiles currently have a negative balance. '
      'These must be investigated and corrected (a human money decision, not an automated one) '
      'before this constraint can be added. See scripts/reconcile_and_triage.sql.',
      v_negative_count;
  END IF;
END;
$$;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS check_balance_non_negative;

ALTER TABLE public.profiles
  ADD CONSTRAINT check_balance_non_negative CHECK (balance >= 0) NOT VALID;

ALTER TABLE public.profiles
  VALIDATE CONSTRAINT check_balance_non_negative;

COMMENT ON CONSTRAINT check_balance_non_negative ON public.profiles IS
  'Database-level floor on profiles.balance. Previously enforced only at the '
  'application layer (withdraw_balance()/update_balance() RPCs) — this closes '
  'the gap where a future code path that writes profiles.balance directly '
  '(bypassing those RPCs) could otherwise drive it negative undetected. '
  'Restored 2026-07-19 after being found unapplied on production; see '
  'docs/payments/BOUNTY_WITHDRAWAL_TECHNICAL_SPECIFICATION.md §2.1.';
