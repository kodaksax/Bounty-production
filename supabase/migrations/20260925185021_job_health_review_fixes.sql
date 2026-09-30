-- Review follow-ups to 20260925120000_job_health_monitoring.sql.
--
-- 20260925120000 was applied to production (2026-09-25 17:47 UTC) before
-- these review fixes were folded into it. That file now contains them too, so
-- a fresh environment gets the final shape from it alone; this migration
-- carries the same delta for environments that ran the earlier version.
-- Everything here is idempotent.
--
-- (The alter_job existence assertions added to 20260925120000 are not
-- repeated: they guard the one-time rewrite, which production already has.
-- Verified before this migration: 6 cron commands carry record_job_heartbeat
-- and expire-stale-bounty-requests uses expire_bounty_requests_cron_secret.)

BEGIN;

-- probe_sql is EXECUTEd by a SECURITY DEFINER function: write access to
-- job_health_expectations == arbitrary SQL as its owner. Owner-only.
REVOKE ALL ON public.job_health_expectations, public.ops_smoke_checks FROM PUBLIC, service_role;

-- The smoke check is meant to be runnable on demand without superuser.
GRANT EXECUTE ON FUNCTION public.ops_smoke_check_edge_auth()     TO service_role;
GRANT EXECUTE ON FUNCTION public.ops_smoke_check_results(uuid)   TO service_role;

-- Retention (see 20260925120000 section 8 for the rationale).
CREATE OR REPLACE FUNCTION public.fn_prune_job_health()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  DELETE FROM public.job_health       WHERE beat_at      < now() - interval '30 days';
  DELETE FROM public.ops_smoke_checks WHERE requested_at < now() - interval '30 days';
  DELETE FROM public.ops_alerts       WHERE resolved_at  < now() - interval '180 days';
$$;
REVOKE ALL ON FUNCTION public.fn_prune_job_health() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_prune_job_health() FROM anon, authenticated;

INSERT INTO public.job_health_expectations (job_name, max_silence, probe_sql, description)
VALUES ('job-health-retention-daily', '72 hours', NULL, 'prunes job_health/ops_smoke_checks (30d) and resolved ops_alerts (180d)')
ON CONFLICT (job_name) DO UPDATE SET max_silence = EXCLUDED.max_silence, description = EXCLUDED.description;

DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'job-health-retention-daily';
END $$;
SELECT cron.schedule('job-health-retention-daily', '17 4 * * *',
  $$SELECT public.fn_prune_job_health(); SELECT public.record_job_heartbeat('job-health-retention-daily');$$);

COMMIT;
