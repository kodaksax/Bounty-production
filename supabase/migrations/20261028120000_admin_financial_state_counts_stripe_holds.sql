-- admin_bounty_financial_state: count Stripe holds the same way the admin
-- status guard does (issue #957).
--
-- The defect. financial_status read escrow from wallet_transactions only.
-- admin_set_bounty_status() refuses to end or reopen a bounty while
-- fn_bounty_unsettled_escrow_reason() (20261012120100) returns a reason, and
-- that function also counts v2 bounty_payments holds (pending_payment,
-- authorized, captured, ...) and v3 bounty_v3_funding holds. So a v2 or v3
-- bounty with a Stripe hold showed "Unfunded" in the console, and "Cancel"
-- then failed with escrow_unsettled (SQLSTATE 55000).
--
-- The fix. The view calls the guard function, so both read one definition of
-- "money is held":
--   - new column escrow_hold_reason = fn_bounty_unsettled_escrow_reason(id),
--     appended at the end so CREATE OR REPLACE VIEW keeps the old columns;
--   - financial_status is 'release_pending' (completed) or 'escrow_held'
--     (any other status) whenever that reason is not NULL.
--
-- What does NOT change:
--   - The guard itself. It refuses on purpose, so no payment is stranded.
--   - Bounties without a held reason: the CASE below them is the same.
--   - escrow_amount / release_amount / refund_amount stay wallet-ledger sums,
--     so the overview's escrow_held total and the anomaly checks that read
--     them give the same numbers as before.
--   - Privileges: CREATE OR REPLACE keeps them (no anon/authenticated). The
--     view owner owns fn_bounty_unsettled_escrow_reason, so the SECURITY
--     DEFINER admin readers can call it through the view.
--
-- Rollback: supabase/rollbacks/production/20261028120000_admin_financial_state_counts_stripe_holds.down.sql

BEGIN;

CREATE OR REPLACE VIEW public.admin_bounty_financial_state AS
SELECT
  b.id                                         AS bounty_id,
  b.status::text                               AS marketplace_status,
  COALESCE(b.poster_id, b.user_id)             AS poster_id,
  b.accepted_by                                AS hunter_id,
  b.amount,
  COALESCE(b.is_for_honor, false)              AS is_for_honor,
  b.created_at,
  b.completed_at,
  COALESCE(w.escrow_amount, 0)                 AS escrow_amount,
  COALESCE(w.release_amount, 0)                AS release_amount,
  COALESCE(w.refund_amount, 0)                 AS refund_amount,
  COALESCE(w.pending_count, 0)                 AS pending_ledger_count,
  COALESCE(p.payment_records, 0)               AS payment_records,
  COALESCE(p.stripe_confirmed, false)          AS payment_record_confirmed,
  COALESCE(e.webhook_events, 0)                AS webhook_events,
  (COALESCE(e.webhook_events, 0) > 0 OR COALESCE(p.stripe_confirmed, false)) AS stripe_confirmed,
  CASE
    -- First, so the badge never says "Unfunded" or "Refunded" while
    -- admin_set_bounty_status() would refuse the change for held money.
    WHEN h.reason IS NOT NULL AND b.status::text = 'completed' THEN 'release_pending'
    WHEN h.reason IS NOT NULL THEN 'escrow_held'
    WHEN COALESCE(b.is_for_honor, false) OR COALESCE(b.amount, 0) = 0 THEN 'not_applicable'
    WHEN COALESCE(w.refund_amount, 0) > 0 AND COALESCE(w.release_amount, 0) = 0 THEN 'refunded'
    WHEN COALESCE(w.release_amount, 0) > 0
      AND (COALESCE(e.webhook_events, 0) > 0 OR COALESCE(p.stripe_confirmed, false)) THEN 'released_verified'
    WHEN COALESCE(w.release_amount, 0) > 0 THEN 'released_unverified'
    WHEN COALESCE(w.escrow_amount, 0) > 0 AND b.status::text = 'completed' THEN 'release_pending'
    WHEN COALESCE(w.escrow_amount, 0) > 0 THEN 'escrow_held'
    WHEN b.status::text = 'completed' THEN 'completed_unfunded'
    ELSE 'unfunded'
  END AS financial_status,
  h.reason                                     AS escrow_hold_reason
FROM public.bounties b
LEFT JOIN LATERAL (
  SELECT
    SUM(ABS(wt.amount)) FILTER (WHERE wt.type::text = 'escrow'  AND wt.status::text = 'completed') AS escrow_amount,
    SUM(ABS(wt.amount)) FILTER (WHERE wt.type::text = 'release' AND wt.status::text = 'completed') AS release_amount,
    SUM(ABS(wt.amount)) FILTER (WHERE wt.type::text = 'refund'  AND wt.status::text = 'completed') AS refund_amount,
    COUNT(*)            FILTER (WHERE wt.status::text = 'pending')                                 AS pending_count
  FROM public.wallet_transactions wt
  WHERE wt.bounty_id = b.id
) w ON true
LEFT JOIN LATERAL (
  SELECT
    COUNT(*) AS payment_records,
    BOOL_OR(bp.stripe_charge_id IS NOT NULL OR bp.stripe_transfer_id IS NOT NULL) AS stripe_confirmed
  FROM public.bounty_payments bp
  WHERE bp.bounty_id = b.id
) p ON true
LEFT JOIN LATERAL (
  SELECT COUNT(*) AS webhook_events
  FROM public.bounty_events be
  WHERE be.bounty_id = b.id
    AND be.source = 'webhook'
    AND be.event_type IN (
      'stripe.payment_intent.succeeded', 'stripe.charge.succeeded', 'stripe.charge.captured',
      'stripe.transfer.created', 'stripe.transfer.paid', 'stripe.payout.paid',
      'stripe.checkout.session.completed', 'stripe.checkout.session.async_payment_succeeded'
    )
) e ON true
CROSS JOIN LATERAL (
  SELECT public.fn_bounty_unsettled_escrow_reason(b.id) AS reason
) h;

COMMENT ON VIEW public.admin_bounty_financial_state IS
  'Per-bounty MARKETPLACE status vs FINANCIAL status. stripe_confirmed=false means our ledger asserts the money moved but Stripe has never confirmed it. escrow_hold_reason is fn_bounty_unsettled_escrow_reason(): when it is set, admin_set_bounty_status() refuses to end or reopen the bounty.';

REVOKE ALL ON public.admin_bounty_financial_state FROM PUBLIC;
REVOKE ALL ON public.admin_bounty_financial_state FROM anon;
REVOKE ALL ON public.admin_bounty_financial_state FROM authenticated;

COMMIT;
