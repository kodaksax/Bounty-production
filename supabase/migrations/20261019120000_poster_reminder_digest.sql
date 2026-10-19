-- =====================================================================
-- SBA-04: poster reminders become one digest per bounty, capped.
--
-- Problem (Shoal behavioral audit, 2026-10-15): fn_remind_posters_of_pending_
-- requests (20260913000000) queued one notifications_outbox row PER
-- APPLICATION at 1h and 24h. Nothing bundled them and nothing stopped them.
-- In 60 days: 817 reminders to 21 posters, 17% read; one bounty sent its
-- poster 101 reminders in 21 days, none read.
--
-- New rules (replacing the per-application nudge entirely):
--   1. One reminder per BOUNTY covering all its unanswered applications
--      ("3 people applied to ..."), same destination as before
--      (/postings/:id, resolved client-side from data.bountyId).
--      Stage 1 once the oldest unanswered application is 1h old; stage 2 once
--      it is 24h old AND stage 1 went out at least 23h earlier.
--   2. At most 2 reminders per bounty, ever (ledger PK = bounty_id, stage),
--      and at most 2 per poster in any rolling 24h across all their bounties.
--      A rolling 24h cap also bounds every calendar day to 2.
--   3. No reminder once the poster has been absent 72h. Absence is the latest
--      of profiles.last_session_at, auth.users.last_sign_in_at and this
--      bounty's created_at: last_session_at is written only by the native
--      app (MomentsProvider), so it is NULL for web posters and pre-July
--      builds. The absent-poster sweep (fn_sweep_absent_posters) takes over.
--   4. The 10-minute bundling of `application` pushes is untouched.
--
-- Payload compatibility: data keeps type / bountyId / requestId / hunterId /
-- stage, so every installed build renders and routes it exactly as before.
-- requestId/hunterId now name the OLDEST unanswered application (the next to
-- auto-close). New keys: applicantCount, bountyTitle, scope = 'bounty'. The
-- outbox `count` column carries applicantCount, so for 2+ applicants the
-- in-app row is "bundled" (count > 1) and the client navigates to
-- /postings/:id instead of offering Accept/Decline for one arbitrary person.
--
-- Ledger: poster_reminder_ledger records each reminder sent. It survives cron
-- re-runs, and its primary key makes a third reminder for a bounty impossible
-- even under concurrent runs; a transaction-scoped advisory lock serialises
-- real runs so two of them can't both spend the same poster's daily budget.
--
-- Legacy seeding: the two most recent per-application reminders already
-- queued for each bounty are copied into the ledger (source =
-- 'legacy_backfill'), so a bounty that was already reminded is not reminded
-- twice more, and a poster reminded in the last 24h starts with that budget
-- spent. Preview (read-only) before applying:
--   SELECT count(DISTINCT o.bounty_id) AS bounties, count(*) AS ledger_rows
--   FROM (SELECT o.bounty_id, row_number() OVER (PARTITION BY o.bounty_id
--           ORDER BY o.created_at DESC, o.id DESC) AS rn
--         FROM public.notifications_outbox o
--         JOIN public.bounties b ON b.id::text = o.bounty_id
--         JOIN public.profiles p ON p.id::text = o.recipients->>0
--         WHERE o.data->>'type' = 'application_pending_reminder'
--           AND jsonb_typeof(o.recipients) = 'array') o
--   WHERE o.rn <= 2;
--
-- Rollback (restores per-application reminders; drop the ledger last):
--   DROP FUNCTION public.fn_remind_posters_of_pending_requests(boolean);
--   -- re-run the fn_remind_posters_of_pending_requests block of
--   -- 20260913000000_bounty_request_expiry_and_poster_nudges.sql, then:
--   DROP TABLE public.poster_reminder_ledger;
-- The cron job calls the function by name with no arguments, so it keeps
-- working across both the forward migration and the rollback.
--
-- DONE MEANS OBSERVED: in the 7 days after this is live on production, no
-- poster has more than 2 application_pending_reminder notifications for any
-- one bounty, or more than 2 in any one day (query in the SBA-04 PR).
-- =====================================================================

BEGIN;

-- ─── Ledger ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.poster_reminder_ledger (
  bounty_id       uuid        NOT NULL REFERENCES public.bounties(id) ON DELETE CASCADE,
  stage           smallint    NOT NULL CHECK (stage IN (1, 2)),
  poster_id       uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  sent_at         timestamptz NOT NULL DEFAULT now(),
  -- Unanswered applications the reminder covered (0 for legacy rows, which
  -- were per-application and never counted).
  applicant_count integer     NOT NULL DEFAULT 0 CHECK (applicant_count >= 0),
  outbox_id       uuid,
  source          text        NOT NULL DEFAULT 'digest' CHECK (source IN ('digest', 'legacy_backfill')),
  PRIMARY KEY (bounty_id, stage)
);

COMMENT ON TABLE public.poster_reminder_ledger IS
  'One row per pending-application reminder sent to a poster, at most two per bounty (PK bounty_id, stage). Written only by fn_remind_posters_of_pending_requests; source = legacy_backfill rows were copied from the per-application reminders queued before SBA-04. Service-role only.';

CREATE INDEX IF NOT EXISTS poster_reminder_ledger_poster_sent_idx
  ON public.poster_reminder_ledger (poster_id, sent_at DESC);

-- Service-role only: RLS on with no policies, and explicit revokes (anon gets
-- auto-granted privileges on new tables; REVOKE FROM PUBLIC does not cover it).
ALTER TABLE public.poster_reminder_ledger ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.poster_reminder_ledger FROM PUBLIC;
REVOKE ALL ON public.poster_reminder_ledger FROM anon;
REVOKE ALL ON public.poster_reminder_ledger FROM authenticated;

-- ─── Seed from reminders already queued ─────────────────────────────────────
-- The two most recent per bounty: any two exhaust the per-bounty cap, and the
-- most recent two are the ones that can still count toward the 24h cap.
INSERT INTO public.poster_reminder_ledger (bounty_id, stage, poster_id, sent_at, applicant_count, outbox_id, source)
SELECT s.bounty_id,
       (row_number() OVER (PARTITION BY s.bounty_id ORDER BY s.created_at, s.id))::smallint,
       s.poster_id, s.created_at, 0, s.id, 'legacy_backfill'
FROM (
  SELECT b.id AS bounty_id, p.id AS poster_id, o.created_at, o.id,
         row_number() OVER (PARTITION BY b.id ORDER BY o.created_at DESC, o.id DESC) AS rn
  FROM public.notifications_outbox o
  JOIN public.bounties b ON b.id::text = o.bounty_id
  -- Joined on text so a malformed recipient can never fail the cast.
  JOIN public.profiles p ON p.id::text = o.recipients->>0
  WHERE o.data->>'type' = 'application_pending_reminder'
    AND jsonb_typeof(o.recipients) = 'array'
) s
WHERE s.rn <= 2
ON CONFLICT (bounty_id, stage) DO NOTHING;

COMMENT ON COLUMN public.bounty_requests.reminder_stage IS
  'Legacy (per-application reminders, 20260913000000). No longer written: since SBA-04 (20261019120000) poster reminders are per bounty and recorded in poster_reminder_ledger.';

-- ─── The reminder job ───────────────────────────────────────────────────────
-- Return type and signature change (void -> rows, + p_dry_run), so drop and
-- recreate. cron calls it as fn_remind_posters_of_pending_requests() and the
-- default argument keeps that call valid.
DROP FUNCTION IF EXISTS public.fn_remind_posters_of_pending_requests();

CREATE FUNCTION public.fn_remind_posters_of_pending_requests(p_dry_run boolean DEFAULT false)
RETURNS TABLE(bounty_id uuid, poster_id uuid, stage smallint, applicant_count integer, outbox_id uuid, dry_run boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog', 'pg_temp'
AS $$
#variable_conflict use_column
DECLARE
  c_max_per_bounty CONSTANT integer  := 2;
  c_max_per_day    CONSTANT integer  := 2;
  c_absent_after   CONSTANT interval := interval '72 hours';
  c_stage2_gap     CONSTANT interval := interval '23 hours';
  c_title_max      CONSTANT integer  := 60;
  v_enabled_at   timestamptz;
  v_expiry_hours integer;
  v_closes_after text;
  -- Dry run writes nothing, so sends it would make are counted here instead
  -- of in the ledger (poster_id -> count).
  v_planned      jsonb := '{}'::jsonb;
  v_day_count    integer;
  v_stage        smallint;
  v_short_title  text;
  v_who          text;
  v_title        text;
  v_body         text;
  v_outbox_id    uuid;
  r              record;
BEGIN
  -- Real runs are serialised so concurrent runs can't both spend the same
  -- poster's daily budget. A run that finds the lock taken does nothing; the
  -- next 15-minute tick picks up whatever it skipped.
  IF NOT p_dry_run
     AND NOT pg_try_advisory_xact_lock(hashtextextended('public.fn_remind_posters_of_pending_requests', 0)) THEN
    RAISE NOTICE 'fn_remind_posters_of_pending_requests: another run holds the lock; skipping';
    RETURN;
  END IF;

  -- Singleton row selected by its known key (id = true).
  SELECT request_lifecycle_enabled_at, request_expiry_hours
    INTO v_enabled_at, v_expiry_hours
  FROM public.posting_policy_config WHERE id = true;
  v_enabled_at   := COALESCE(v_enabled_at, now());
  v_expiry_hours := COALESCE(v_expiry_hours, 72);
  v_closes_after := CASE
    WHEN v_expiry_hours % 24 = 0 AND v_expiry_hours > 24 THEN (v_expiry_hours / 24) || ' days'
    WHEN v_expiry_hours = 24 THEN '1 day'
    ELSE v_expiry_hours || ' hours'
  END;

  FOR r IN
    WITH pending AS (
      SELECT br.bounty_id, br.poster_id, br.id AS request_id, br.hunter_id, br.created_at
      FROM public.bounty_requests br
      JOIN public.bounties b ON b.id = br.bounty_id
      WHERE br.status = 'pending'
        AND br.accepted_at IS NULL
        AND br.rejected_at IS NULL
        AND br.poster_id IS NOT NULL
        AND b.status = 'open'
        AND br.created_at >= v_enabled_at
    ),
    per_bounty AS (
      SELECT p.bounty_id, p.poster_id,
             count(*)::integer AS n,
             min(p.created_at) AS oldest_at,
             (array_agg(p.request_id ORDER BY p.created_at, p.request_id))[1] AS oldest_request_id,
             (array_agg(p.hunter_id  ORDER BY p.created_at, p.request_id))[1] AS oldest_hunter_id
      FROM pending p
      GROUP BY p.bounty_id, p.poster_id
    ),
    sent AS (
      SELECT l.bounty_id, count(*)::integer AS n_sent, max(l.sent_at) AS last_sent_at
      FROM public.poster_reminder_ledger l
      GROUP BY l.bounty_id
    )
    SELECT pb.bounty_id, pb.poster_id, pb.n, pb.oldest_at, pb.oldest_request_id, pb.oldest_hunter_id,
           b.title AS bounty_title,
           COALESCE(s.n_sent, 0) AS n_sent
    FROM per_bounty pb
    JOIN public.bounties b      ON b.id = pb.bounty_id
    LEFT JOIN sent s            ON s.bounty_id = pb.bounty_id
    LEFT JOIN public.profiles pr ON pr.id = pb.poster_id
    LEFT JOIN auth.users u      ON u.id = pb.poster_id
    WHERE COALESCE(s.n_sent, 0) < c_max_per_bounty
      AND (
        (COALESCE(s.n_sent, 0) = 0 AND pb.oldest_at < now() - interval '1 hour')
        OR
        (s.n_sent = 1 AND pb.oldest_at < now() - interval '24 hours' AND s.last_sent_at < now() - c_stage2_gap)
      )
      -- Present within the last 72h by any signal we have.
      AND GREATEST(
            COALESCE(pr.last_session_at, '-infinity'::timestamptz),
            COALESCE(u.last_sign_in_at, '-infinity'::timestamptz),
            COALESCE(b.created_at, '-infinity'::timestamptz)
          ) >= now() - c_absent_after
    -- Oldest unanswered first: it is closest to auto-closing, so it gets the
    -- daily budget first.
    ORDER BY pb.oldest_at, pb.bounty_id
  LOOP
    -- Per-poster rolling 24h cap across all their bounties.
    SELECT count(*)::integer INTO v_day_count
    FROM public.poster_reminder_ledger l
    WHERE l.poster_id = r.poster_id AND l.sent_at > now() - interval '24 hours';
    IF p_dry_run THEN
      v_day_count := v_day_count + COALESCE((v_planned ->> r.poster_id::text)::integer, 0);
    END IF;
    CONTINUE WHEN v_day_count >= c_max_per_day;

    v_stage := (r.n_sent + 1)::smallint;

    IF p_dry_run THEN
      v_planned := jsonb_set(v_planned, ARRAY[r.poster_id::text],
                             to_jsonb(COALESCE((v_planned ->> r.poster_id::text)::integer, 0) + 1));
      bounty_id := r.bounty_id; poster_id := r.poster_id; stage := v_stage;
      applicant_count := r.n; outbox_id := NULL; dry_run := true;
      RETURN NEXT;
      CONTINUE;
    END IF;

    v_short_title := COALESCE(NULLIF(btrim(r.bounty_title), ''), 'your bounty');
    IF length(v_short_title) > c_title_max THEN
      v_short_title := rtrim(left(v_short_title, c_title_max - 1)) || '…';
    END IF;
    v_who := CASE WHEN r.n = 1 THEN '1 person applied' ELSE r.n || ' people applied' END;

    IF v_stage = 1 THEN
      v_title := v_who || ' to "' || v_short_title || '"';
      v_body  := CASE WHEN r.n = 1 THEN 'They''re waiting to hear back from you.' ELSE 'They''re all waiting to hear back from you.' END
                 || ' Any application you don''t answer closes on its own ' || v_closes_after || ' after it arrives.';
    ELSE
      v_title := 'Still waiting: ' || v_who || ' to "' || v_short_title || '"';
      v_body  := 'Accept or decline soon. Any application you don''t answer closes on its own '
                 || v_closes_after || ' after it arrives.';
    END IF;

    BEGIN
      -- Claim the slot first; the PK makes a second claim for the same
      -- (bounty, stage) impossible even if two runs ever overlap.
      INSERT INTO public.poster_reminder_ledger (bounty_id, stage, poster_id, applicant_count, source)
      VALUES (r.bounty_id, v_stage, r.poster_id, r.n, 'digest')
      ON CONFLICT (bounty_id, stage) DO NOTHING;
      CONTINUE WHEN NOT FOUND;

      INSERT INTO public.notifications_outbox (recipients, title, body, data, bounty_id, count)
      VALUES (
        jsonb_build_array(r.poster_id),
        v_title,
        v_body,
        jsonb_build_object(
          'type', 'application_pending_reminder',
          'scope', 'bounty',
          'bountyId', r.bounty_id,
          'bountyTitle', r.bounty_title,
          'applicantCount', r.n,
          'stage', v_stage,
          -- Kept for builds that read them: the oldest unanswered application.
          'requestId', r.oldest_request_id,
          'hunterId', r.oldest_hunter_id
        ),
        r.bounty_id::text,
        r.n
      )
      RETURNING id INTO v_outbox_id;

      UPDATE public.poster_reminder_ledger l
      SET outbox_id = v_outbox_id
      WHERE l.bounty_id = r.bounty_id AND l.stage = v_stage;

      bounty_id := r.bounty_id; poster_id := r.poster_id; stage := v_stage;
      applicant_count := r.n; outbox_id := v_outbox_id; dry_run := false;
      RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
      -- Ledger claim and outbox row roll back together (subtransaction).
      RAISE WARNING 'fn_remind_posters_of_pending_requests: skipping bounty % after error: %', r.bounty_id, SQLERRM;
    END;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.fn_remind_posters_of_pending_requests(boolean) IS
  'SBA-04: one reminder per bounty covering all unanswered applications, at most 2 per bounty and 2 per poster per rolling 24h, none once the poster has been absent 72h. p_dry_run = true returns what would be sent and writes nothing. Called every 15 minutes by cron job remind-posters-of-pending-requests.';

REVOKE ALL ON FUNCTION public.fn_remind_posters_of_pending_requests(boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_remind_posters_of_pending_requests(boolean) FROM anon;
REVOKE ALL ON FUNCTION public.fn_remind_posters_of_pending_requests(boolean) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_remind_posters_of_pending_requests(boolean) TO service_role;

COMMIT;
