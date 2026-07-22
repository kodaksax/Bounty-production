-- Migration: fix Stripe balance reconciliation noise
-- Created: 2026-07-22
-- Purpose: two false-signal problems found while auditing the new hourly
--   stripe-balance-reconciliation-hourly sweep (docs/withdrawals/15-stripe-
--   balance-sync.md), both confirmed live against production data before
--   this fix:
--
--   1. get_platform_ledger_balance_cents() only summed profiles.balance.
--      Money captured into escrow for a bounty that hasn't been released or
--      refunded yet (and any platform fee permanently retained on a
--      completed release) legitimately sits in Stripe's platform balance
--      without ever being reflected in any single profile's balance. Without
--      this term, comparePlatformBalance() reports a permanent false
--      "surplus" warning every single hour for as long as any bounty is
--      open — confirmed live: $245.85 of the $393.31 hourly-repeating
--      warning was exactly this (34 bounties with still-open escrow,
--      verified individually, zero showing a positive/over-released
--      residual). The remaining gap after this fix is real and left for
--      manual investigation (see the audit writeup), not silently closed.
--
--   2. Neither comparePlatformBalance() nor compareConnectAccountBalance()
--      deduplicated against an already-open finding of the same type,
--      unlike every check in the older run_withdrawal_reconciliation()
--      (which always has a `NOT EXISTS ... WHERE acknowledged_at IS NULL`
--      guard). Result: the exact same unresolved condition re-inserted a new
--      reconciliation_findings row every hour forever — confirmed live: 30
--      of 31 unacknowledged findings at audit time were hourly repeats of
--      the same ~5 underlying conditions, not 31 distinct issues. This
--      migration only fixes the ledger formula (SQL); the dedup fix is in
--      the two Edge Function copies (webhooks/index.ts,
--      admin-withdrawals/index.ts), deployed alongside this migration.
--      stripe_balance_snapshots (unaffected) already carries the per-hour
--      trend history, so no observability is lost by no longer duplicating
--      the finding row itself.

CREATE OR REPLACE FUNCTION public.get_platform_ledger_balance_cents()
RETURNS BIGINT
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    COALESCE(ROUND((SELECT SUM(balance) FROM public.profiles) * 100), 0)::bigint
    +
    COALESCE((
      SELECT ROUND(SUM(-held.residual) * 100)::bigint
      FROM (
        SELECT SUM(amount) AS residual
        FROM public.wallet_transactions
        WHERE type IN ('escrow', 'release', 'refund') AND status = 'completed'
        GROUP BY bounty_id
        HAVING SUM(amount) < 0
      ) held
    ), 0);
$$;

COMMENT ON FUNCTION public.get_platform_ledger_balance_cents() IS
  'Sum of every profiles.balance, plus money still held in escrow for bounties not yet fully released/refunded (including any platform fee permanently retained on a completed release) -- both sit in Stripe''s platform balance without being reflected in any single profile''s balance. The platform Stripe account''s available+pending balance should never fall below this. Used by comparePlatformBalance() in webhooks/admin-withdrawals. Read-only. Per-bounty residuals are expected to always be <= 0 (money still held); a positive residual would mean a bounty was over-released/over-refunded and is deliberately excluded from this total rather than silently netted against it -- that case belongs in a distinct integrity finding, not folded into the platform-balance formula.';
