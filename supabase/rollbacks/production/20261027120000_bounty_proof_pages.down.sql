-- Rollback for 20261027120000_bounty_proof_pages.sql.
--
-- Takes every proof page down (the website's proof-pages calls then 404) and
-- drops the consent records with them. Export public.bounty_proofs first if
-- the posters' answers must survive a rollback: they are the only record of
-- who agreed to what.
--
-- Pending proof_consent_request rows in notifications_outbox are cancelled so
-- the type check can be restored; delivered in-app notifications of that
-- type are deleted for the same reason.

BEGIN;

DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'proof-consent-requests-hourly';
END $$;
DELETE FROM public.job_health_expectations WHERE job_name = 'proof-consent-requests-hourly';

DROP FUNCTION IF EXISTS public.fn_request_proof_consent(integer);
DROP FUNCTION IF EXISTS public.proof_admin_queue();
DROP FUNCTION IF EXISTS public.proof_admin_unpublish(uuid, text);
DROP FUNCTION IF EXISTS public.proof_admin_publish(uuid, jsonb, boolean, text);
DROP FUNCTION IF EXISTS public.proof_poster_set_consent(uuid, boolean, boolean, text, boolean, text, text, text);
DROP FUNCTION IF EXISTS public.proof_poster_get(uuid);
DROP FUNCTION IF EXISTS public.fn_proof_poster_state(uuid);
DROP FUNCTION IF EXISTS public.proof_public_photo(text, integer);
DROP FUNCTION IF EXISTS public.proof_public_index();
DROP FUNCTION IF EXISTS public.proof_public_list(text, text[], integer, integer);
DROP FUNCTION IF EXISTS public.proof_public_get(text);
DROP VIEW IF EXISTS public.bounty_proof_public_v;
DROP TRIGGER IF EXISTS trg_bounty_proofs_guard ON public.bounty_proofs;
DROP FUNCTION IF EXISTS public.fn_bounty_proofs_guard();
DROP TABLE IF EXISTS public.bounty_proofs;
DROP FUNCTION IF EXISTS public.fn_proof_eligibility(uuid);
DROP FUNCTION IF EXISTS public.fn_proof_city_label(text);
DROP FUNCTION IF EXISTS public.fn_proof_new_public_id();

UPDATE public.notifications_outbox
   SET status = 'failed', last_error = 'rolled back: proof_consent_request removed'
 WHERE data->>'type' = 'proof_consent_request' AND status IN ('pending', 'processing');
DELETE FROM public.notifications WHERE type = 'proof_consent_request';

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
  'bounty_location_nudge', 'application_closure_digest'
]::text[]));

COMMIT;
