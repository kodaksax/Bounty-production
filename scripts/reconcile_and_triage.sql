-- ============================================================================
-- Withdrawal / Wallet Reconciliation & Triage
-- ============================================================================
-- Read-only verification queries for the withdrawal pipeline. Safe to run
-- against production at any time — no INSERT/UPDATE/DELETE statements.
--
-- Schema notes (verified against the live `Bounty-expo` project 2026-07-15):
--   wallet_transactions.status is a Postgres ENUM (wallet_tx_status_enum)
--   with exactly three values: 'pending', 'completed', 'failed'.
--   There is no 'reserved' status in this schema — a withdrawal is inserted
--   directly as 'pending' by /connect/transfer AFTER the balance has already
--   been debited via the withdraw_balance RPC.
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
-- The DB has a CHECK (balance >= 0) constraint (see
-- 20260410_harden_withdrawal_flow.sql), so this should always return zero
-- rows unless the constraint was bypassed (e.g. direct SQL, migration).
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

-- More than one *pending* withdrawal per user (should be impossible given
-- idx_wallet_tx_one_pending_withdrawal).
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
