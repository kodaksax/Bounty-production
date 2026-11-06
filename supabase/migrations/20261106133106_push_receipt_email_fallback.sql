-- Expo push receipts -> email fallback.
--
-- Context (2026-11-06): the push pipeline only read Expo's *tickets* (accepted
-- for delivery), never the *receipts* (what APNs/FCM did with it). A poster who
-- had uninstalled the app, or whose device the provider rejected, therefore
-- counted as "sent", the ticket-level email fallback never fired, and the
-- poster never learned an applicant was waiting. See
-- supabase/functions/process-notification/receipt-fallback.ts.
--
-- What this adds (additive only; no existing table or function is changed):
--   * push_receipt_tickets: one row per ACCEPTED Expo ticket for the types that
--     have an email fallback (application, application_expired,
--     application_closure_digest). process-notification writes it at send time.
--   * fn_check_push_receipts(): called by pg_cron every 5 minutes. If tickets
--     are due it POSTs {mode:'check_receipts'} to process-notification, which
--     fetches the receipts from Expo, prunes DeviceNotRegistered tokens, and
--     sends the existing one-per-application fallback email when NO device of
--     the recipient got the push. The email dedupe is the existing
--     notification_email_fallbacks ledger, so an application is never emailed
--     twice whichever path got there first.
--   * a job_health expectation so a silent cron/function failure pages.
--
-- DONE MEANS OBSERVED (after deploy):
--   * rows in push_receipt_tickets moving pending -> ok|error,
--   * for a failed receipt: a notification_email_fallbacks row whose
--     push_failure_reason = 'push_receipt_error', and PostHog notification_sent
--     with notification_delivered_via = 'email' and source = 'receipt_check',
--   * job_health heartbeats for 'check-push-receipts'.
--
-- Rollback:
--   SELECT cron.unschedule('check-push-receipts');
--   DELETE FROM public.job_health_expectations WHERE job_name = 'check-push-receipts';
--   DROP FUNCTION IF EXISTS public.fn_check_push_receipts();
--   DROP TABLE IF EXISTS public.push_receipt_tickets;
-- (Roll back the edge function first: the deployed function writes the table.)

BEGIN;

CREATE TABLE IF NOT EXISTS public.push_receipt_tickets (
  -- Expo's ticket id; also the key getReceipts is asked for.
  ticket_id        text PRIMARY KEY,
  outbox_id        uuid NOT NULL,
  user_id          uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  notification_type text NOT NULL,
  -- Kept so a DeviceNotRegistered receipt can delete exactly this token.
  token            text NOT NULL,
  status           text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'ok', 'error', 'expired')),
  attempts         integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  -- Expo documents receipts as available ~15 minutes after the send.
  check_after      timestamptz NOT NULL DEFAULT (now() + interval '15 minutes'),
  resolved_at      timestamptz,
  error_code       text,
  error_message    text,
  -- What the email fallback did once the recipient's tickets all failed:
  -- sent | already_emailed | opted_out | no_provider | failed | no_bounty
  fallback_result  text
);

COMMENT ON TABLE public.push_receipt_tickets IS
  'Accepted Expo push tickets awaiting their delivery receipt, for notification types with an email fallback. Written by process-notification at send time, resolved by its check_receipts mode. Service-role only.';

CREATE INDEX IF NOT EXISTS push_receipt_tickets_due_idx
  ON public.push_receipt_tickets (check_after) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS push_receipt_tickets_group_idx
  ON public.push_receipt_tickets (outbox_id, user_id);

-- Select retryable groups before limiting so an ineligible group (for example,
-- one with a delivered or still-pending sibling ticket) cannot starve retries.
CREATE OR REPLACE FUNCTION public.fn_due_push_receipt_email_fallbacks(
  p_since timestamptz,
  p_limit integer DEFAULT 100
)
RETURNS TABLE (
  ticket_id text,
  outbox_id uuid,
  user_id uuid,
  notification_type text,
  token text,
  status text,
  attempts integer,
  created_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT DISTINCT ON (t.outbox_id, t.user_id)
         t.ticket_id, t.outbox_id, t.user_id, t.notification_type,
         t.token, t.status, t.attempts, t.created_at
    FROM public.push_receipt_tickets AS t
   WHERE t.status = 'error'
     AND t.fallback_result IS NULL
     AND t.resolved_at >= p_since
     AND NOT EXISTS (
       SELECT 1
         FROM public.push_receipt_tickets AS sibling
        WHERE sibling.outbox_id = t.outbox_id
          AND sibling.user_id = t.user_id
          AND (sibling.status IN ('ok', 'pending', 'expired') OR sibling.fallback_result IS NOT NULL)
     )
   ORDER BY t.outbox_id, t.user_id, t.resolved_at DESC, t.ticket_id
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 0), 0), 100);
$function$;

REVOKE ALL ON FUNCTION public.fn_due_push_receipt_email_fallbacks(timestamptz, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_due_push_receipt_email_fallbacks(timestamptz, integer) TO service_role;

-- Service-role only: RLS on with no policies, and explicit revokes (anon gets
-- auto-granted privileges on new tables; REVOKE FROM PUBLIC does not cover it).
ALTER TABLE public.push_receipt_tickets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.push_receipt_tickets FROM PUBLIC;
REVOKE ALL ON public.push_receipt_tickets FROM anon;
REVOKE ALL ON public.push_receipt_tickets FROM authenticated;

-- Cron entry point. Mirrors drain_notifications_outbox(): vault holds
-- SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, and process-notification only
-- accepts the service-role bearer. Does nothing (and makes no HTTP call) when
-- no ticket is due, which is most runs.
CREATE OR REPLACE FUNCTION public.fn_check_push_receipts()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_url  text;
  v_key  text;
  v_due  integer;
BEGIN
  -- Resolved rows are only useful for diagnosis; two weeks is plenty.
  DELETE FROM public.push_receipt_tickets
   WHERE status <> 'pending' AND created_at < now() - interval '14 days';

  SELECT count(*) INTO v_due
    FROM public.push_receipt_tickets
   WHERE status = 'pending' AND check_after <= now();
  IF v_due = 0 THEN
    -- Email retries remain due after their receipt tickets have resolved.
    SELECT count(*) INTO v_due
      FROM public.fn_due_push_receipt_email_fallbacks(now() - interval '2 hours', 1);
    IF v_due = 0 THEN
      RETURN 0;
    END IF;
  END IF;

  SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL';
  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY';
  IF v_url IS NULL OR v_key IS NULL THEN
    -- Fail the cron run (job_health "cron-run-failures" pages) rather than
    -- silently never reading receipts.
    RAISE EXCEPTION 'fn_check_push_receipts: missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in vault';
  END IF;

  PERFORM net.http_post(
    url     := v_url || '/functions/v1/process-notification',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body    := jsonb_build_object('mode', 'check_receipts'),
    timeout_milliseconds := 55000
  );
  RETURN v_due;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_check_push_receipts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_check_push_receipts() TO service_role;

-- A receipt check that runs but never resolves anything is the failure this
-- job exists to prevent, so the probe is the oldest pending ticket's
-- check_after: healthy while it is within the last hour (retries push it 10
-- minutes ahead, so only a stuck ticket ages past the limit).
INSERT INTO public.job_health_expectations (job_name, max_silence, probe_sql, description)
VALUES (
  'check-push-receipts', '1 hour',
  $q$SELECT COALESCE(min(check_after), now()) FROM public.push_receipt_tickets
      WHERE status = 'pending'$q$,
  'process-notification check_receipts: stale if any ticket has been due for over an hour (cron or edge fn not resolving receipts)'
)
ON CONFLICT (job_name) DO UPDATE
  SET max_silence = EXCLUDED.max_silence, probe_sql = EXCLUDED.probe_sql, description = EXCLUDED.description;

DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'check-push-receipts';
END $$;
SELECT cron.schedule(
  'check-push-receipts', '*/5 * * * *',
  $$SELECT public.fn_check_push_receipts(); SELECT public.record_job_heartbeat('check-push-receipts');$$
);

COMMIT;
