-- Daily retention for the two operational log tables that have none.
--
-- cron.job_run_details gains a row for every cron run (about 4,300 a day) and
-- pg_cron never prunes it. fn_check_job_health() scans it every five minutes, so
-- its cost grew with the table. client_logs also grew without limit. Neither
-- table holds financial records.
--
-- Windows: 14 days of cron history, which outlasts every job-health probe (the
-- longest looks back one hour), and 30 days of client logs, which outlasts the
-- admin error view.
--
-- The heartbeat carries the row counts, so each run leaves evidence of what it
-- did. If the job stops, job health raises an alert after 72 hours.
--
-- Done means: job_health has a row for operational-log-retention-daily each day
-- with deleted counts in `detail`, and cron.job_run_details stays near 60k rows.
--
-- Rollback:
--   SELECT cron.unschedule('operational-log-retention-daily');
--   DELETE FROM public.job_health_expectations WHERE job_name = 'operational-log-retention-daily';
--   DROP FUNCTION IF EXISTS public.fn_prune_operational_logs();

CREATE OR REPLACE FUNCTION public.fn_prune_operational_logs()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cron_rows   bigint;
  v_client_rows bigint;
BEGIN
  DELETE FROM cron.job_run_details WHERE end_time < now() - interval '14 days';
  GET DIAGNOSTICS v_cron_rows = ROW_COUNT;

  DELETE FROM public.client_logs WHERE created_at < now() - interval '30 days';
  GET DIAGNOSTICS v_client_rows = ROW_COUNT;

  RETURN jsonb_build_object('cron_rows', v_cron_rows, 'client_log_rows', v_client_rows);
END;
$$;

COMMENT ON FUNCTION public.fn_prune_operational_logs() IS
  'Deletes cron.job_run_details older than 14 days and client_logs older than 30 days. Returns the row counts for the job heartbeat.';

REVOKE ALL ON FUNCTION public.fn_prune_operational_logs() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_prune_operational_logs() FROM anon, authenticated;

INSERT INTO public.job_health_expectations (job_name, max_silence, probe_sql, description)
VALUES (
  'operational-log-retention-daily', '72 hours', NULL,
  'prunes cron.job_run_details (14d) and client_logs (30d)'
)
ON CONFLICT (job_name) DO UPDATE
  SET max_silence = EXCLUDED.max_silence, description = EXCLUDED.description;

DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'operational-log-retention-daily';
END $$;

SELECT cron.schedule(
  'operational-log-retention-daily', '41 4 * * *',
  $$SELECT public.record_job_heartbeat('operational-log-retention-daily', public.fn_prune_operational_logs());$$
);
