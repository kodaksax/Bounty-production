-- Reverts 20261125120100_stagger_cron_schedules.sql: restores the schedules
-- that were live in production on 2026-11-25. Commands are not touched.

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT j.jobid, v.old_schedule
      FROM (VALUES
        ('check-push-receipts',                 '*/5 * * * *'),
        ('moderation-sweep-10min',              '*/10 * * * *'),
        ('stripe-payout-reconciliation-15min',  '*/15 * * * *'),
        ('remind-posters-of-pending-requests',  '*/15 * * * *'),
        ('expire-stale-bounty-requests',        '*/15 * * * *'),
        ('remind-pending-hunter-ratings',       '*/15 * * * *'),
        ('geocode-bounties-15min',              '*/15 * * * *'),
        ('escalate-stale-bounty-liquidity',     '*/20 * * * *'),
        ('stripe-balance-reconciliation-hourly','0 * * * *')
      ) AS v(jobname, old_schedule)
      JOIN cron.job j ON j.jobname = v.jobname
  LOOP
    PERFORM cron.alter_job(r.jobid, schedule := r.old_schedule);
  END LOOP;
END $$;
