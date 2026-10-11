-- Allow the notification types the release paths already send.
--
-- web-account/approve-release and bounty-payments (v3 hold) notify a hunter
-- with type 'payout_setup_required', and v3 notifies the poster with
-- 'release_waiting_on_hunter'. Neither was in notifications_type_check, so
-- process-notification's in-app insert failed with 23514 and only the email
-- went out (seen 2026-10-11 01:09:30 on bounty 59879908).
--
-- 'bounty_location_nudge' is in the client's NotificationType and taxonomy
-- but was missing here for the same reason.
--
-- Superset of the live constraint (pg_get_constraintdef, 2026-10-11): every
-- existing row still passes. Do not apply with `supabase db push`.

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK (type = ANY (ARRAY[
  'application', 'acceptance', 'completion', 'payment', 'message', 'follow',
  'cancellation_request', 'cancellation_accepted', 'cancellation_rejected',
  'dispute_created', 'dispute_resolved', 'workflow_dispute_created',
  'stale_bounty', 'stale_bounty_cancelled', 'stale_bounty_reposted',
  'update', 'review_needed', 'balance_update', 'bounty_nearby', 'bounty_expiry',
  'dispute_escalated', 'account_warning', 'account_restricted',
  'payout_paid', 'payout_failed', 'payout_canceled', 'withdrawal_reversed',
  'bank_disconnected', 'payout_method_changed',
  'verification_submitted', 'verification_verified', 'verification_rejected',
  'verification_canceled', 'marketing_promo',
  'reconciliation_alert', 'reconciliation_digest',
  'bounty_quality_nudge', 'application_pending_reminder', 'application_expired',
  'rating_reminder', 'application_bounty_closed',
  -- added 2026-10-11
  'payout_setup_required', 'release_waiting_on_hunter', 'bounty_location_nudge'
]::text[]));
