-- Rollback for 20261028120000_admin_financial_state_counts_stripe_holds.sql.
--
-- Restores the wallet-only definition from 20260828130000. CREATE OR REPLACE
-- VIEW cannot drop a column, so the view is dropped and created again. The
-- readers are plpgsql functions, which hold no dependency on the view.
-- The migration wrote no rows.
--
-- Rolling back reopens #957: a bounty with a Stripe hold reads "Unfunded"
-- while admin Cancel is refused for held money.

BEGIN;

DROP VIEW public.admin_bounty_financial_state;

CREATE VIEW public.admin_bounty_financial_state AS
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
    WHEN COALESCE(b.is_for_honor, false) OR COALESCE(b.amount, 0) = 0 THEN 'not_applicable'
    WHEN COALESCE(w.refund_amount, 0) > 0 AND COALESCE(w.release_amount, 0) = 0 THEN 'refunded'
    WHEN COALESCE(w.release_amount, 0) > 0
      AND (COALESCE(e.webhook_events, 0) > 0 OR COALESCE(p.stripe_confirmed, false)) THEN 'released_verified'
    WHEN COALESCE(w.release_amount, 0) > 0 THEN 'released_unverified'
    WHEN COALESCE(w.escrow_amount, 0) > 0 AND b.status::text = 'completed' THEN 'release_pending'
    WHEN COALESCE(w.escrow_amount, 0) > 0 THEN 'escrow_held'
    WHEN b.status::text = 'completed' THEN 'completed_unfunded'
    ELSE 'unfunded'
  END AS financial_status
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
) e ON true;

COMMENT ON VIEW public.admin_bounty_financial_state IS
  'Per-bounty MARKETPLACE status vs FINANCIAL status. stripe_confirmed=false means our ledger asserts the money moved but Stripe has never confirmed it.';

REVOKE ALL ON public.admin_bounty_financial_state FROM PUBLIC;
REVOKE ALL ON public.admin_bounty_financial_state FROM anon;
REVOKE ALL ON public.admin_bounty_financial_state FROM authenticated;

COMMIT;
