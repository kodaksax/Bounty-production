-- Push receipt email retries: the selector process-notification calls, and a
-- cron gate that wakes it for retries.
--
-- 20261106133106 was applied to production before review, and 0fa415ef then
-- edited that applied file. A version already in schema_migrations never runs
-- again, so the additions never reached production, while
-- process-notification/index.ts on main already calls this RPC. That file is
-- restored to what ran, and the additions live here.
--
-- What this adds:
--   * fn_due_push_receipt_email_fallbacks(): retryable groups, selected before
--     the limit so an ineligible group (one with a delivered or still-pending
--     sibling ticket) cannot starve retries. Service role only.
--   * fn_check_push_receipts(): when no ticket is due, also checks for due email
--     retries. They stay due after their tickets resolve, and the old early
--     return meant no run would pick them up.
--
-- Apply this before deploying a process-notification that calls the RPC: the
-- caller does not read the rpc error, so a missing function stops retries
-- silently.
--
-- Rollback: supabase/rollbacks/production/20261106180000_push_receipt_due_email_fallbacks.down.sql

BEGIN;

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

COMMIT;
