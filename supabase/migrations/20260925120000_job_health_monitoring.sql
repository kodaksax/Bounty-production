-- Scheduled-job health monitoring + edge-function auth smoke check.
--
-- WHY: from 2026-09-13 to 2026-09-25 moderation-sweep (144/144 per day) and
-- expire-bounty-requests (96/96) returned 401 on every run, and
-- process-analytics-person (283/283) did too, while cron.job_run_details
-- reported every run as `succeeded`. That status only means net.http_post was
-- queued; nothing looked at the response. This migration makes "the job ran"
-- mean "the job's output was observed".
--
-- Root causes (fixed by scripts/ops/sync-cron-secrets.js, NOT by this file,
-- because secret values must never be committed):
--   * vault SUPABASE_SERVICE_ROLE_KEY held a deleted sb_secret_ key. The API
--     gateway rejected it ("Unregistered API key") before any function ran.
--     Callers: moderation-sweep-10min, drain_notifications_outbox,
--     drain_analytics_person_outbox.
--   * expire-bounty-requests checks EXPIRE_BOUNTY_REQUESTS_CRON_SECRET, which
--     was never set; the live cron job had also been hand-edited to send
--     reconciliation_cron_secret instead of the dedicated vault secret named
--     in 20260913000000. Section 1 restores the git definition.
--
-- Design: option (a), heartbeats, not (b), scanning net._http_response.
--   * net._http_response has no URL column and pg_net deletes the request
--     queue row after sending, so a non-2xx cannot be attributed to a job.
--     Rows are also only retained ~6h.
--   * A non-2xx scan cannot see "200 but did nothing", a job that was
--     unscheduled, or a SQL job that never calls HTTP at all. The 2026-09-13
--     failure class is "healthy-looking, zero executions"; only a positive
--     signal from the job's own output catches that.
--   * Where a job already writes one row per successful run
--     (moderation_sweep_runs, reconciliation_reports, stripe_balance_snapshots)
--     that row IS the heartbeat, so no payment function had to be redeployed.
--     A non-2xx scan is kept as one extra probe (auth/5xx only), as a
--     catch-all for callers nobody registered (e.g. dashboard webhooks).
--
-- Alerts reach a human via notifications_outbox -> Push_noti_manager webhook
-- -> process-notification -> send-notification-email. That path authenticates
-- with the webhook's own JWT and the runtime's own env key, never the vault
-- key, so a stale vault secret cannot also silence the alarm about it.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Restore expire-stale-bounty-requests to its dedicated secret (git def).
-- ---------------------------------------------------------------------------
-- Asserts the job exists: a silent 0-row alter_job would leave it misconfigured.
DO $do$
DECLARE
  v_jobid bigint;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'expire-stale-bounty-requests';
  IF v_jobid IS NULL THEN
    RAISE EXCEPTION 'cron job expire-stale-bounty-requests not found; cannot restore its secret';
  END IF;
  PERFORM cron.alter_job(
    v_jobid,
    command := $cmd$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'edge_function_base_url') || '/expire-bounty-requests',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || COALESCE((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'expire_bounty_requests_cron_secret'), '')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $cmd$
  );
END
$do$;

-- ---------------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------------
-- One row per successful run of a job that has no natural output row.
CREATE TABLE IF NOT EXISTS public.job_health (
  id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_name  text        NOT NULL,
  beat_at   timestamptz NOT NULL DEFAULT now(),
  detail    jsonb       NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS job_health_job_beat_idx ON public.job_health (job_name, beat_at DESC);

-- What "healthy" means per job. probe_sql NULL = latest job_health row;
-- otherwise a query returning one timestamptz: the last time the job was
-- observed working. Stale when older than max_silence (3x the interval).
-- registered_at is the grace baseline for a job that has never beaten, so a
-- new expectation never needs a fabricated heartbeat.
CREATE TABLE IF NOT EXISTS public.job_health_expectations (
  job_name      text PRIMARY KEY,
  max_silence   interval    NOT NULL,
  probe_sql     text,
  description   text        NOT NULL,
  enabled       boolean     NOT NULL DEFAULT true,
  registered_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ops_alerts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_key        text        NOT NULL,
  severity         text        NOT NULL DEFAULT 'critical',
  summary          text        NOT NULL,
  detail           jsonb       NOT NULL DEFAULT '{}'::jsonb,
  opened_at        timestamptz NOT NULL DEFAULT now(),
  last_seen_at     timestamptz NOT NULL DEFAULT now(),
  last_notified_at timestamptz,
  notify_count     integer     NOT NULL DEFAULT 0,
  resolved_at      timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS ops_alerts_one_open_per_key
  ON public.ops_alerts (alert_key) WHERE resolved_at IS NULL;

-- On-demand auth smoke check bookkeeping (see section 5).
CREATE TABLE IF NOT EXISTS public.ops_smoke_checks (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  batch_id     uuid        NOT NULL,
  target       text        NOT NULL,
  credential   text        NOT NULL,
  request_id   bigint,
  expect_status integer    NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ops_smoke_checks_batch_idx ON public.ops_smoke_checks (batch_id);

ALTER TABLE public.job_health              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_health_expectations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_alerts              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_smoke_checks        ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.job_health, public.job_health_expectations, public.ops_alerts, public.ops_smoke_checks
  FROM anon, authenticated;

-- job_health_expectations.probe_sql is EXECUTEd by the SECURITY DEFINER
-- checker, so write access to that table is equivalent to running arbitrary
-- SQL as the function owner. Only the owning role (migrations) may touch it;
-- that includes stripping service_role's Supabase default grants. Same for
-- ops_smoke_checks, which only the definer smoke functions write.
REVOKE ALL ON public.job_health_expectations, public.ops_smoke_checks FROM PUBLIC, service_role;

-- Admin read access (JWT app_metadata role, the pattern that works in prod).
CREATE POLICY ops_alerts_admin_read ON public.ops_alerts FOR SELECT TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
CREATE POLICY job_health_admin_read ON public.job_health FOR SELECT TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
GRANT SELECT ON public.ops_alerts, public.job_health TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Heartbeat writer
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_job_heartbeat(p_job_name text, p_detail jsonb DEFAULT '{}'::jsonb)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  INSERT INTO public.job_health (job_name, detail) VALUES (p_job_name, COALESCE(p_detail, '{}'::jsonb));
$$;
REVOKE ALL ON FUNCTION public.record_job_heartbeat(text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_job_heartbeat(text, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_job_heartbeat(text, jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. Checker
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_check_job_health()
RETURNS TABLE (job_name text, last_ok timestamptz, max_silence interval, healthy boolean, probe_error text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
#variable_conflict use_column
DECLARE
  r            record;
  v_last       timestamptz;
  v_err        text;
  v_healthy    boolean;
  v_alert      public.ops_alerts%ROWTYPE;
  v_recipients uuid[];
  v_summary    text;
BEGIN
  -- Internal admins only: fn_admin_recipient_ids() also returns an admin
  -- account that is not is_internal.
  SELECT COALESCE(array_agg(a.id), '{}'::uuid[]) INTO v_recipients
  FROM unnest(public.fn_admin_recipient_ids()) AS a(id)
  JOIN public.profiles p ON p.id = a.id
  WHERE p.is_internal;

  FOR r IN SELECT * FROM public.job_health_expectations e WHERE e.enabled ORDER BY e.job_name LOOP
    v_last := NULL;
    v_err  := NULL;
    BEGIN
      IF r.probe_sql IS NULL THEN
        SELECT max(h.beat_at) INTO v_last FROM public.job_health h WHERE h.job_name = r.job_name;
      ELSE
        EXECUTE r.probe_sql INTO v_last;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_err := SQLERRM;
    END;

    -- Never beaten: measure silence from registration instead of alerting at once.
    v_last    := COALESCE(v_last, CASE WHEN v_err IS NULL THEN r.registered_at END);
    v_healthy := v_err IS NULL AND v_last IS NOT NULL AND v_last > now() - r.max_silence;

    IF NOT v_healthy THEN
      v_summary := CASE
        WHEN v_err IS NOT NULL THEN format('%s: health probe errored: %s', r.job_name, v_err)
        ELSE format('%s: no successful run observed since %s (limit %s)',
                    r.job_name, to_char(v_last AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI "UTC"'), r.max_silence)
      END;

      INSERT INTO public.ops_alerts (alert_key, summary, detail)
      VALUES (r.job_name, v_summary,
              jsonb_build_object('last_ok', v_last, 'max_silence', r.max_silence::text,
                                 'probe_error', v_err, 'description', r.description))
      ON CONFLICT (alert_key) WHERE resolved_at IS NULL
      DO UPDATE SET last_seen_at = now(), summary = EXCLUDED.summary, detail = EXCLUDED.detail
      RETURNING * INTO v_alert;

      -- Page on open, then at most every 12h while it stays open.
      IF v_alert.last_notified_at IS NULL OR v_alert.last_notified_at < now() - interval '12 hours' THEN
        IF array_length(v_recipients, 1) IS NULL THEN
          RAISE WARNING 'fn_check_job_health: no internal admin recipient for alert %', r.job_name;
        ELSE
          INSERT INTO public.notifications_outbox (recipients, title, body, data)
          VALUES (to_jsonb(v_recipients),
                  '[Ops] Scheduled job failing: ' || r.job_name,
                  v_summary,
                  jsonb_build_object('type', 'reconciliation_alert', 'ops_alert', true,
                                     'alertKey', r.job_name, 'alertId', v_alert.id));
          UPDATE public.ops_alerts
             SET last_notified_at = now(), notify_count = notify_count + 1
           WHERE id = v_alert.id;
        END IF;
      END IF;
    ELSE
      FOR v_alert IN
        UPDATE public.ops_alerts a SET resolved_at = now()
         WHERE a.alert_key = r.job_name AND a.resolved_at IS NULL
        RETURNING a.*
      LOOP
        IF array_length(v_recipients, 1) IS NOT NULL THEN
          INSERT INTO public.notifications_outbox (recipients, title, body, data)
          VALUES (to_jsonb(v_recipients),
                  '[Ops] Recovered: ' || r.job_name,
                  format('%s is healthy again (failing since %s).', r.job_name,
                         to_char(v_alert.opened_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI "UTC"')),
                  jsonb_build_object('type', 'reconciliation_alert', 'ops_alert', true,
                                     'alertKey', r.job_name, 'alertId', v_alert.id, 'resolved', true));
        END IF;
      END LOOP;
    END IF;

    job_name    := r.job_name;
    last_ok     := v_last;
    max_silence := r.max_silence;
    healthy     := v_healthy;
    probe_error := v_err;
    RETURN NEXT;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_check_job_health() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_check_job_health() FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. On-demand auth smoke check: calls every cron-invoked edge function with
--    exactly the credential its real caller uses, via a request that proves
--    auth without doing work. Two steps because pg_net sends after commit:
--      SELECT public.ops_smoke_check_edge_auth();          -- returns batch id
--      SELECT * FROM public.ops_smoke_check_results();     -- a few seconds later
--    admin-withdrawals is not probed: its cron action does real work, and it
--    shares RECONCILIATION_CRON_SECRET / reconciliation_cron_secret with the
--    reconciliation probe, which therefore covers that credential pair.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ops_smoke_check_edge_auth()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_batch uuid := gen_random_uuid();
  v_base  text := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'edge_function_base_url');
  v_url   text := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL') || '/functions/v1';
  t       record;
BEGIN
  FOR t IN
    SELECT * FROM (VALUES
      -- target,                     base,   vault credential,                     body,                                                    probe header, expected
      ('moderation-sweep',          v_base, 'SUPABASE_SERVICE_ROLE_KEY',          '{}'::jsonb,                                              true,  200),
      ('expire-bounty-requests',    v_base, 'expire_bounty_requests_cron_secret', '{}'::jsonb,                                              true,  200),
      ('reconciliation',            v_base, 'reconciliation_cron_secret',         '{"action":"health"}'::jsonb,                             false, 200),
      ('process-analytics-person',  v_url,  'SUPABASE_SERVICE_ROLE_KEY',          '{"user_id":"00000000-0000-4000-8000-000000000000"}'::jsonb, false, 200),
      -- 404 "Outbox item not found" means the gateway accepted the key.
      ('process-notification',      v_url,  'SUPABASE_SERVICE_ROLE_KEY',          '{"id":"00000000-0000-4000-8000-000000000000"}'::jsonb,      false, 404),
      ('send-notification-email',   v_url,  'SUPABASE_SERVICE_ROLE_KEY',          '{"userIds":[]}'::jsonb,                                  false, 200)
    ) AS v(target, base, credential, body, probe, expect_status)
  LOOP
    INSERT INTO public.ops_smoke_checks (batch_id, target, credential, request_id, expect_status)
    VALUES (
      v_batch, t.target, t.credential,
      net.http_post(
        url := t.base || '/' || t.target,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || COALESCE((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = t.credential), '')
        ) || CASE WHEN t.probe THEN jsonb_build_object('x-auth-probe', '1') ELSE '{}'::jsonb END,
        body := t.body,
        timeout_milliseconds := 20000
      ),
      t.expect_status
    );
  END LOOP;
  RETURN v_batch;
END;
$$;
REVOKE ALL ON FUNCTION public.ops_smoke_check_edge_auth() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ops_smoke_check_edge_auth() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ops_smoke_check_edge_auth() TO service_role;

CREATE OR REPLACE FUNCTION public.ops_smoke_check_results(p_batch_id uuid DEFAULT NULL)
RETURNS TABLE (target text, credential text, status_code integer, verdict text, body text, requested_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT s.target, s.credential, r.status_code,
    CASE
      WHEN r.id IS NULL                       THEN 'pending'
      WHEN r.timed_out OR r.error_msg IS NOT NULL THEN 'ERROR: ' || COALESCE(r.error_msg, 'timed out')
      WHEN r.status_code IN (401, 403)        THEN 'AUTH_FAILED'
      WHEN r.status_code = s.expect_status    THEN 'ok'
      ELSE 'UNEXPECTED (expected ' || s.expect_status || ')'
    END,
    left(r.content::text, 200),
    s.requested_at
  FROM public.ops_smoke_checks s
  LEFT JOIN net._http_response r ON r.id = s.request_id
  WHERE s.batch_id = COALESCE(p_batch_id,
          (SELECT batch_id FROM public.ops_smoke_checks ORDER BY requested_at DESC, id DESC LIMIT 1))
  ORDER BY s.target;
$$;
REVOKE ALL ON FUNCTION public.ops_smoke_check_results(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ops_smoke_check_results(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ops_smoke_check_results(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 6. Expectations (max_silence = 3x schedule interval)
-- ---------------------------------------------------------------------------
INSERT INTO public.job_health_expectations (job_name, max_silence, probe_sql, description) VALUES
  ('moderation-sweep-10min', '30 minutes',
   $q$SELECT max(run_at) FROM public.moderation_sweep_runs WHERE succeeded$q$,
   'moderation-sweep edge fn; output row per run in moderation_sweep_runs'),
  ('expire-stale-bounty-requests', '45 minutes', NULL,
   'expire-bounty-requests edge fn; writes job_health heartbeat after fn_expire_bounty_requests'),
  ('stripe-payout-reconciliation-15min', '45 minutes',
   $q$SELECT max(run_at) FROM public.reconciliation_reports WHERE error IS NULL$q$,
   'reconciliation edge fn (15-min job and reconciliation-invariant-sweep-daily both write reconciliation_reports)'),
  ('stripe-balance-reconciliation-hourly', '3 hours',
   $q$SELECT max(captured_at) FROM public.stripe_balance_snapshots$q$,
   'admin-withdrawals run_stripe_balance_sync; writes stripe_balance_snapshots every run'),
  ('drain-notifications-outbox', '15 minutes',
   $q$SELECT COALESCE(min(created_at), now()) FROM public.notifications_outbox
      WHERE status <> 'sent' AND created_at > now() - interval '7 days'$q$,
   'process-notification queue: stale if any row from the last 7 days is still unsent (p99 send latency is ~17s)'),
  ('drain-analytics-person-outbox', '15 minutes',
   $q$SELECT COALESCE(min(updated_at), now()) FROM public.analytics_person_outbox
      WHERE status <> 'sent' AND updated_at > now() - interval '7 days'$q$,
   'process-analytics-person queue: stale if any row touched in the last 7 days is still unsent (includes dead-lettered attempts>=5)'),
  ('escalate-stale-bounty-liquidity', '60 minutes', NULL, 'SQL job; heartbeat appended to cron command'),
  ('remind-pending-hunter-ratings', '45 minutes', NULL, 'SQL job; heartbeat appended to cron command'),
  ('remind-posters-of-pending-requests', '45 minutes', NULL, 'SQL job; heartbeat appended to cron command'),
  ('daily-risk-assessment', '72 hours', NULL, 'SQL job; heartbeat appended to cron command'),
  ('reconciliation-findings-digest', '72 hours', NULL,
   'SQL job; heartbeat appended to cron command. NOTE fn_digest_unresolved_findings swallows its own exceptions, so this proves it ran, not that it succeeded'),
  ('withdrawal-reconciliation-daily', '72 hours', NULL, 'SQL job; heartbeat appended to cron command'),
  ('cron-run-failures', '1 second',
   $q$SELECT COALESCE(min(start_time), now()) FROM cron.job_run_details
      WHERE status = 'failed' AND start_time > now() - interval '1 hour'$q$,
   'any pg_cron run that errored in the last hour'),
  ('edge-auth-or-5xx', '1 second',
   $q$SELECT COALESCE(min(created), now()) FROM net._http_response
      WHERE created > now() - interval '1 hour'
        AND (status_code IN (401, 403) OR status_code >= 500 OR timed_out OR error_msg IS NOT NULL)$q$,
   'catch-all: any pg_net call in the last hour rejected on auth, 5xx, or failed at transport (attribution: check net._http_response bodies)')
ON CONFLICT (job_name) DO UPDATE
  SET max_silence = EXCLUDED.max_silence, probe_sql = EXCLUDED.probe_sql, description = EXCLUDED.description;

-- ---------------------------------------------------------------------------
-- 7. Heartbeats for SQL-only jobs. pg_cron runs the command as one implicit
--    transaction, so the heartbeat only commits if the job function did.
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  v_expected text[] := ARRAY['escalate-stale-bounty-liquidity', 'remind-pending-hunter-ratings',
                             'remind-posters-of-pending-requests', 'daily-risk-assessment',
                             'reconciliation-findings-digest', 'withdrawal-reconciliation-daily'];
  v_missing  text[];
  v_altered  integer := 0;
  j          record;
BEGIN
  -- Fail loudly on a missing job rather than silently skipping it.
  SELECT array_agg(n) INTO v_missing
  FROM unnest(v_expected) AS n
  WHERE NOT EXISTS (SELECT 1 FROM cron.job j WHERE j.jobname = n);
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'cron job(s) not found, cannot append heartbeat: %', v_missing;
  END IF;

  FOR j IN
    SELECT cj.jobid, cj.jobname, v.fn
    FROM cron.job cj
    JOIN (VALUES
      ('escalate-stale-bounty-liquidity',    'public.fn_escalate_stale_bounty_liquidity()'),
      ('remind-pending-hunter-ratings',      'public.fn_remind_pending_hunter_ratings()'),
      ('remind-posters-of-pending-requests', 'public.fn_remind_posters_of_pending_requests()'),
      ('daily-risk-assessment',              'public.run_periodic_risk_assessments()'),
      ('reconciliation-findings-digest',     'public.fn_digest_unresolved_findings()'),
      ('withdrawal-reconciliation-daily',    'public.run_withdrawal_reconciliation()')
    ) AS v(jobname, fn) ON v.jobname = cj.jobname
  LOOP
    PERFORM cron.alter_job(j.jobid, command := format(
      'SELECT %s; SELECT public.record_job_heartbeat(%L);', j.fn, j.jobname));
    v_altered := v_altered + 1;
  END LOOP;

  IF v_altered <> array_length(v_expected, 1) THEN
    RAISE EXCEPTION 'expected to append heartbeats to % cron jobs, altered %', array_length(v_expected, 1), v_altered;
  END IF;
END
$do$;

-- ---------------------------------------------------------------------------
-- 8. Retention. job_health gains ~250 rows/day at current schedules; 30 days
--    (~7.5k rows) is ample for "when did this last work" and trend checks.
--    Resolved ops_alerts are kept 180 days as an incident history; open
--    alerts are never pruned. The pruner heartbeats like any other job.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 9. Schedule the checker and the pruner.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname IN ('job-health-check-5min', 'job-health-retention-daily');
END $$;
SELECT cron.schedule('job-health-check-5min', '*/5 * * * *', $$SELECT count(*) FROM public.fn_check_job_health();$$);
SELECT cron.schedule('job-health-retention-daily', '17 4 * * *',
  $$SELECT public.fn_prune_job_health(); SELECT public.record_job_heartbeat('job-health-retention-daily');$$);

COMMIT;
