-- ============================================================================
-- Withdrawal / Wallet Reconciliation & Triage
-- ============================================================================
-- Read-only verification queries for the withdrawal pipeline. Safe to run
-- against production at any time — no INSERT/UPDATE/DELETE statements.
--
-- Schema notes (verified against the live `Bounty-expo` project 2026-07-15,
-- re-verified 2026-07-18/19):
--   wallet_transactions.status is a Postgres ENUM (wallet_tx_status_enum)
--   with exactly three values: 'pending', 'completed', 'failed'.
--   There is no 'reserved' status in this schema — a withdrawal is inserted
--   directly as 'completed' by /connect/transfer (the platform->connected-
--   account Transfer leg is synchronous; see
--   docs/payments/BOUNTY_WITHDRAWAL_TECHNICAL_SPECIFICATION.md §1.2).
--
-- IMPORTANT: as of 2026-07-18, a live-schema audit found that
-- `check_balance_non_negative` and `idx_wallet_tx_one_pending_withdrawal`
-- (both referenced below) did NOT exist on production, despite a 2026-04-10
-- migration file claiming to add them — that migration was committed to git
-- but never actually applied (this project's migrations are deployed ad hoc,
-- not via a `supabase db push` pass over the migrations folder — see
-- supabase/migrations/20260719_restore_profiles_balance_floor.sql and
-- 20260719b_restore_one_pending_withdrawal_index.sql, which restore them).
-- The queries below that say "should be impossible given X" are only true
-- once those two migrations have actually been applied — do not assume they
-- have been without checking (`\d profiles`, `\di wallet_transactions`).
-- ============================================================================


-- ── Section 1: Balance drift ────────────────────────────────────────────────
-- Compares the cached profiles.balance against the balance derived from the
-- authoritative ledger (SUM of completed wallet_transactions). Any row here
-- indicates the cache and the ledger have diverged.
SELECT
  p.id AS user_id,
  p.balance AS cached_balance,
  COALESCE(SUM(wt.amount) FILTER (WHERE wt.status = 'completed'), 0) AS ledger_balance,
  p.balance - COALESCE(SUM(wt.amount) FILTER (WHERE wt.status = 'completed'), 0) AS drift
FROM public.profiles p
LEFT JOIN public.wallet_transactions wt ON wt.user_id = p.id
GROUP BY p.id, p.balance
HAVING p.balance <> COALESCE(SUM(wt.amount) FILTER (WHERE wt.status = 'completed'), 0)
ORDER BY ABS(p.balance - COALESCE(SUM(wt.amount) FILTER (WHERE wt.status = 'completed'), 0)) DESC;


-- ── Section 1b: Negative wallet balances ────────────────────────────────────
-- Once 20260719_restore_profiles_balance_floor.sql has been applied, the DB
-- itself enforces CHECK (balance >= 0), so this should return zero rows
-- unless the constraint was bypassed (e.g. direct SQL, migration, or the
-- migration hasn't actually been applied yet — see the header note above).
SELECT id AS user_id, balance, balance_on_hold
FROM public.profiles
WHERE balance < 0 OR balance_on_hold < 0 OR balance_on_hold > balance;


-- ── Section 2: Orphaned transactions ────────────────────────────────────────
-- wallet_transactions rows whose user_id does not resolve to a profile.
SELECT wt.id, wt.user_id, wt.type, wt.amount, wt.status, wt.created_at
FROM public.wallet_transactions wt
LEFT JOIN public.profiles p ON p.id = wt.user_id
WHERE wt.user_id IS NOT NULL AND p.id IS NULL;


-- ── Section 2b: Stuck pending withdrawals ───────────────────────────────────
-- Withdrawals that have sat in 'pending' for longer than a normal Stripe
-- transfer + payout cycle should take (transfer is synchronous; payout to
-- bank is typically 1-2 business days). Flags anything pending > 3 days.
SELECT id, user_id, amount, status, stripe_transfer_id, idempotency_key,
       created_at, NOW() - created_at AS age
FROM public.wallet_transactions
WHERE type = 'withdrawal'
  AND status = 'pending'
  AND created_at < NOW() - INTERVAL '3 days'
ORDER BY created_at ASC;


-- ── Section 2c: Pending withdrawals with no Stripe transfer id ─────────────
-- A withdrawal row is only ever inserted (in /connect/transfer) AFTER the
-- Stripe transfer already succeeded, so stripe_transfer_id should never be
-- null. A null value here means the CRITICAL "transfer succeeded but
-- transaction record failed" path in connect/index.ts was hit, or the
-- transfer.created backfill (webhooks/index.ts) hasn't landed yet.
SELECT id, user_id, amount, status, created_at
FROM public.wallet_transactions
WHERE type = 'withdrawal'
  AND stripe_transfer_id IS NULL
ORDER BY created_at DESC;


-- ── Section 2d: Payout outcomes by type (failed vs. canceled) ───────────────
-- Visibility into supabase/functions/webhooks/index.ts's handleUndeliveredPayout(),
-- added 2026-07-19 to also handle `payout.canceled` (previously unhandled —
-- a canceled payout was silently dropped with no refund, no notification,
-- and no way to distinguish it from a normal in-flight payout). Both
-- outcomes should always show a refunded ('failed' ledger status) row with
-- metadata.payout_status matching one of these two values — a 'completed'
-- withdrawal whose Stripe payout is independently known to have failed or
-- been canceled (checked in the Stripe Dashboard) but has no matching row
-- here means the webhook never arrived or found no candidate transaction —
-- see the Section 3b Stripe cross-check below.
SELECT id, user_id, amount, status,
       metadata->>'payout_status' AS payout_status,
       metadata->>'payout_failure_code' AS payout_failure_code,
       metadata->>'payout_id' AS payout_id,
       created_at
FROM public.wallet_transactions
WHERE type = 'withdrawal'
  AND metadata->>'payout_status' IN ('failed', 'canceled')
ORDER BY created_at DESC
LIMIT 50;


-- ── Section 2e: Withdrawals with no recorded destination bank account ──────
-- supabase/functions/connect/index.ts now records metadata.destination_bank_
-- account_id on every new withdrawal/retry (2026-07-19 fix for the bank-
-- account-selection-not-wired bug). Rows created before that fix will
-- legitimately have no value here — this is expected for old rows, not a
-- bug — but if a *new* row (created_at after the fix was deployed) is
-- missing it, that indicates a regression in the destination-resolution
-- code path.
SELECT id, user_id, amount, status, created_at,
       metadata->>'destination_bank_account_id' AS destination_bank_account_id
FROM public.wallet_transactions
WHERE type = 'withdrawal'
  AND metadata->>'destination_bank_account_id' IS NULL
ORDER BY created_at DESC
LIMIT 50;


-- ── Section 3: Withdrawals reconcile with wallet ledger ─────────────────────
-- Duplicate ledger entries for the same idempotency key (should be
-- impossible given idx_wallet_tx_withdrawal_idempotency, included as a
-- belt-and-suspenders check).
SELECT user_id, idempotency_key, COUNT(*) AS row_count,
       array_agg(id) AS transaction_ids, array_agg(stripe_transfer_id) AS transfer_ids
FROM public.wallet_transactions
WHERE type = 'withdrawal' AND idempotency_key IS NOT NULL
GROUP BY user_id, idempotency_key
HAVING COUNT(*) > 1;

-- More than one *pending* withdrawal per user (should be impossible once
-- idx_wallet_tx_one_pending_withdrawal has been applied — see header note).
SELECT user_id, COUNT(*) AS pending_count, array_agg(id) AS transaction_ids
FROM public.wallet_transactions
WHERE type = 'withdrawal' AND status = 'pending'
GROUP BY user_id
HAVING COUNT(*) > 1;

-- Distinct stripe_transfer_id values reused across more than one withdrawal
-- row (would indicate the same Stripe Transfer got attributed to two ledger
-- entries).
SELECT stripe_transfer_id, COUNT(*) AS row_count, array_agg(id) AS transaction_ids
FROM public.wallet_transactions
WHERE type = 'withdrawal' AND stripe_transfer_id IS NOT NULL
GROUP BY stripe_transfer_id
HAVING COUNT(*) > 1;


-- ── Section 3b: Withdrawals reconcile with Stripe transfers ────────────────
-- This script cannot call the Stripe API directly (Postgres has no network
-- egress here). Cross-check the stripe_transfer_id / stripe_connect_account_id
-- values below against Stripe Dashboard -> Connect -> Transfers, or via the
-- Stripe API/MCP `GetTransfers` for each id.
SELECT id AS transaction_id, user_id, amount, status, stripe_transfer_id,
       stripe_connect_account_id, created_at, updated_at
FROM public.wallet_transactions
WHERE type = 'withdrawal'
ORDER BY created_at DESC
LIMIT 50;


-- ── Section 3c: Withdrawals whose Connect account no longer matches profile ─
-- Flags a withdrawal that was sent to a Connect account ID that differs from
-- the user's *current* stripe_connect_account_id (e.g. the hunter
-- disconnected/reconnected their bank between withdrawals).
SELECT wt.id AS transaction_id, wt.user_id, wt.stripe_connect_account_id AS tx_account,
       p.stripe_connect_account_id AS current_account, wt.created_at
FROM public.wallet_transactions wt
JOIN public.profiles p ON p.id = wt.user_id
WHERE wt.type = 'withdrawal'
  AND wt.stripe_connect_account_id IS NOT NULL
  AND wt.stripe_connect_account_id IS DISTINCT FROM p.stripe_connect_account_id;
