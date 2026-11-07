-- moderation_alert is a real type: moderation-sweep sends it through
-- fn_notify_admins, and it is in lib/config/notification-taxonomy.ts and in
-- process-notification's category map. notifications_type_check never listed it,
-- so the in-app insert fails with 23514 and admins get no bell entry for a
-- moderation alert. process-notification logs the error and carries on, so the
-- outbox row still ends up 'sent'.
--
-- The list is production's current constraint, unchanged, plus moderation_alert.
-- It only widens what is allowed, so every existing row still passes.
--
-- Done means: notifications has a row with type = 'moderation_alert' after the
-- next sweep that raises one, and logs stop showing 23514 for that type.
--
-- Rollback: re-run this statement without 'moderation_alert'. Delete any
-- moderation_alert rows first, or the re-added constraint will reject them.

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK (type = ANY (ARRAY[
  'application', 'acceptance', 'completion', 'payment', 'message', 'follow',
  'cancellation_request', 'cancellation_accepted', 'cancellation_rejected',
  'dispute_created', 'dispute_resolved', 'workflow_dispute_created',
  'stale_bounty', 'stale_bounty_cancelled', 'stale_bounty_reposted', 'update', 'review_needed',
  'balance_update', 'bounty_nearby', 'bounty_expiry', 'dispute_escalated',
  'account_warning', 'account_restricted', 'payout_paid', 'payout_failed', 'payout_canceled',
  'withdrawal_reversed', 'bank_disconnected', 'payout_method_changed',
  'verification_submitted', 'verification_verified', 'verification_rejected', 'verification_canceled',
  'marketing_promo', 'reconciliation_alert', 'reconciliation_digest', 'bounty_quality_nudge',
  'application_pending_reminder', 'application_expired', 'rating_reminder',
  'application_bounty_closed', 'payout_setup_required', 'release_waiting_on_hunter',
  'bounty_location_nudge', 'application_closure_digest',
  'proof_consent_request',
  'moderation_alert'
]::text[]));
