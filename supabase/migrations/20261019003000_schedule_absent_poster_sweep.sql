-- =====================================================================
-- SBA-01 (docs/audits/shoal-behavioral-audit.md): run the absent-poster
-- sweep every day.
--
-- fn_sweep_absent_posters (20260925220000 + 20260925230000) closes the
-- pending applications on open bounties whose poster has had no activity for
-- 14 days, archives the bounty when it holds no money, and only flags it
-- (is_stale) when it might. It was built on 2026-09-25 and never scheduled;
-- its first real run was done by hand on production on 2026-10-19
-- (sweep_id 967fd00f: 13 bounties archived, 2 funded test bounties flagged,
-- 61 applications closed).
--
-- Schedule: 14:00 UTC = 10:00 EDT / 09:00 EST. Hunter notices land mid-morning
-- in the US East and after 06:00 in the US West.
--
-- Plain SQL, not the expire-bounty-requests edge function's
-- absent_poster_sweep mode: no secret or pg_net hop to fail, and pg_cron runs
-- the command as one transaction. Trade-off: the PostHog
-- application_expired(reason=poster_absent) event is not emitted. The
-- authoritative record is absent_poster_sweep_runs / absent_poster_sweep_log
-- and bounty_requests.rejection_source = 'system_poster_absent'.
--
-- Health: job_health_expectations probes absent_poster_sweep_runs directly
-- (a finished run, even one that closed nothing), so a sweep that errors or
-- never fires goes stale after 72 hours (3x the interval, as for the other
-- daily jobs). A run that raises also shows up in cron-run-failures.
--
-- Requires fn_sweep_absent_posters and absent_poster_sweep_runs: fails loudly
-- on an environment that is missing 20260925220000/230000 rather than
-- scheduling a job that errors every day.
--
-- DONE MEANS OBSERVED:
--   * SELECT started_at, finished_at, bounties_swept, requests_closed
--     FROM absent_poster_sweep_runs ORDER BY started_at DESC;
--     -- a new row every day around 14:00 UTC with finished_at set.
--   * The SBA-01 dead-listing count trends down (3 right after the
--     2026-10-19 manual run; it reaches 0 only once the sweep also covers
--     listings with no pending applications -- the SBA-01 follow-up).
-- =====================================================================

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.fn_sweep_absent_posters(boolean, integer)') IS NULL
     OR to_regclass('public.absent_poster_sweep_runs') IS NULL THEN
    RAISE EXCEPTION 'fn_sweep_absent_posters / absent_poster_sweep_runs missing: apply 20260925220000 and 20260925230000 first';
  END IF;
END $$;

INSERT INTO public.job_health_expectations (job_name, max_silence, probe_sql, description)
VALUES (
  'absent-poster-sweep-daily', '72 hours',
  $q$SELECT max(finished_at) FROM public.absent_poster_sweep_runs$q$,
  'SQL job; fn_sweep_absent_posters(false, 14) writes one absent_poster_sweep_runs row per run, including runs that close nothing'
)
ON CONFLICT (job_name) DO UPDATE
  SET max_silence = EXCLUDED.max_silence, probe_sql = EXCLUDED.probe_sql, description = EXCLUDED.description;

DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'absent-poster-sweep-daily';
END $$;
SELECT cron.schedule('absent-poster-sweep-daily', '0 14 * * *',
  $$SELECT count(*) FROM public.fn_sweep_absent_posters(false, 14);$$);

COMMIT;

-- ─── Rollback ───────────────────────────────────────────────────────────────
--   SELECT cron.unschedule('absent-poster-sweep-daily');
--   DELETE FROM public.job_health_expectations WHERE job_name = 'absent-poster-sweep-daily';
