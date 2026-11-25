-- Stagger pg_cron schedules off the quarter-hour.
--
-- Evidence (production, cron.job_run_details, 3 days to 2026-11-25): every
-- job runs 2-4x slower when it starts at :00/:15/:30/:45 than at any other
-- minute, because ~9 jobs fire together there on a small instance
-- (max_connections 60, shared_buffers 256MB, max_worker_processes 6):
--
--   job                               p50 other   p50 quarter-hour
--   drain-notifications-outbox          30 ms         89 ms
--   drain-analytics-person-outbox       17 ms         66 ms
--   moderation-sweep-10min              33 ms         82 ms
--   check-push-receipts                 52 ms        106 ms
--   job-health-check-5min              235 ms        354 ms
--
-- Run in isolation the jobs are cheap (fn_remind_posters_of_pending_requests
-- 2-11 ms vs a 246 ms cron average), so this is contention, not query cost.
--
-- Only the minute changes. Every job keeps its interval (and so its
-- job_health_expectations.max_silence budget), its command and its heartbeat;
-- none of these functions depend on the wall-clock minute. cron.alter_job is
-- used so commands are untouched; jobs absent from an environment are skipped.
--
-- Resulting layout (minute mod 5 / mod 10 kept distinct where it matters):
--   */5   job-health-check-5min                  0,5,10,...   (watchdog, alone)
--   */5   check-push-receipts                    2,7,12,...
--   */10  moderation-sweep-10min                 4,14,24,...
--   */15  stripe-payout-reconciliation-15min     1,16,31,46
--   */15  remind-posters-of-pending-requests     3,18,33,48
--   */15  expire-stale-bounty-requests           8,23,38,53
--   */15  remind-pending-hunter-ratings          11,26,41,56
--   */15  geocode-bounties-15min                 13,28,43,58
--   */20  escalate-stale-bounty-liquidity        19,39,59
--   hourly stripe-balance-reconciliation-hourly  :29
--   (unchanged: completion-review-window 7,22,37,52; hunter-closure :07;
--    proof-consent :23; the two outbox drains every minute; daily jobs)
--
-- Rollback: supabase/rollbacks/production/20261125120100_stagger_cron_schedules.down.sql

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT j.jobid, j.jobname, v.new_schedule
      FROM (VALUES
        ('check-push-receipts',                 '2-59/5 * * * *'),
        ('moderation-sweep-10min',              '4-59/10 * * * *'),
        ('stripe-payout-reconciliation-15min',  '1,16,31,46 * * * *'),
        ('remind-posters-of-pending-requests',  '3,18,33,48 * * * *'),
        ('expire-stale-bounty-requests',        '8,23,38,53 * * * *'),
        ('remind-pending-hunter-ratings',       '11,26,41,56 * * * *'),
        ('geocode-bounties-15min',              '13,28,43,58 * * * *'),
        ('escalate-stale-bounty-liquidity',     '19,39,59 * * * *'),
        ('stripe-balance-reconciliation-hourly','29 * * * *')
      ) AS v(jobname, new_schedule)
      JOIN cron.job j ON j.jobname = v.jobname
  LOOP
    PERFORM cron.alter_job(r.jobid, schedule := r.new_schedule);
  END LOOP;
END $$;
