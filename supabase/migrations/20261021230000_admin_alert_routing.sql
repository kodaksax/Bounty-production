-- Admin alert routing, attribution, and acknowledge/resolve.
--
-- WHAT WAS WRONG (production evidence, 2026-10-05 -> 10-21):
--
-- 1. Who gets paged was "every auth user whose app_metadata.role is admin"
--    (fn_admin_recipient_ids, moderation_admin_recipients). Granting the admin
--    role for access (kocher.daniel, 2026-09-03, admin_action_log role_change)
--    silently made that account an alert recipient too: no push token, never
--    signed in again, so every moderation/reconciliation alert logged a
--    notification_failed for it. The internal admin's copies were delivered
--    (push + email) the whole time; the failures were all the second address.
--    Access and paging are now separate: admin_recipients is the paging list.
--
-- 2. The ops alert `edge-auth-or-5xx` opened ~20 times a day from 2026-10-18
--    23:20 UTC. Cause: the dashboard Database Webhook `Push_noti_manager` on
--    notifications_outbox posts every new row to process-notification with a
--    hard-coded legacy service_role JWT. PR #914 (deployed 10-18) made
--    process-notification accept only `Bearer <runtime service key>`, which is
--    now the sb_secret_ key, so every webhook call got 401 {"error":
--    "Unauthorized"} (57 in 24h on 10-21, all from pg_net). Notifications still
--    went out because drain-notifications-outbox (vault key) retries every
--    minute. The alert then fed itself: its own "[Ops] failing" and
--    "Recovered" notifications inserted outbox rows, whose webhook 401s
--    re-opened it 5 minutes after every recovery (the ~65 min cycle).
--    Section 4 replaces the webhook with a trigger that uses the vault key.
--
-- 3. An ops alert closed itself when the probe next passed, so a flapping
--    cause produced an open+close pair of pages per cycle and nothing ever
--    required a human. Alerts now stay open until a person resolves them,
--    re-notify every 24h unless acknowledged, and record when the condition
--    cleared instead of paging "Recovered".
--
-- Email for critical/high alerts goes straight to send-notification-email
-- (fn_notify_admins), so it never depends on a push token, a notification
-- preference, or process-notification. The outbox row it also writes carries
-- emailDispatched=true so process-notification does not email a second time.
--
-- Observable afterwards: admin_alert_deliveries rows with email_request_id set;
-- net._http_response for those ids returning 200 with "sent":1; ops_http_requests
-- rows labelled notifications_outbox_dispatch whose responses are 2xx.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The paging list
-- ---------------------------------------------------------------------------
-- Owner-managed (SQL editor / migrations). Admins can read it, nobody writes
-- it through the API: an admin role is for access, this list is for paging,
-- and being able to add yourself to one should not follow from the other.
CREATE TABLE IF NOT EXISTS public.admin_recipients (
  user_id      uuid        PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  -- Lowest alert severity this person is paged for.
  min_severity text        NOT NULL DEFAULT 'medium'
                           CHECK (min_severity IN ('critical', 'high', 'medium', 'low')),
  enabled      boolean     NOT NULL DEFAULT true,
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.admin_recipients IS
  'Who is paged for operator alerts (moderation, reconciliation, ops/job health, trust review). Independent of the admin role: add or disable rows here. Critical/high alerts go by email AND push.';

ALTER TABLE public.admin_recipients ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_recipients FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.admin_recipients TO authenticated;
DROP POLICY IF EXISTS admin_recipients_admin_read ON public.admin_recipients;
CREATE POLICY admin_recipients_admin_read ON public.admin_recipients
  FOR SELECT TO authenticated USING ((SELECT public.is_admin()));

-- Seed with exactly the people the ops-alert checker already pages: admins
-- who are internal accounts. In production that is one account; the external
-- admin is deliberately left out (access unchanged, just not paged).
INSERT INTO public.admin_recipients (user_id, note)
SELECT u.id, 'seeded 20261021230000 from internal admins'
FROM auth.users u
JOIN public.profiles p ON p.id = u.id
WHERE u.raw_app_meta_data ->> 'role' = 'admin'
  AND p.is_internal
ON CONFLICT (user_id) DO NOTHING;

-- Alert vocabularies differ by producer (moderation: critical/high/medium,
-- findings: critical/warning/info). An unknown severity ranks as high so a
-- typo pages rather than going quiet.
CREATE OR REPLACE FUNCTION public.fn_alert_severity_rank(p_severity text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE lower(COALESCE(p_severity, ''))
    WHEN 'critical' THEN 4
    WHEN 'high'     THEN 3
    WHEN 'medium'   THEN 2
    WHEN 'warning'  THEN 2
    WHEN 'low'      THEN 1
    WHEN 'info'     THEN 1
    ELSE 3
  END;
$$;

CREATE OR REPLACE FUNCTION public.fn_admin_recipients_for(p_severity text)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(r.user_id ORDER BY r.created_at), '{}'::uuid[])
  FROM public.admin_recipients r
  -- process-notification resolves recipients through profiles/push_tokens.
  JOIN public.profiles p ON p.id = r.user_id
  WHERE r.enabled
    AND public.fn_alert_severity_rank(p_severity) >= public.fn_alert_severity_rank(r.min_severity);
$$;

-- Existing callers (the daily reconciliation digest) keep their signature and
-- now read the list instead of the admin role: everyone enabled, whatever
-- their min_severity, which is who received the digest before.
CREATE OR REPLACE FUNCTION public.fn_admin_recipient_ids()
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(r.user_id ORDER BY r.created_at), '{}'::uuid[])
  FROM public.admin_recipients r
  JOIN public.profiles p ON p.id = r.user_id
  WHERE r.enabled;
$$;

COMMENT ON FUNCTION public.fn_admin_recipient_ids IS
  'Every enabled admin_recipients row. Paging is decided by admin_recipients, not by the admin role.';

-- Read by the moderation-sweep build deployed before this change.
CREATE OR REPLACE FUNCTION public.moderation_admin_recipients()
RETURNS TABLE (user_id uuid, email text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT u.id, u.email::text
  FROM public.admin_recipients r
  JOIN auth.users u ON u.id = r.user_id
  WHERE r.enabled
    AND u.deleted_at IS NULL;
$$;

REVOKE ALL ON FUNCTION public.fn_alert_severity_rank(text)  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_admin_recipients_for(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_admin_recipient_ids()      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.moderation_admin_recipients() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_admin_recipients_for(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_admin_recipient_ids()      TO service_role;
GRANT EXECUTE ON FUNCTION public.moderation_admin_recipients() TO service_role;

-- ---------------------------------------------------------------------------
-- 2. Delivery records
-- ---------------------------------------------------------------------------
-- pg_net keeps no URL with a response, so a failing call cannot be attributed
-- after the fact. Callers we own record what each request was for.
CREATE TABLE IF NOT EXISTS public.ops_http_requests (
  request_id bigint      PRIMARY KEY,
  caller     text        NOT NULL,
  target     text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ops_http_requests_created_idx ON public.ops_http_requests (created_at);

-- One row per admin alert dispatched (or not), so "was anyone told" is a query.
CREATE TABLE IF NOT EXISTS public.admin_alert_deliveries (
  id                   bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at           timestamptz NOT NULL DEFAULT now(),
  alert_type           text        NOT NULL,
  severity             text        NOT NULL,
  title                text        NOT NULL,
  recipients           uuid[]      NOT NULL,
  outbox_id            uuid,
  email_request_id     bigint,
  -- NULL when the email was queued.
  email_skipped_reason text
);
CREATE INDEX IF NOT EXISTS admin_alert_deliveries_created_idx ON public.admin_alert_deliveries (created_at DESC);

ALTER TABLE public.ops_http_requests      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_alert_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ops_http_requests, public.admin_alert_deliveries FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.admin_alert_deliveries TO authenticated;
DROP POLICY IF EXISTS admin_alert_deliveries_admin_read ON public.admin_alert_deliveries;
CREATE POLICY admin_alert_deliveries_admin_read ON public.admin_alert_deliveries
  FOR SELECT TO authenticated USING ((SELECT public.is_admin()));

-- ---------------------------------------------------------------------------
-- 3. One way to page admins
-- ---------------------------------------------------------------------------
-- Writes one outbox row (push + in-app via process-notification) and, for
-- critical/high, emails directly. The email is a pg_net call to
-- send-notification-email with the vault service key: the same credential the
-- outbox drain uses, so if email is broken, notification delivery is broken
-- too and edge-auth-or-5xx says so. Without vault secrets the outbox row goes
-- out with emailDispatched=false and process-notification's normal email
-- fan-out covers it.
CREATE OR REPLACE FUNCTION public.fn_notify_admins(
  p_type      text,
  p_severity  text,
  p_title     text,
  p_body      text,
  p_data      jsonb DEFAULT '{}'::jsonb,
  p_bounty_id uuid  DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recipients uuid[] := public.fn_admin_recipients_for(p_severity);
  v_url        text;
  v_key        text;
  v_request    bigint;
  v_outbox     uuid;
  v_skip       text;
  v_data       jsonb;
BEGIN
  IF COALESCE(array_length(v_recipients, 1), 0) = 0 THEN
    RAISE WARNING 'fn_notify_admins: no admin_recipients row accepts severity % for "%"; nobody was notified',
      p_severity, p_title;
    INSERT INTO public.admin_alert_deliveries (alert_type, severity, title, recipients, email_skipped_reason)
    VALUES (p_type, COALESCE(p_severity, 'unknown'), p_title, '{}'::uuid[], 'no_recipients');
    RETURN jsonb_build_object('recipients', 0);
  END IF;

  -- The producer's own keys first; type/severity are ours and always win.
  v_data := COALESCE(p_data, '{}'::jsonb)
         || jsonb_build_object('type', p_type, 'severity', p_severity, 'adminAlert', true);

  IF public.fn_alert_severity_rank(p_severity) >= 3 THEN
    SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL';
    SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY';
    IF v_url IS NULL OR v_key IS NULL THEN
      v_skip := 'vault_missing';
    ELSE
      v_request := net.http_post(
        url     := v_url || '/functions/v1/send-notification-email',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
        body    := jsonb_build_object('userIds', to_jsonb(v_recipients), 'category', 'security',
                                      'type', p_type, 'title', p_title, 'body', p_body, 'data', v_data),
        timeout_milliseconds := 20000
      );
      INSERT INTO public.ops_http_requests (request_id, caller, target)
      VALUES (v_request, 'fn_notify_admins', 'send-notification-email');
    END IF;
  ELSE
    v_skip := 'below_email_severity';
  END IF;

  INSERT INTO public.notifications_outbox (recipients, title, body, data, bounty_id)
  VALUES (to_jsonb(v_recipients), p_title, p_body,
          v_data || jsonb_build_object('emailDispatched', v_request IS NOT NULL), p_bounty_id)
  RETURNING id INTO v_outbox;

  INSERT INTO public.admin_alert_deliveries
    (alert_type, severity, title, recipients, outbox_id, email_request_id, email_skipped_reason)
  VALUES (p_type, COALESCE(p_severity, 'unknown'), p_title, v_recipients, v_outbox, v_request, v_skip);

  RETURN jsonb_build_object('recipients', array_length(v_recipients, 1),
                            'outbox_id', v_outbox, 'email_request_id', v_request);
END;
$$;
REVOKE ALL ON FUNCTION public.fn_notify_admins(text, text, text, text, jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_notify_admins(text, text, text, text, jsonb, uuid) TO service_role;

-- Critical reconciliation findings: same coalescing as before, now through
-- the list and with a guaranteed email.
CREATE OR REPLACE FUNCTION public.fn_alert_on_critical_finding()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_subject text;
  v_result  jsonb;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.reconciliation_alerts_sent
    WHERE finding_type = NEW.finding_type
      AND sent_at > now() - INTERVAL '1 hour'
  ) THEN
    RETURN NULL;
  END IF;

  v_subject := COALESCE(
    NEW.details->>'transaction_id',
    NEW.details->>'payout_id',
    NEW.user_id::text,
    'see finding details'
  );

  v_result := public.fn_notify_admins(
    'reconciliation_alert', 'critical',
    'Critical reconciliation finding',
    NEW.finding_type || ' — ' || v_subject,
    jsonb_build_object(
      'finding_id',       NEW.id,
      'finding_type',     NEW.finding_type,
      'finding_severity', NEW.severity,
      'details',          NEW.details
    )
  );

  IF COALESCE((v_result ->> 'recipients')::int, 0) = 0 THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.reconciliation_alerts_sent (finding_type, finding_id)
  VALUES (NEW.finding_type, NEW.id);

  RETURN NULL;

EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'fn_alert_on_critical_finding failed for finding %: %', NEW.id, SQLERRM;
  RETURN NULL;
END;
$function$;

-- Support/trust-review pages (disputes, review-window escalations).
CREATE OR REPLACE FUNCTION public.fn_trust_review_page_admins(p_title text, p_body text, p_data jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public.fn_notify_admins(
    'reconciliation_alert', 'high', p_title, p_body,
    jsonb_build_object('ops_alert', true, 'trust_review', true) || COALESCE(p_data, '{}'::jsonb)
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_trust_review_page_admins(text, text, jsonb) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Outbox dispatch with a credential that works
-- ---------------------------------------------------------------------------
-- Replaces the dashboard webhook Push_noti_manager (same timing: AFTER INSERT,
-- one call per row) but reads the vault key like drain_notifications_outbox,
-- and keeps no credential in the trigger definition. If the call fails the
-- drain delivers the row within a minute, as it has since 10-18.
CREATE OR REPLACE FUNCTION public.fn_dispatch_notification_outbox()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url     text;
  v_key     text;
  v_request bigint;
BEGIN
  SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL';
  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY';
  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE WARNING 'fn_dispatch_notification_outbox: vault SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing; % waits for the drain', NEW.id;
    RETURN NULL;
  END IF;

  v_request := net.http_post(
    url     := v_url || '/functions/v1/process-notification',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body    := jsonb_build_object('id', NEW.id),
    timeout_milliseconds := 30000
  );
  INSERT INTO public.ops_http_requests (request_id, caller, target)
  VALUES (v_request, 'notifications_outbox_dispatch', 'process-notification');
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'fn_dispatch_notification_outbox failed for %: %; the drain will deliver it', NEW.id, SQLERRM;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_dispatch_notification_outbox() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS "Push_noti_manager" ON public.notifications_outbox;
-- Staging's untracked twin (-> notify_process_notification). Left in place it
-- would dispatch every row a second time. Its function is not dropped.
DROP TRIGGER IF EXISTS push_noti_manager ON public.notifications_outbox;
DROP TRIGGER IF EXISTS notifications_outbox_dispatch ON public.notifications_outbox;
CREATE TRIGGER notifications_outbox_dispatch
  AFTER INSERT ON public.notifications_outbox
  FOR EACH ROW EXECUTE FUNCTION public.fn_dispatch_notification_outbox();

-- The drain, unchanged except that its requests are labelled.
CREATE OR REPLACE FUNCTION public.drain_notifications_outbox()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_url text;
  v_key text;
  v_request bigint;
  r record;
begin
  select decrypted_secret into v_url
    from vault.decrypted_secrets where name = 'SUPABASE_URL';
  select decrypted_secret into v_key
    from vault.decrypted_secrets where name = 'SUPABASE_SERVICE_ROLE_KEY';

  if v_url is null or v_key is null then
    raise warning 'drain_notifications_outbox: missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in vault';
    return;
  end if;

  for r in
    select id
    from public.notifications_outbox
    where (status = 'pending' or (status = 'failed' and attempts < 5))
      and (scheduled_at is null or scheduled_at <= now())
    order by created_at
    limit 100
  loop
    v_request := net.http_post(
      url     := v_url || '/functions/v1/process-notification',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_key
      ),
      body    := jsonb_build_object('id', r.id)
    );
    insert into public.ops_http_requests (request_id, caller, target)
    values (v_request, 'drain_notifications_outbox', 'process-notification');

    update public.notifications_outbox
      set scheduled_at = now() + interval '2 minutes'
      where id = r.id;
  end loop;
end;
$function$;
REVOKE ALL ON FUNCTION public.drain_notifications_outbox() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.drain_notifications_outbox() TO service_role;

-- ---------------------------------------------------------------------------
-- 5. Ops alerts: a person closes them
-- ---------------------------------------------------------------------------
ALTER TABLE public.ops_alerts
  ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz,
  ADD COLUMN IF NOT EXISTS acknowledged_by uuid,
  ADD COLUMN IF NOT EXISTS resolved_by     uuid,
  ADD COLUMN IF NOT EXISTS resolution_note text,
  -- When the probe last went healthy while the alert stayed open. NULL while
  -- the condition is still failing.
  ADD COLUMN IF NOT EXISTS cleared_at      timestamptz,
  -- How many times the condition (re)appeared while this alert was open.
  ADD COLUMN IF NOT EXISTS occurrences     integer NOT NULL DEFAULT 1;

-- Optional per-expectation attribution: a query returning one jsonb, run when
-- the probe fails. Its `headline` is appended to the alert summary. Same trust
-- model as probe_sql (owner-only table, EXECUTEd by the definer checker).
ALTER TABLE public.job_health_expectations ADD COLUMN IF NOT EXISTS detail_sql text;

CREATE OR REPLACE FUNCTION public.fn_page_ops_alert(p_alert public.ops_alerts, p_reminder boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_title  text;
  v_body   text;
  v_result jsonb;
BEGIN
  IF p_reminder THEN
    v_title := '[Ops] Still open: ' || p_alert.alert_key;
    v_body  := p_alert.summary || format(' — open since %s, %s.',
                 to_char(p_alert.opened_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI "UTC"'),
                 CASE WHEN p_alert.cleared_at IS NULL THEN 'still failing'
                      ELSE 'condition cleared ' || to_char(p_alert.cleared_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI "UTC"') END);
  ELSE
    v_title := '[Ops] Failing: ' || p_alert.alert_key;
    v_body  := p_alert.summary;
  END IF;
  v_body := v_body || ' Acknowledge or resolve it in Admin > Command Center.';

  v_result := public.fn_notify_admins(
    'reconciliation_alert', p_alert.severity, v_title, v_body,
    jsonb_build_object('ops_alert', true, 'alertKey', p_alert.alert_key,
                       'alertId', p_alert.id, 'reminder', p_reminder)
  );

  -- Stamped even when nobody was on the list, so an empty list costs one
  -- warning a day per alert rather than one every five minutes.
  UPDATE public.ops_alerts
     SET last_notified_at = now(),
         notify_count = notify_count + CASE WHEN COALESCE((v_result ->> 'recipients')::int, 0) > 0 THEN 1 ELSE 0 END
   WHERE id = p_alert.id;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_page_ops_alert(public.ops_alerts, boolean) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_check_job_health()
RETURNS TABLE (job_name text, last_ok timestamptz, max_silence interval, healthy boolean, probe_error text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
#variable_conflict use_column
DECLARE
  r         record;
  v_last    timestamptz;
  v_err     text;
  v_healthy boolean;
  v_alert   public.ops_alerts%ROWTYPE;
  v_summary text;
  v_cause   jsonb;
BEGIN
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

      v_cause := NULL;
      IF r.detail_sql IS NOT NULL THEN
        BEGIN
          EXECUTE r.detail_sql INTO v_cause;
        EXCEPTION WHEN OTHERS THEN
          v_cause := jsonb_build_object('detail_error', SQLERRM);
        END;
        IF v_cause ->> 'headline' IS NOT NULL THEN
          v_summary := v_summary || ' | cause: ' || (v_cause ->> 'headline');
        END IF;
      END IF;

      INSERT INTO public.ops_alerts (alert_key, summary, detail)
      VALUES (r.job_name, v_summary,
              jsonb_strip_nulls(jsonb_build_object(
                'last_ok', v_last, 'max_silence', r.max_silence::text,
                'probe_error', v_err, 'description', r.description, 'cause', v_cause)))
      ON CONFLICT (alert_key) WHERE resolved_at IS NULL
      DO UPDATE SET last_seen_at = now(),
                    summary      = EXCLUDED.summary,
                    detail       = EXCLUDED.detail,
                    occurrences  = ops_alerts.occurrences
                                   + CASE WHEN ops_alerts.cleared_at IS NOT NULL THEN 1 ELSE 0 END,
                    cleared_at   = NULL
      RETURNING * INTO v_alert;

      -- Page once when the alert opens. Repeats come from the reminder pass.
      IF v_alert.last_notified_at IS NULL THEN
        PERFORM public.fn_page_ops_alert(v_alert, false);
      END IF;
    ELSE
      -- Healthy again: note it, page nobody, leave it for a person to resolve.
      UPDATE public.ops_alerts a SET cleared_at = now()
       WHERE a.alert_key = r.job_name AND a.resolved_at IS NULL AND a.cleared_at IS NULL;
    END IF;

    job_name    := r.job_name;
    last_ok     := v_last;
    max_silence := r.max_silence;
    healthy     := v_healthy;
    probe_error := v_err;
    RETURN NEXT;
  END LOOP;

  -- Every open alert re-notifies 24h after the last page, unless someone
  -- acknowledged it within the last 24h.
  FOR v_alert IN
    SELECT * FROM public.ops_alerts a
     WHERE a.resolved_at IS NULL
       AND a.last_notified_at < now() - interval '24 hours'
       AND (a.acknowledged_at IS NULL OR a.acknowledged_at < now() - interval '24 hours')
     ORDER BY a.opened_at
  LOOP
    PERFORM public.fn_page_ops_alert(v_alert, true);
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_check_job_health() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_check_job_health() FROM anon, authenticated;

-- Acknowledge = "I have it": silences the 24h reminder for 24h.
CREATE OR REPLACE FUNCTION public.admin_ack_ops_alert(p_alert_id uuid)
RETURNS public.ops_alerts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v public.ops_alerts%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE = '42501';
  END IF;
  UPDATE public.ops_alerts
     SET acknowledged_at = now(), acknowledged_by = auth.uid()
   WHERE id = p_alert_id AND resolved_at IS NULL
  RETURNING * INTO v;
  IF v.id IS NULL THEN
    RAISE EXCEPTION 'ops alert % is not open', p_alert_id USING ERRCODE = 'P0002';
  END IF;
  RETURN v;
END;
$$;

-- Resolve = "fixed". If the condition is still failing, the next check (within
-- 5 minutes) opens a new alert and pages again.
CREATE OR REPLACE FUNCTION public.admin_resolve_ops_alert(p_alert_id uuid, p_note text)
RETURNS public.ops_alerts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v public.ops_alerts%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(btrim(COALESCE(p_note, '')), '') IS NULL THEN
    RAISE EXCEPTION 'a resolution note is required' USING ERRCODE = '22023';
  END IF;
  UPDATE public.ops_alerts
     SET resolved_at = now(), resolved_by = auth.uid(), resolution_note = btrim(p_note)
   WHERE id = p_alert_id AND resolved_at IS NULL
  RETURNING * INTO v;
  IF v.id IS NULL THEN
    RAISE EXCEPTION 'ops alert % is not open', p_alert_id USING ERRCODE = 'P0002';
  END IF;
  RETURN v;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_ack_ops_alert(uuid)           FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_resolve_ops_alert(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_ack_ops_alert(uuid)           TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_resolve_ops_alert(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. edge-auth-or-5xx says what failed
-- ---------------------------------------------------------------------------
-- Groups the last hour's non-2xx pg_net responses by target, caller, status
-- and body. Labelled requests (ops_http_requests) name their function; for
-- the rest it lists the HTTP cron jobs that started within 60s before each
-- failure, which is as far as pg_net's data reaches.
DO $do$
DECLARE
  v_n integer;
BEGIN
  UPDATE public.job_health_expectations
     SET detail_sql = $q$
WITH bad AS (
  SELECT r.id, r.created, r.status_code, COALESCE(r.timed_out, false) AS timed_out,
         left(COALESCE(r.error_msg, r.content::text, ''), 160) AS body,
         l.caller, l.target
  FROM net._http_response r
  LEFT JOIN public.ops_http_requests l ON l.request_id = r.id
  WHERE r.created > now() - interval '1 hour'
    AND (r.status_code IN (401, 403) OR r.status_code >= 500 OR r.timed_out OR r.error_msg IS NOT NULL)
), grp AS (
  SELECT COALESCE(target, 'unlabelled') AS target, COALESCE(caller, 'unlabelled') AS caller,
         COALESCE(status_code::text, CASE WHEN timed_out THEN 'timeout' ELSE 'transport' END) AS status,
         body, count(*) AS n, max(created) AS last_at
  FROM bad GROUP BY 1, 2, 3, 4
  ORDER BY n DESC, last_at DESC
  LIMIT 5
), suspects AS (
  SELECT j.jobname, count(DISTINCT b.id) AS failures
  FROM bad b
  JOIN cron.job_run_details d ON d.start_time BETWEEN b.created - interval '60 seconds' AND b.created
  JOIN cron.job j ON j.jobid = d.jobid
  WHERE b.caller IS NULL AND j.command ILIKE '%http_post%'
  GROUP BY j.jobname
  ORDER BY failures DESC
  LIMIT 5
)
SELECT jsonb_build_object(
  'headline', (SELECT format('%s x %s from %s: %s', g.n, g.status,
                             CASE WHEN g.target = 'unlabelled' THEN 'an unlabelled caller'
                                  ELSE g.target || ' (via ' || g.caller || ')' END,
                             g.body)
               FROM grp g LIMIT 1),
  'kind', (SELECT CASE
             -- COALESCE: bool_and skips NULLs, and a timeout has no status.
             WHEN bool_and(COALESCE(status_code IN (401, 403), false)) THEN 'auth'
             WHEN bool_and(COALESCE(status_code >= 500, false))        THEN '5xx'
             WHEN bool_and(status_code IS NULL)                        THEN 'transport'
             ELSE 'mixed' END FROM bad),
  'failures', (SELECT count(*) FROM bad),
  'groups', (SELECT jsonb_agg(to_jsonb(g)) FROM grp g),
  'cron_suspects', (SELECT jsonb_agg(to_jsonb(s)) FROM suspects s)
)
$q$,
         description = 'catch-all: any pg_net call in the last hour rejected on auth, 5xx, or failed at transport. detail.cause groups them by target, status and body.'
   WHERE job_name = 'edge-auth-or-5xx';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'expected to update the edge-auth-or-5xx expectation, updated % rows', v_n;
  END IF;
END
$do$;

-- ---------------------------------------------------------------------------
-- 6b. The other source of edge-auth-or-5xx: money-sync calls outliving pg_net
-- ---------------------------------------------------------------------------
-- The opens before 10-18 (and 10-21 18:00) were pg_net transport timeouts, not
-- failures: admin-withdrawals (hourly balance sync) returned 200 after 42-67s
-- and reconciliation after up to 55.6s, against a 55s pg_net timeout. The
-- functions finished; pg_net had already recorded "Timeout of 55000 ms". Give
-- these jobs 150s: the platform's request idle timeout (it returns 504 itself
-- after 150s), so pg_net never gives up on a call that can still succeed.
DO $do$
DECLARE
  j record;
BEGIN
  FOR j IN
    SELECT jobid, jobname, command FROM cron.job
     WHERE jobname IN ('stripe-balance-reconciliation-hourly', 'stripe-payout-reconciliation-15min',
                       'reconciliation-invariant-sweep-daily')
  LOOP
    IF j.command !~ 'timeout_milliseconds\s*:=\s*\d+' THEN
      RAISE EXCEPTION 'cron job % has no timeout_milliseconds to raise', j.jobname;
    END IF;
    PERFORM cron.alter_job(j.jobid, command := regexp_replace(
      j.command, 'timeout_milliseconds\s*:=\s*\d+', 'timeout_milliseconds := 150000'));
    RAISE NOTICE 'cron job %: pg_net timeout raised to 150s', j.jobname;
  END LOOP;
END
$do$;

-- ---------------------------------------------------------------------------
-- 7. Retention
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_prune_job_health()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  DELETE FROM public.job_health             WHERE beat_at      < now() - interval '30 days';
  DELETE FROM public.ops_smoke_checks       WHERE requested_at < now() - interval '30 days';
  DELETE FROM public.ops_alerts             WHERE resolved_at  < now() - interval '180 days';
  -- pg_net keeps responses ~6h; labels older than that attribute nothing.
  DELETE FROM public.ops_http_requests      WHERE created_at   < now() - interval '2 days';
  DELETE FROM public.admin_alert_deliveries WHERE created_at   < now() - interval '180 days';
$$;
REVOKE ALL ON FUNCTION public.fn_prune_job_health() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_prune_job_health() FROM anon, authenticated;

UPDATE public.job_health_expectations
   SET description = 'prunes job_health/ops_smoke_checks (30d), ops_http_requests (2d), resolved ops_alerts and admin_alert_deliveries (180d)'
 WHERE job_name = 'job-health-retention-daily';

COMMIT;
