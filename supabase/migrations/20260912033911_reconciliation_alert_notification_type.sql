-- =====================================================================
-- Phase 4 — register `reconciliation_alert` as a real notification type.
--
-- WHY THIS MIGRATION EXISTS AT ALL
--
-- The obvious implementation of "alert on a critical finding" is to insert
-- into notifications_outbox with some descriptive data.type and stop. That
-- implementation is silently broken in two independent ways, and neither
-- would raise an error:
--
--   1. public.notifications carries a CHECK constraint enumerating every
--      permitted `type`. An unregistered value fails the constraint, so the
--      in-app half of the alert never lands — while the outbox row still
--      reads 'sent'.
--
--   2. process-notification maps type -> category via a lookup that falls back
--      to 'marketplace' for anything unknown. 'marketplace' is NOT a forced
--      channel, so an admin who has push disabled for marketplace receives
--      nothing; and it is not urgent, so it is suppressed during quiet hours.
--      A payment-integrity page that waits until 8am is not a page.
--
-- So the type is registered here, and mapped to the `security` category in
-- process-notification and lib/config/notification-taxonomy.ts. `security` is
-- the only category whose push and in-app channels cannot be disabled by the
-- user (isForcedChannel) and which always bypasses quiet hours (isUrgent).
-- That is the correct classification on the merits, not a workaround: an
-- unexplained divergence between the ledger and Stripe is an account-integrity
-- event.
-- =====================================================================

ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check CHECK (
    type = ANY (ARRAY[
      'application', 'acceptance', 'completion', 'payment', 'message', 'follow',
      'cancellation_request', 'cancellation_accepted', 'cancellation_rejected',
      'dispute_created', 'dispute_resolved', 'workflow_dispute_created',
      'stale_bounty', 'stale_bounty_cancelled', 'stale_bounty_reposted',
      'update', 'review_needed', 'balance_update', 'bounty_nearby',
      'bounty_expiry', 'dispute_escalated', 'account_warning',
      'account_restricted', 'payout_paid', 'payout_failed', 'payout_canceled',
      'withdrawal_reversed', 'bank_disconnected', 'payout_method_changed',
      'verification_submitted', 'verification_verified', 'verification_rejected',
      'verification_canceled', 'marketing_promo',
      -- New in Phase 4. Operator-facing: only ever addressed to admin accounts.
      'reconciliation_alert',
      -- Daily informational digest of warning/info findings. Non-urgent, non-forced.
      'reconciliation_digest'
    ]::text[])
  );

COMMENT ON CONSTRAINT notifications_type_check ON public.notifications IS
  'Permitted notification types. Adding one here is necessary but NOT sufficient — process-notification and lib/config/notification-taxonomy.ts must both map it to a category, or it silently falls back to marketplace (not force-delivered, quiet-hours suppressed).';
