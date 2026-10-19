-- =====================================================================
-- SBA-09: one closure digest per hunter per day instead of one notice per
-- application.
--
-- Problem (Shoal behavioral audit, 2026-10-15): every auto-closed application
-- sent its own push, and some sent an email too. In 60 days, 289
-- application_expired and 172 application_bounty_closed notices went out
-- against 17 acceptances. 92 hunter-days had more than one, the worst had 10,
-- and some hunters got 5-6 expiry emails in one day.
--
-- Three producers queue these notices, all as one-recipient
-- notifications_outbox rows (checked on production 2026-10-19; no other
-- function writes either type):
--   * fn_expire_bounty_requests              application_expired (no_response)
--   * fn_sweep_absent_posters                application_expired (poster_absent)
--   * fn_reject_pending_requests_on_bounty_close  application_bounty_closed
--
-- WHAT THIS DOES
--   1. Hold. A BEFORE INSERT trigger on notifications_outbox takes every
--      application_expired / application_bounty_closed row before
--      Push_noti_manager (AFTER INSERT) can send it, and returns NULL so the
--      row is never stored and never pushed or emailed. For each one it:
--        * records the closure in hunter_closure_items, and
--        * writes the in-app notifications row itself, already read
--          (data.heldForDigest = true), so the list still shows what
--          happened to each application without adding to the unread badge.
--          Product decision 2026-10-19: per-closure rows stay, silently.
--      No producer function is changed, so this covers all three, whatever
--      their live bodies are. If recording fails, the trigger lets the row
--      through unchanged. A notice sent the old way beats a lost one, and the
--      producers' own UPDATEs must never fail because of this.
--      The held row drops data.requestId but keeps applicationId: the action
--      sheet shows the poster's Decline / Review & Accept buttons for any
--      marketplace row that has a requestId, and showed them to hunters on
--      their own closed applications.
--   2. Digest. fn_send_hunter_closure_digests() runs hourly. For each hunter
--      with undigested closures whose local time is past 17:00 (product
--      decision 2026-10-19), it queues ONE outbox row of type
--      application_closure_digest: "N of your applications closed", up to two
--      titles, the not-a-rejection line, and up to three live alternatives.
--      process-notification then applies channel preferences and quiet hours
--      exactly as for any other notice, and adds the one unread in-app row.
--      Email goes only when push can't reach the hunter, one per digest
--      (product decision 2026-10-19; process-notification email-fallback.ts).
--        * Local time: profiles.notification_timezone when it names a real
--          zone, else America/Chicago. On 2026-10-19 no production profile
--          had a timezone.
--        * At most one per local day (UNIQUE hunter_id, local_date) and never
--          within 20 hours of the previous one, which holds even if the
--          hunter changes timezone.
--        * Quiet hours: checked with the same rule as process-notification
--          (minutes since local midnight, ignored without a valid timezone).
--          A hunter in quiet hours is skipped this run; the next hourly run
--          after quiet hours end sends it, or the next day's does.
--   3. Alternatives must be real: open, unassigned, not stale, deadline not
--      passed, not a test listing, from an active external poster (not
--      internal, not deleted) who was active in the last 14 days. That uses
--      the same activity signals as fn_sweep_absent_posters. The hunter must
--      not already have applied, and the listing must pass
--      fn_bounty_distribution_gate (path closure_digest, stage 1, no
--      credibility required, the same rule as first-stage targeting).
--      Online jobs always qualify. In-person jobs need
--      fn_bounty_request_distance (SBA-02, the same snapped distance stamped
--      on applications) within the hunter's radius: their primary
--      hunter_service_areas row (radius NULL = "Anywhere"), or 25 mi when they
--      have none, the default For You radius (SBA-02). No location means no
--      in-person alternatives. Nearest in-person first, then online, newest
--      first. With none, the alternatives line is left out.
--
-- Payload (data, type application_closure_digest): digestId, closedCount,
-- items[] (requestId, bountyId, bountyTitle, type, reason, closedAt),
-- alternatives[] (bountyId, title, amount, workType), and bountyId = the
-- first alternative when there is one. Installed builds route a marketplace
-- row with bountyId to that bounty; without one, the sheet's View button does
-- nothing until the client change in the SBA-09 PR ships. There is no
-- top-level requestId, so the sheet shows no poster Accept/Decline buttons.
-- count = 1, so the title is not suffixed "(N)".
--
-- Deploy order: process-notification first (it knows the new type and
-- sends its email only as a fallback), then this migration. If this lands
-- first, the deployed version still delivers the digest but emails it to
-- everyone with email on: at most one email a day, but not the agreed rule.
--
-- Rollback (closures go back to one notice each, immediately):
--   SELECT cron.unschedule('hunter-closure-digest-hourly');
--   DELETE FROM public.job_health_expectations WHERE job_name = 'hunter-closure-digest-hourly';
--   DROP TRIGGER aa_hold_hunter_closure_notices ON public.notifications_outbox;
--   -- Optionally flush what is held: SELECT * FROM public.fn_send_hunter_closure_digests(false, 0);
--   -- The tables, functions and the widened CHECK constraints are harmless to keep.
--
-- DONE MEANS OBSERVED: in the 7 days after this is live on production, no
-- hunter gets more than one closure notification (push/email-capable outbox
-- row, or unread in-app row) in a day. Query: scripts/ops/closure-digest-weekly.sql.
-- =====================================================================

BEGIN;

-- ─── 0. Preconditions ───────────────────────────────────────────────────────
DO $$
DECLARE
  v_missing text;
BEGIN
  SELECT string_agg(o, ', ') INTO v_missing
  FROM (VALUES
          ('public.fn_bounty_request_distance(uuid,uuid)'),
          ('public.fn_bounty_distribution_gate(uuid,text,smallint,boolean)'),
          ('public.record_job_heartbeat(text,jsonb)')
       ) AS f(o)
  WHERE to_regprocedure(f.o) IS NULL;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'hunter closure digest: missing function(s): % (SBA-02 20261019200000 / anti-scam gate 20261001140000 / job health 20260925120000)', v_missing;
  END IF;

  SELECT string_agg(t, ', ') INTO v_missing
  FROM (VALUES ('public.notifications_outbox'), ('public.notifications'),
               ('public.notification_channel_preferences'), ('public.hunter_service_areas'),
               ('public.bounty_distribution_decisions'), ('public.job_health_expectations')) AS r(t)
  WHERE to_regclass(r.t) IS NULL;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'hunter closure digest: missing table(s): %', v_missing;
  END IF;
END $$;

-- ─── 1. Widen the CHECK constraints from their LIVE definitions ─────────────
-- Both lists have drifted between environments before, so the new value is
-- appended to whatever list is live instead of restating it here.
DO $$
DECLARE
  r      record;
  v_def  text;
  v_vals text[];
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public.notifications'::regclass,                  'notifications_type_check',               'type', 'application_closure_digest'),
      ('public.bounty_distribution_decisions'::regclass,  'bounty_distribution_decisions_path_check', 'path', 'closure_digest')
    ) AS t(rel, conname, col, val)
  LOOP
    SELECT pg_get_constraintdef(c.oid) INTO v_def
    FROM pg_constraint c WHERE c.conrelid = r.rel AND c.conname = r.conname AND c.contype = 'c';
    IF v_def IS NULL THEN
      RAISE EXCEPTION 'hunter closure digest: % has no CHECK constraint %', r.rel, r.conname;
    END IF;
    SELECT array_agg(m[1] ORDER BY ord) INTO v_vals
    FROM regexp_matches(v_def, '''([^'']+)''::text', 'g') WITH ORDINALITY AS x(m, ord);
    IF v_vals IS NULL OR cardinality(v_vals) = 0 THEN
      RAISE EXCEPTION 'hunter closure digest: could not read the values of % (%)', r.conname, v_def;
    END IF;
    CONTINUE WHEN r.val = ANY (v_vals);
    v_vals := v_vals || r.val;
    -- Re-emitted in the same ARRAY['a'::text, ...] form, so this parse (and
    -- any later one like it) still reads it.
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.rel, r.conname);
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I CHECK (%I = ANY (ARRAY[%s]))',
                   r.rel, r.conname, r.col,
                   (SELECT string_agg(quote_literal(v) || '::text', ', ' ORDER BY o)
                    FROM unnest(v_vals) WITH ORDINALITY AS u(v, o)));
  END LOOP;
END $$;

-- ─── 2. Ledgers ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.hunter_closure_digests (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  hunter_id              uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- The hunter's calendar day the digest belongs to, in time_zone.
  local_date             date        NOT NULL,
  time_zone              text        NOT NULL,
  item_count             integer     NOT NULL CHECK (item_count > 0),
  alternative_bounty_ids uuid[]      NOT NULL DEFAULT '{}',
  outbox_id              uuid,
  sent_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hunter_closure_digests_hunter_day_key UNIQUE (hunter_id, local_date)
);

COMMENT ON TABLE public.hunter_closure_digests IS
  'SBA-09. One row per closure digest queued to a hunter, at most one per local day (UNIQUE hunter_id, local_date). Written only by fn_send_hunter_closure_digests. Service-role only.';

CREATE INDEX IF NOT EXISTS hunter_closure_digests_hunter_sent_idx
  ON public.hunter_closure_digests (hunter_id, sent_at DESC);

CREATE TABLE IF NOT EXISTS public.hunter_closure_items (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  hunter_id         uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  notification_type text        NOT NULL CHECK (notification_type IN ('application_expired', 'application_bounty_closed')),
  -- data.reason from the producer (no_response, poster_absent); NULL for bounty closures.
  reason            text,
  request_id        uuid,
  bounty_id         uuid,
  bounty_title      text,
  -- The producer's own copy, as it would have been sent.
  title             text        NOT NULL DEFAULT '',
  body              text        NOT NULL DEFAULT '',
  data              jsonb       NOT NULL DEFAULT '{}'::jsonb,
  -- The silent in-app row; NULL when the hunter has in-app marketplace off.
  notification_id   uuid,
  closed_at         timestamptz NOT NULL DEFAULT now(),
  -- NULL until a digest covers it.
  digest_id         uuid        REFERENCES public.hunter_closure_digests(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.hunter_closure_items IS
  'SBA-09. One row per application_expired / application_bounty_closed notice held back from push and email by fn_hold_hunter_closure_notice. digest_id is set once fn_send_hunter_closure_digests reports it. Service-role only.';

-- A request closes once; a repeat notice for it is dropped.
CREATE UNIQUE INDEX IF NOT EXISTS hunter_closure_items_hunter_request_uidx
  ON public.hunter_closure_items (hunter_id, request_id) WHERE request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS hunter_closure_items_undigested_idx
  ON public.hunter_closure_items (hunter_id, closed_at) WHERE digest_id IS NULL;

-- Service-role only: RLS on with no policies, and explicit revokes (anon gets
-- auto-granted privileges on new tables; REVOKE FROM PUBLIC does not cover it).
ALTER TABLE public.hunter_closure_digests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hunter_closure_items   ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hunter_closure_digests FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.hunter_closure_items   FROM PUBLIC, anon, authenticated;

-- ─── 3. Hold closure notices ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_hold_hunter_closure_notice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog', 'pg_temp'
AS $$
DECLARE
  v_type    text := NEW.data ->> 'type';
  v_hunter  uuid;
  v_bounty  uuid;
  v_request uuid;
  v_title   text;
  v_item    uuid;
  v_notif   uuid;
BEGIN
  IF v_type IS NULL OR v_type NOT IN ('application_expired', 'application_bounty_closed') THEN
    RETURN NEW;
  END IF;
  -- Every producer addresses exactly one hunter. Anything else is not one of
  -- theirs and goes out as before.
  IF jsonb_typeof(NEW.recipients) IS DISTINCT FROM 'array' OR jsonb_array_length(NEW.recipients) <> 1 THEN
    RETURN NEW;
  END IF;

  BEGIN
    v_hunter  := (NEW.recipients ->> 0)::uuid;
    v_bounty  := NULLIF(NEW.data ->> 'bountyId', '')::uuid;
    v_request := COALESCE(NULLIF(NEW.data ->> 'applicationId', ''), NULLIF(NEW.data ->> 'requestId', ''))::uuid;
    SELECT b.title INTO v_title FROM public.bounties b WHERE b.id = v_bounty;

    INSERT INTO public.hunter_closure_items
      (hunter_id, notification_type, reason, request_id, bounty_id, bounty_title, title, body, data)
    VALUES
      (v_hunter, v_type, NEW.data ->> 'reason', v_request, v_bounty, v_title,
       COALESCE(NEW.title, ''), COALESCE(NEW.body, ''), NEW.data)
    ON CONFLICT (hunter_id, request_id) WHERE request_id IS NOT NULL DO NOTHING
    RETURNING id INTO v_item;

    -- Already recorded: this is a repeat notice for the same application.
    IF v_item IS NULL THEN
      RETURN NULL;
    END IF;

    -- Same rule as process-notification: a stored in_app = false for the
    -- marketplace category turns the in-app row off; no row means on.
    IF NOT EXISTS (
      SELECT 1 FROM public.notification_channel_preferences p
      WHERE p.user_id = v_hunter AND p.category = 'marketplace' AND p.channel = 'in_app' AND p.enabled = false
    ) THEN
      INSERT INTO public.notifications (user_id, type, category, title, body, data, read, count)
      VALUES (
        v_hunter, v_type, 'marketplace', COALESCE(NEW.title, ''), COALESCE(NEW.body, ''),
        (NEW.data - 'requestId') || jsonb_build_object('heldForDigest', true, 'closureItemId', v_item),
        true, 1
      )
      RETURNING id INTO v_notif;
      UPDATE public.hunter_closure_items SET notification_id = v_notif WHERE id = v_item;
    END IF;

    RETURN NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'fn_hold_hunter_closure_notice: sending % to % immediately after error: %',
      v_type, NEW.recipients, SQLERRM;
    RETURN NEW;
  END;
END;
$$;

COMMENT ON FUNCTION public.fn_hold_hunter_closure_notice() IS
  'SBA-09. BEFORE INSERT on notifications_outbox: takes application_expired / application_bounty_closed rows out of push and email, records them in hunter_closure_items, writes their in-app row already read, and drops the outbox row. On error the row goes out unchanged. fn_send_hunter_closure_digests reports the held closures once a day.';

REVOKE ALL ON FUNCTION public.fn_hold_hunter_closure_notice() FROM PUBLIC, anon, authenticated;

-- "aa_" so it runs first among any BEFORE INSERT triggers added later.
DROP TRIGGER IF EXISTS aa_hold_hunter_closure_notices ON public.notifications_outbox;
CREATE TRIGGER aa_hold_hunter_closure_notices
  BEFORE INSERT ON public.notifications_outbox
  FOR EACH ROW
  WHEN ((NEW.data ->> 'type') IN ('application_expired', 'application_bounty_closed'))
  EXECUTE FUNCTION public.fn_hold_hunter_closure_notice();

-- ─── 4. The daily digest ────────────────────────────────────────────────────
-- p_send_hour: local hour from which a hunter's digest may go out (default
-- 17). Pass 0 to treat every hunter as due now, e.g. to flush after a
-- rollback or in a staging test. p_dry_run returns what would be sent and
-- writes nothing of its own. The distribution gate still records its
-- decisions, as it does for every caller.
CREATE OR REPLACE FUNCTION public.fn_send_hunter_closure_digests(
  p_dry_run   boolean DEFAULT false,
  p_send_hour integer DEFAULT NULL
)
RETURNS TABLE(hunter_id uuid, local_date date, time_zone text, item_count integer,
              alternative_count integer, outbox_id uuid, dry_run boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog', 'pg_temp'
AS $$
#variable_conflict use_column
DECLARE
  c_default_tz       CONSTANT text     := 'America/Chicago';
  c_send_hour        CONSTANT integer  := 17;
  c_min_gap          CONSTANT interval := interval '20 hours';
  c_poster_active    CONSTANT interval := interval '14 days';
  c_default_radius   CONSTANT integer  := 25;
  c_max_alternatives CONSTANT integer  := 3;
  c_push_titles      CONSTANT integer  := 2;
  c_title_max        CONSTANT integer  := 32;
  v_send_hour  integer := COALESCE(p_send_hour, c_send_hour);
  v_local      timestamp;
  v_minutes    integer;
  v_quiet      boolean;
  v_radius     double precision;
  v_has_area   boolean;
  v_items      jsonb;
  v_item_ids   uuid[];
  v_n          integer;
  v_closed     text[];
  v_alts       jsonb;
  v_alt_ids    uuid[];
  v_alt_titles text[];
  v_title      text;
  v_body       text;
  v_list       text;
  v_digest_id  uuid;
  v_outbox_id  uuid;
  v_cands_ready boolean := false;
  h            record;
BEGIN
  IF v_send_hour < 0 OR v_send_hour > 23 THEN
    RAISE EXCEPTION 'fn_send_hunter_closure_digests: p_send_hour must be 0-23, got %', v_send_hour;
  END IF;

  -- Real runs are serialised. A run that finds the lock taken does nothing;
  -- the next hourly run picks up whatever it skipped.
  IF NOT p_dry_run
     AND NOT pg_try_advisory_xact_lock(hashtextextended('public.fn_send_hunter_closure_digests', 0)) THEN
    RAISE NOTICE 'fn_send_hunter_closure_digests: another run holds the lock; skipping';
    RETURN;
  END IF;

  FOR h IN
    WITH pend AS (
      SELECT i.hunter_id, count(*)::integer AS n
      FROM public.hunter_closure_items i
      WHERE i.digest_id IS NULL
      GROUP BY i.hunter_id
    )
    SELECT pend.hunter_id, pend.n,
           tz.valid_tz,
           COALESCE(tz.valid_tz, c_default_tz) AS tz,
           p.quiet_hours_start, p.quiet_hours_end
    FROM pend
    JOIN public.profiles p ON p.id = pend.hunter_id
    LEFT JOIN LATERAL (
      SELECT z.name AS valid_tz FROM pg_catalog.pg_timezone_names z
      WHERE z.name = p.notification_timezone LIMIT 1
    ) tz ON true
    WHERE p.deleted_at IS NULL
    ORDER BY pend.hunter_id
  LOOP
    v_local := now() AT TIME ZONE h.tz;
    CONTINUE WHEN extract(hour FROM v_local)::integer < v_send_hour;

    -- One per local day, and never two within 20 hours.
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM public.hunter_closure_digests d
      WHERE d.hunter_id = h.hunter_id
        AND (d.local_date = v_local::date OR d.sent_at > now() - c_min_gap)
    );

    -- Quiet hours, as process-notification's isInQuietHours: minutes since
    -- local midnight, only with a valid timezone, start = end means off.
    IF h.valid_tz IS NOT NULL AND h.quiet_hours_start IS NOT NULL AND h.quiet_hours_end IS NOT NULL
       AND h.quiet_hours_start <> h.quiet_hours_end THEN
      v_minutes := extract(hour FROM v_local)::integer * 60 + extract(minute FROM v_local)::integer;
      v_quiet := CASE WHEN h.quiet_hours_start < h.quiet_hours_end
                      THEN v_minutes >= h.quiet_hours_start AND v_minutes < h.quiet_hours_end
                      ELSE v_minutes >= h.quiet_hours_start OR v_minutes < h.quiet_hours_end END;
      CONTINUE WHEN v_quiet;
    END IF;

    -- Live listings that may be offered, built once per run and only when
    -- some hunter is actually due.
    IF NOT v_cands_ready THEN
      DROP TABLE IF EXISTS pg_temp.closure_digest_candidates;
      CREATE TEMP TABLE closure_digest_candidates ON COMMIT DROP AS
      WITH open_b AS (
        SELECT b.id, b.poster_id, b.title, b.amount, b.work_type::text AS work_type, b.created_at
        FROM public.bounties b
        JOIN public.profiles pr ON pr.id = b.poster_id
        WHERE b.status::text = 'open'
          AND b.accepted_by IS NULL
          AND b.accepted_request_id IS NULL
          AND b.is_test IS NOT TRUE
          AND NOT COALESCE(b.is_stale, false)
          AND (b.deadline IS NULL OR b.deadline > now())
          AND NOT COALESCE(pr.is_internal, false)
          AND pr.deleted_at IS NULL
      ),
      posters AS (SELECT DISTINCT o.poster_id FROM open_b o),
      -- Activity: the same signals as fn_sweep_absent_posters.
      msg AS (
        SELECT m.sender_id AS poster_id, max(m.created_at) AS last_at
        FROM public.messages m WHERE m.sender_id IN (SELECT ps.poster_id FROM posters ps) GROUP BY 1
      ),
      posted AS (
        SELECT pb.poster_id, max(pb.created_at) AS last_at
        FROM public.bounties pb WHERE pb.poster_id IN (SELECT ps.poster_id FROM posters ps) GROUP BY 1
      ),
      decided AS (
        SELECT q.poster_id, max(GREATEST(
                 COALESCE(q.accepted_at AT TIME ZONE 'UTC', '-infinity'),
                 CASE WHEN q.rejection_source = 'poster'
                      THEN COALESCE(q.rejected_at AT TIME ZONE 'UTC', '-infinity') ELSE '-infinity' END,
                 COALESCE(q.poster_interacted_at, '-infinity'))) AS last_at
        FROM public.bounty_requests q WHERE q.poster_id IN (SELECT ps.poster_id FROM posters ps) GROUP BY 1
      ),
      active AS (
        SELECT ps.poster_id
        FROM posters ps
        LEFT JOIN public.profiles pr ON pr.id = ps.poster_id
        LEFT JOIN auth.users u       ON u.id = ps.poster_id
        LEFT JOIN msg                ON msg.poster_id = ps.poster_id
        LEFT JOIN posted             ON posted.poster_id = ps.poster_id
        LEFT JOIN decided            ON decided.poster_id = ps.poster_id
        WHERE GREATEST(
                COALESCE(pr.last_session_at, '-infinity'),
                COALESCE(u.last_sign_in_at, '-infinity'),
                COALESCE(msg.last_at, '-infinity'),
                COALESCE(posted.last_at, '-infinity'),
                COALESCE(decided.last_at, '-infinity')
              ) >= now() - c_poster_active
      )
      SELECT o.* FROM open_b o WHERE o.poster_id IN (SELECT a.poster_id FROM active a);

      DELETE FROM pg_temp.closure_digest_candidates c
      WHERE NOT COALESCE((public.fn_bounty_distribution_gate(
              c.id, 'closure_digest', 1::smallint, false) ->> 'allowed')::boolean, false);
      v_cands_ready := true;
    END IF;

    -- What closed, oldest first.
    SELECT jsonb_agg(jsonb_build_object(
             'requestId', i.request_id, 'bountyId', i.bounty_id, 'bountyTitle', i.bounty_title,
             'type', i.notification_type, 'reason', i.reason, 'closedAt', i.closed_at)
             ORDER BY i.closed_at, i.id),
           array_agg(i.id ORDER BY i.closed_at, i.id),
           count(*)::integer,
           (array_agg(COALESCE(NULLIF(btrim(i.bounty_title), ''), 'a bounty') ORDER BY i.closed_at, i.id))
    INTO v_items, v_item_ids, v_n, v_closed
    FROM public.hunter_closure_items i
    WHERE i.hunter_id = h.hunter_id AND i.digest_id IS NULL;
    CONTINUE WHEN COALESCE(v_n, 0) = 0;

    -- The hunter's radius: primary service area first; NULL radius means
    -- "Anywhere"; no service area means the 25 mi For You default.
    v_has_area := false;
    SELECT s.radius_miles, true INTO v_radius, v_has_area
    FROM public.hunter_service_areas s
    WHERE s.hunter_id = h.hunter_id
    ORDER BY s.is_primary DESC NULLS LAST, s.updated_at DESC NULLS LAST
    LIMIT 1;
    IF NOT COALESCE(v_has_area, false) THEN
      v_radius := c_default_radius;
    END IF;

    SELECT jsonb_agg(jsonb_build_object('bountyId', a.id, 'title', a.title, 'amount', a.amount, 'workType', a.work_type)
                     ORDER BY a.rn),
           array_agg(a.id ORDER BY a.rn),
           array_agg(COALESCE(NULLIF(btrim(a.title), ''), 'a bounty') ORDER BY a.rn)
    INTO v_alts, v_alt_ids, v_alt_titles
    FROM (
      SELECT c.id, c.title, c.amount, c.work_type,
             row_number() OVER (ORDER BY (c.work_type = 'in_person') DESC, d.distance_mi NULLS LAST,
                                         c.created_at DESC, c.id) AS rn
      FROM pg_temp.closure_digest_candidates c
      LEFT JOIN LATERAL (
        SELECT x.distance_mi FROM public.fn_bounty_request_distance(c.id, h.hunter_id) x
        WHERE c.work_type = 'in_person'
      ) d ON true
      WHERE c.poster_id IS DISTINCT FROM h.hunter_id
        AND NOT EXISTS (SELECT 1 FROM public.bounty_requests br
                        WHERE br.bounty_id = c.id AND br.hunter_id = h.hunter_id)
        AND (c.work_type <> 'in_person'
             OR (d.distance_mi IS NOT NULL AND (v_radius IS NULL OR d.distance_mi <= v_radius)))
      ORDER BY rn
      LIMIT c_max_alternatives
    ) a;

    -- Copy. Titles are shortened so a push stays readable.
    SELECT array_agg(CASE WHEN length(t) > c_title_max THEN '"' || rtrim(left(t, c_title_max - 1)) || '…"'
                          ELSE '"' || t || '"' END ORDER BY ord)
    INTO v_closed
    FROM unnest(v_closed) WITH ORDINALITY AS u(t, ord);
    SELECT array_agg(CASE WHEN length(t) > c_title_max THEN '"' || rtrim(left(t, c_title_max - 1)) || '…"'
                          ELSE '"' || t || '"' END ORDER BY ord)
    INTO v_alt_titles
    FROM unnest(v_alt_titles) WITH ORDINALITY AS u(t, ord);

    IF v_n = 1 THEN
      v_title := 'Your application to ' || v_closed[1] || ' closed';
      v_body  := 'It closed automatically — this wasn''t a rejection.';
    ELSE
      v_title := v_n || ' of your applications closed';
      v_list  := CASE
        WHEN v_n = 2 THEN v_closed[1] || ' and ' || v_closed[2]
        ELSE array_to_string(v_closed[1:c_push_titles], ', ') || ' and ' || (v_n - c_push_titles) || ' more'
      END;
      v_body := v_list || ' closed automatically — this wasn''t a rejection.';
    END IF;
    IF v_alt_titles IS NOT NULL AND cardinality(v_alt_titles) > 0 THEN
      v_body := v_body || ' Still open for you: ' || CASE cardinality(v_alt_titles)
        WHEN 1 THEN v_alt_titles[1]
        WHEN 2 THEN v_alt_titles[1] || ' and ' || v_alt_titles[2]
        ELSE v_alt_titles[1] || ', ' || v_alt_titles[2] || ' and ' || v_alt_titles[3]
      END || '.';
    END IF;

    IF p_dry_run THEN
      hunter_id := h.hunter_id; local_date := v_local::date; time_zone := h.tz;
      item_count := v_n; alternative_count := COALESCE(cardinality(v_alt_ids), 0);
      outbox_id := NULL; dry_run := true;
      RETURN NEXT;
      CONTINUE;
    END IF;

    BEGIN
      -- Claim the day first; the unique key makes a second digest for the
      -- same local day impossible even if two runs ever overlap.
      INSERT INTO public.hunter_closure_digests (hunter_id, local_date, time_zone, item_count, alternative_bounty_ids)
      VALUES (h.hunter_id, v_local::date, h.tz, v_n, COALESCE(v_alt_ids, '{}'))
      ON CONFLICT ON CONSTRAINT hunter_closure_digests_hunter_day_key DO NOTHING
      RETURNING id INTO v_digest_id;
      CONTINUE WHEN v_digest_id IS NULL;

      INSERT INTO public.notifications_outbox (recipients, title, body, data, bounty_id, count)
      VALUES (
        jsonb_build_array(h.hunter_id),
        v_title,
        v_body,
        jsonb_strip_nulls(jsonb_build_object(
          'type', 'application_closure_digest',
          'digestId', v_digest_id,
          'closedCount', v_n,
          'items', v_items,
          'alternatives', COALESCE(v_alts, '[]'::jsonb),
          'bountyId', v_alt_ids[1]
        )),
        v_alt_ids[1]::text,
        1
      )
      RETURNING id INTO v_outbox_id;

      UPDATE public.hunter_closure_digests d SET outbox_id = v_outbox_id WHERE d.id = v_digest_id;
      UPDATE public.hunter_closure_items i SET digest_id = v_digest_id WHERE i.id = ANY (v_item_ids);

      hunter_id := h.hunter_id; local_date := v_local::date; time_zone := h.tz;
      item_count := v_n; alternative_count := COALESCE(cardinality(v_alt_ids), 0);
      outbox_id := v_outbox_id; dry_run := false;
      RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
      -- Claim, outbox row and item updates roll back together (subtransaction);
      -- the closures stay held for the next run.
      RAISE WARNING 'fn_send_hunter_closure_digests: skipping hunter % after error: %', h.hunter_id, SQLERRM;
    END;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.fn_send_hunter_closure_digests(boolean, integer) IS
  'SBA-09: one application_closure_digest per hunter per local day (profiles.notification_timezone, else America/Chicago) from 17:00 local, covering every closure held in hunter_closure_items, with up to three live alternatives. Skips hunters in quiet hours until the next run. p_dry_run = true returns what would be sent; p_send_hour overrides 17. Called hourly by cron job hunter-closure-digest-hourly.';

REVOKE ALL ON FUNCTION public.fn_send_hunter_closure_digests(boolean, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_send_hunter_closure_digests(boolean, integer) TO service_role;

-- ─── 5. Schedule + health ───────────────────────────────────────────────────
INSERT INTO public.job_health_expectations (job_name, max_silence, probe_sql, description)
VALUES ('hunter-closure-digest-hourly', '3 hours', NULL, 'SQL job; heartbeat appended to cron command (SBA-09)')
ON CONFLICT (job_name) DO UPDATE
  SET max_silence = EXCLUDED.max_silence, probe_sql = EXCLUDED.probe_sql, description = EXCLUDED.description;

DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'hunter-closure-digest-hourly';
END $$;
SELECT cron.schedule('hunter-closure-digest-hourly', '7 * * * *',
  $$SELECT count(*) FROM public.fn_send_hunter_closure_digests(); SELECT public.record_job_heartbeat('hunter-closure-digest-hourly');$$);

COMMIT;
