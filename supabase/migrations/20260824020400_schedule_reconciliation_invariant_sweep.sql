-- =====================================================================
-- Phase 4 — audit finding NEW-2: schedule the invariant sweep.
--
-- Alerting on a job that does not run is theatre, so this ships in the same
-- change as the trigger.
--
-- THE FINDING
-- The `reconciliation` Edge Function owns the checks that matter most for the
-- settlement invariant: completed_withdrawal_without_payout(_total),
-- orphan_stripe_payout, orphan_ledger_withdrawal, status_mismatch,
-- amount_mismatch, transfer_fully_reversed. None of them are in the DB-side
-- run_withdrawal_reconciliation().
--
-- No cron job invoked it. Verified against production 2026-08-24: the five
-- scheduled jobs are daily-risk-assessment, withdrawal-reconciliation-daily
-- (the DB function), stripe-balance-reconciliation-hourly (which targets
-- /admin-withdrawals with action=run_stripe_balance_sync, a different check
-- set), and the two outbox drains. The sweep's most recent findings write was
-- 2026-08-16 21:33 UTC and looks like a manual invocation during the
-- withdrawal-payout-invariant work.
--
-- Consequence: a NEW completed-without-payout row, or a new orphan Stripe
-- payout, would not be detected late. It would not be detected.
--
-- ORDERING
-- 09:30 UTC — after withdrawal-reconciliation-daily at 09:00 so the two do not
-- contend, and before the digest at 09:45 so the digest sees this run's output.
--
-- BACKLOG
-- The preceding migration seeds reconciliation_alerts_sent with every
-- currently-open critical finding_type, so this job's first run pages only for
-- something genuinely new. Do not reorder these two migrations.
-- =====================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     OR NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RAISE WARNING 'pg_cron and/or pg_net are not both enabled on this project — reconciliation-invariant-sweep-daily was NOT scheduled. Enable both extensions (Database > Extensions in the Supabase dashboard) and re-run the cron.schedule(...) call from this migration manually.';
    RETURN;
  END IF;

  -- Both secrets already exist and are used by the hourly balance-sync job
  -- (jobid 6). If either is missing the job would post unauthenticated and the
  -- function would reject it, so fail the migration loudly instead.
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'edge_function_base_url') THEN
    RAISE EXCEPTION 'vault secret edge_function_base_url is missing — cannot schedule the reconciliation sweep';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'reconciliation_cron_secret') THEN
    RAISE EXCEPTION 'vault secret reconciliation_cron_secret is missing — cannot schedule the reconciliation sweep';
  END IF;

  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'reconciliation-invariant-sweep-daily';

  PERFORM cron.schedule(
    'reconciliation-invariant-sweep-daily',
    '30 9 * * *',
    $cron$
      SELECT net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'edge_function_base_url') || '/reconciliation',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || COALESCE((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'reconciliation_cron_secret'), '')
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 55000
      );
    $cron$
  );
END $$;
