-- =====================================================================
-- Bring the reconciliation cron schedule back under version control.
--
-- THE FINDING (2026-09-01)
-- Production cron.job contains `stripe-payout-reconciliation-15min`
-- (schedule */15 * * * *, POSTs /reconciliation with {"action":"run"}).
-- It appears in NO migration in this repository. Meanwhile the job that IS
-- tracked — `reconciliation-invariant-sweep-daily`, added by
-- 20260824020400_schedule_reconciliation_invariant_sweep.sql at 30 9 * * * —
-- does not exist in production at all.
--
-- Someone replaced a daily job with a 15-minute one directly against the
-- database. The change itself is defensible: 15 minutes is a better detection
-- latency for money movement than 24 hours. Doing it outside git is not — it
-- is the same untracked-production-object class as the profile guard trigger
-- (2026-07-19) and the shadow edge functions (2026-07-20), and here it had a
-- direct measurement consequence. Findings were written with a plain INSERT,
-- so multiplying the run frequency by 96 multiplied the reported "critical
-- mismatch" backlog by 96 — which is the whole of the 2026-08-31 brief's
-- "288 financial mismatches" and its apparent climb from ~22/day on 08-28
-- (a partial first day of the new schedule).
--
-- This migration records reality rather than changing it: it declares the
-- 15-minute job at its current schedule and body, and removes the tracked-but-
-- absent daily job so git and production agree.
--
-- SAFE TO RE-RUN. Applying this to a database that already has the job
-- unschedules and re-schedules it with identical settings.
--
-- ORDER: apply AFTER 20260901140000_reconciliation_finding_identity.sql.
-- Running a 15-minute job against the non-idempotent writer is what created
-- the duplicate backlog in the first place.
-- =====================================================================

DO $$
DECLARE
  v_missing text[];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     OR NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RAISE WARNING 'pg_cron and/or pg_net are not both enabled — reconciliation cron NOT scheduled.';
    RETURN;
  END IF;

  -- Vault itself must be checked before it is queried. Without this, a database
  -- where Vault is not installed (or where the role cannot see it) fails on the
  -- SELECT below with a bare "relation does not exist" — the migration aborts
  -- with no indication of what is actually wrong. Downgrade to the same
  -- WARNING+RETURN as the extension check so a local or CI database without
  -- Vault simply skips scheduling rather than failing the whole migration run.
  IF to_regclass('vault.decrypted_secrets') IS NULL THEN
    RAISE WARNING 'vault.decrypted_secrets is not available (Vault not installed, or not visible to %) — reconciliation cron NOT scheduled.',
      current_user;
    RETURN;
  END IF;

  -- One scan for both secrets, and one message naming everything that is
  -- missing rather than failing on whichever is checked first.
  SELECT array_agg(required.name ORDER BY required.name)
    INTO v_missing
  FROM (VALUES ('edge_function_base_url'), ('reconciliation_cron_secret')) AS required(name)
  WHERE NOT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets s
    WHERE s.name = required.name AND COALESCE(s.decrypted_secret, '') <> ''
  );

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'vault secret(s) missing or empty: % — cannot schedule the reconciliation sweep',
      array_to_string(v_missing, ', ');
  END IF;

  -- The daily job this repo believed was running. It is not present in
  -- production; the 15-minute job below supersedes it. Unschedule defensively
  -- so no environment ends up running both against the same checks.
  PERFORM cron.unschedule(jobid)
  FROM cron.job
  WHERE jobname = 'reconciliation-invariant-sweep-daily';

  PERFORM cron.unschedule(jobid)
  FROM cron.job
  WHERE jobname = 'stripe-payout-reconciliation-15min';

  PERFORM cron.schedule(
    'stripe-payout-reconciliation-15min',
    '*/15 * * * *',
    -- The secrets are read at RUN time, never baked in: cron.job.command is
    -- readable by anyone who can see the table, so interpolating the bearer
    -- token here would store it in plaintext.
    --
    -- Both are fetched in ONE pass rather than a subquery per header. The
    -- Authorization header is omitted entirely when the token is missing or
    -- empty — sending `Bearer ` with nothing after it just produces a confusing
    -- 401 at the edge function instead of an obviously absent credential. The
    -- WHERE clause means a missing base URL skips the POST rather than firing
    -- at '/reconciliation' with no host.
    $cron$
      WITH secrets AS (
        SELECT
          max(decrypted_secret) FILTER (WHERE name = 'edge_function_base_url')      AS base_url,
          max(decrypted_secret) FILTER (WHERE name = 'reconciliation_cron_secret')  AS cron_secret
        FROM vault.decrypted_secrets
        WHERE name IN ('edge_function_base_url', 'reconciliation_cron_secret')
      )
      SELECT net.http_post(
        url := s.base_url || '/reconciliation',
        headers := CASE
          WHEN COALESCE(s.cron_secret, '') = ''
            THEN jsonb_build_object('Content-Type', 'application/json')
          ELSE jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || s.cron_secret
          )
        END,
        body := jsonb_build_object('action', 'run'),
        timeout_milliseconds := 55000
      )
      FROM secrets s
      WHERE COALESCE(s.base_url, '') <> '';
    $cron$
  );
END $$;
