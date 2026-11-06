-- Reverts 20261106180000_push_receipt_due_email_fallbacks.sql.
--
-- Roll back process-notification first if the deployed version calls
-- fn_due_push_receipt_email_fallbacks: it does not read the rpc error, so
-- dropping the function under it stops email retries silently.

BEGIN;

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
    RETURN 0;
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

DROP FUNCTION IF EXISTS public.fn_due_push_receipt_email_fallbacks(timestamptz, integer);

COMMIT;
