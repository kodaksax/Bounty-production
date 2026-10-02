-- Rollback for 20261002120100_review_window_and_recourse_queue.sql
--
-- Everything in that migration is new, so rollback is a drop. It DISCARDS the
-- support queue (trust_review_queue), the reminder/escalation stamps on
-- completion_submissions and bounty_disputes.reason_code. Export
-- trust_review_queue first if any item is still open:
--   SELECT * FROM public.trust_review_queue WHERE status <> 'resolved';
-- bounty_events rows already written ('completion_review_overdue') are kept:
-- the ledger is append-only.

BEGIN;

DO $do$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'completion-review-window';
END
$do$;
DELETE FROM public.job_health_expectations WHERE job_name = 'completion-review-window';

DROP TRIGGER IF EXISTS trg_bounty_disputes_enqueue_review ON public.bounty_disputes;

DROP FUNCTION IF EXISTS public.admin_review_window_report();
DROP FUNCTION IF EXISTS public.admin_update_trust_review_item(uuid, text, text, text);
DROP FUNCTION IF EXISTS public.admin_trust_review_queue(boolean);
DROP FUNCTION IF EXISTS public.fn_process_completion_review_window();
DROP FUNCTION IF EXISTS public.trg_fn_bounty_disputes_enqueue_review();
DROP FUNCTION IF EXISTS public.fn_completion_auto_release_blockers(uuid);
DROP FUNCTION IF EXISTS public.fn_bounty_party_activity(uuid);
DROP FUNCTION IF EXISTS public.fn_trust_review_page_admins(text, text, jsonb);

DROP TABLE IF EXISTS public.trust_review_queue;
DROP TABLE IF EXISTS public.completion_review_policy;

DROP INDEX IF EXISTS public.completion_submissions_pending_review_idx;
ALTER TABLE public.completion_submissions
  DROP COLUMN IF EXISTS review_reminder_24h_sent_at,
  DROP COLUMN IF EXISTS review_reminder_48h_sent_at,
  DROP COLUMN IF EXISTS review_escalated_at;

ALTER TABLE public.bounty_disputes DROP CONSTRAINT IF EXISTS bounty_disputes_reason_code_check;
ALTER TABLE public.bounty_disputes DROP COLUMN IF EXISTS reason_code;

COMMIT;
