-- =====================================================================
-- Notification system overhaul, Phase 1: hunter relevance scoring +
-- liquidity escalation.
--
-- PROBLEM
-- The three existing "New Bounty Near You" triggers (fn_notify_zip_matched_
-- bounty, fn_notify_radius_matched_bounty, fn_notify_service_area_matched_
-- bounty) are pure geography: every profile inside the match radius gets
-- notified, unconditionally, with no cap, no relevance ranking, and no
-- record of who was already told about a given bounty. There is also no
-- mechanism at all for a bounty that nobody responds to -- it gets exactly
-- one round of pushes at post time and then relies on organic browsing
-- forever.
--
-- fn_notify_radius_matched_bounty exists live with NO git migration behind
-- it (confirmed via pg_proc; a prior audit flagged this exact function as
-- undocumented). This migration captures it into git for the first time
-- while touching it, matching how 20260725130000_capture_drain_
-- notifications_outbox_drift.sql handled the same situation for the outbox
-- drain job.
--
-- APPROACH
-- Preserve every existing candidate-selection query as-is (zip exact match,
-- flat 20mi radius, per-hunter service-area radius) -- that geo logic is
-- sound and already deliberately deduped against itself. The only change to
-- these three functions is *what happens to the candidate list* once it's
-- built: instead of inserting every candidate into notifications_outbox
-- unconditionally, they now hand the list to a shared scorer/dispatcher,
-- fn_score_and_dispatch_bounty_notification(), which:
--
--   1. Excludes anyone already notified about this bounty (any stage, ever)
--      -- public.bounty_hunter_notifications is both the dedup ledger and
--      the "why was this hunter notified" audit trail (score + component
--      breakdown), satisfying the admin-debugging need without a UI.
--   2. Excludes anyone who already applied -- a notification cannot recruit
--      someone who is already in the funnel.
--   3. Excludes anyone already notified about 5+ *other* bounties in the
--      last hour -- the anti-burst guard for a local posting spike.
--   4. Scores the remainder on category affinity, recent activity,
--      cancellation-based reliability, and distance from the bounty.
--   5. Sends only the top-N, where N scales with the reward (a $150 job
--      reaches more people than a $10 one; honor/no-pay posts reach fewest).
--
-- A second piece, fn_escalate_stale_bounty_liquidity() (run every 20 minutes
-- by pg_cron), handles bounties nobody has responded to: 2 hours with zero
-- applications broadens the pool (2x radius, or first inclusion of
-- "Anywhere" hunters for anything with real money attached); 12 more hours
-- with still zero applications broadens again to a flat 50-mile radius.
-- Escalation stops the moment a single application exists -- the point is
-- reach, not repetition once someone has engaged.
-- =====================================================================

BEGIN;

-- ─── 1. The dedup ledger / audit trail ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bounty_hunter_notifications (
  bounty_id  uuid NOT NULL REFERENCES public.bounties(id) ON DELETE CASCADE,
  hunter_id  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  stage      smallint NOT NULL DEFAULT 1,
  score      numeric,
  reasons    jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bounty_id, hunter_id)
);

CREATE INDEX IF NOT EXISTS idx_bounty_hunter_notifications_hunter_created
  ON public.bounty_hunter_notifications (hunter_id, created_at DESC);

ALTER TABLE public.bounty_hunter_notifications ENABLE ROW LEVEL SECURITY;
-- Service-role only, matching notifications_outbox: this is an internal
-- targeting ledger, not user-facing data. No policies == nothing gets
-- through RLS for anon/authenticated; the explicit REVOKEs below are
-- belt-and-suspenders against Supabase's default anon/authenticated grants
-- on new tables (the exact gotcha this project has hit before).
REVOKE ALL ON public.bounty_hunter_notifications FROM PUBLIC;
REVOKE ALL ON public.bounty_hunter_notifications FROM anon;
REVOKE ALL ON public.bounty_hunter_notifications FROM authenticated;

COMMENT ON TABLE public.bounty_hunter_notifications IS
  'One row per (bounty, hunter) a relevance notification was actually sent for. Dedup ledger (a hunter is never notified about the same bounty twice, regardless of stage) and audit trail (reasons holds the score breakdown) for fn_score_and_dispatch_bounty_notification and fn_escalate_stale_bounty_liquidity.';

-- ─── 2. Liquidity state on the bounty itself ────────────────────────────────
ALTER TABLE public.bounties
  ADD COLUMN IF NOT EXISTS liquidity_stage smallint NOT NULL DEFAULT 1;

ALTER TABLE public.bounties
  ADD COLUMN IF NOT EXISTS liquidity_last_escalated_at timestamptz;

COMMENT ON COLUMN public.bounties.liquidity_stage IS
  '1 = initial post-time notification only. 2/3 = escalated by fn_escalate_stale_bounty_liquidity after 2h/12h with zero applications. Escalation stops permanently once the bounty has any application.';

-- ─── 3. The shared scorer/dispatcher ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_score_and_dispatch_bounty_notification(
  p_bounty_id   uuid,
  p_candidates  uuid[],
  p_stage       smallint,
  p_title       text,
  p_body        text,
  p_extra_data  jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_bounty record;
  v_cap    int;
BEGIN
  IF p_candidates IS NULL OR array_length(p_candidates, 1) IS NULL THEN
    RETURN;
  END IF;

  SELECT category, amount, is_for_honor, geom
    INTO v_bounty
  FROM public.bounties
  WHERE id = p_bounty_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Reward-scaled reach: bigger jobs are worth waking up more hunters for;
  -- a $0 honor post gets the smallest, most-targeted send.
  v_cap := CASE
    WHEN v_bounty.is_for_honor THEN 15
    WHEN v_bounty.amount >= 100 THEN 60
    WHEN v_bounty.amount >= 40  THEN 40
    ELSE 25
  END;

  WITH candidates AS (
    SELECT
      p.id AS hunter_id,
      -- Category affinity: reward a known match, stay neutral (not
      -- penalized) when the hunter simply hasn't set any categories yet --
      -- most profiles have none, and treating "unknown" as "irrelevant"
      -- would starve the whole pipeline on sparse data.
      CASE
        WHEN v_bounty.category IS NULL
          OR p.skill_categories IS NULL
          OR array_length(p.skill_categories, 1) IS NULL THEN 0.5
        WHEN v_bounty.category = ANY (p.skill_categories) THEN 1.0
        ELSE 0.0
      END AS category_score,
      CASE
        WHEN p.last_session_at IS NULL THEN 0.3
        WHEN p.last_session_at > now() - interval '3 days'  THEN 1.0
        WHEN p.last_session_at > now() - interval '14 days' THEN 0.6
        ELSE 0.3
      END AS activity_score,
      GREATEST(0.0, 1.0 - COALESCE(p.cancellation_count, 0) * 0.15) AS reliability_score,
      CASE
        WHEN v_bounty.geom IS NULL OR p.geom IS NULL THEN 0.5
        ELSE GREATEST(0.0, 1.0 - (ST_Distance(v_bounty.geom, p.geom) / 1000.0) / 25.0)
      END AS distance_score
    FROM public.profiles p
    WHERE p.id = ANY (p_candidates)
      AND p.deleted_at IS NULL
      -- Never notify the same hunter about the same bounty twice, any stage.
      AND NOT EXISTS (
        SELECT 1 FROM public.bounty_hunter_notifications bhn
        WHERE bhn.bounty_id = p_bounty_id AND bhn.hunter_id = p.id
      )
      -- A notification cannot recruit someone already in the funnel.
      AND NOT EXISTS (
        SELECT 1 FROM public.bounty_requests br
        WHERE br.bounty_id = p_bounty_id AND br.hunter_id = p.id
      )
      -- Anti-burst: skip anyone already notified about 5+ other bounties in
      -- the last hour rather than burying them under a local posting spike.
      AND (
        SELECT count(*) FROM public.bounty_hunter_notifications bhn2
        WHERE bhn2.hunter_id = p.id AND bhn2.created_at > now() - interval '1 hour'
      ) < 5
  ),
  scored AS (
    SELECT
      hunter_id, category_score, activity_score, reliability_score, distance_score,
      (category_score * 0.35 + activity_score * 0.2 + reliability_score * 0.15 + distance_score * 0.3) AS score
    FROM candidates
  ),
  ranked AS (
    SELECT * FROM scored ORDER BY score DESC, hunter_id LIMIT v_cap
  ),
  logged AS (
    INSERT INTO public.bounty_hunter_notifications (bounty_id, hunter_id, stage, score, reasons)
    SELECT
      p_bounty_id, hunter_id, p_stage, score,
      jsonb_build_object(
        'category_score', category_score,
        'activity_score', activity_score,
        'reliability_score', reliability_score,
        'distance_score', distance_score
      )
    FROM ranked
    ON CONFLICT (bounty_id, hunter_id) DO NOTHING
    RETURNING hunter_id
  )
  INSERT INTO public.notifications_outbox (recipients, title, body, data, bounty_id)
  SELECT
    jsonb_agg(hunter_id), p_title, p_body,
    p_extra_data || jsonb_build_object('type', 'bounty_nearby', 'bountyId', p_bounty_id, 'stage', p_stage),
    p_bounty_id::text
  FROM logged
  HAVING count(*) > 0;
END;
$$;

COMMENT ON FUNCTION public.fn_score_and_dispatch_bounty_notification IS
  'Shared relevance scorer + outbox dispatcher for all bounty-nearby notification sources (post-time geo triggers and the liquidity-escalation sweep). Excludes already-notified/already-applied hunters and anyone over the hourly anti-burst cap, scores the rest on category/activity/reliability/distance, and sends only the top N (N scaled by reward).';

REVOKE ALL ON FUNCTION public.fn_score_and_dispatch_bounty_notification(uuid, uuid[], smallint, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_score_and_dispatch_bounty_notification(uuid, uuid[], smallint, text, text, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_score_and_dispatch_bounty_notification(uuid, uuid[], smallint, text, text, jsonb) TO service_role;

-- ─── 4. Route the three existing geo triggers through the dispatcher ───────
-- Candidate-finding queries are unchanged from their live definitions;
-- only the final "who actually gets sent to" step changes.

CREATE OR REPLACE FUNCTION public.fn_notify_zip_matched_bounty()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_poster_id  uuid;
  v_candidates uuid[];
BEGIN
  IF NEW.zip_code IS NULL OR btrim(NEW.zip_code) = '' THEN
    RETURN NEW;
  END IF;

  v_poster_id := COALESCE(NEW.poster_id, NEW.user_id);

  SELECT array_agg(id)
  INTO v_candidates
  FROM public.profiles
  WHERE zip_code = NEW.zip_code
    AND id IS DISTINCT FROM v_poster_id;

  PERFORM public.fn_score_and_dispatch_bounty_notification(
    NEW.id,
    v_candidates,
    1,
    'New Bounty Near You',
    '"' || NEW.title || '" was just posted near you.',
    jsonb_build_object('match', 'zip', 'zip_code', NEW.zip_code)
  );

  RETURN NEW;
END;
$$;

-- Captured from production, which had no git history for this function
-- (see header). Candidate-finding logic is verbatim; only the dispatch step
-- is new.
CREATE OR REPLACE FUNCTION public.fn_notify_radius_matched_bounty()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_poster_id  uuid;
  v_candidates uuid[];
  v_radius_m   constant double precision := 20 * 1609.344;
BEGIN
  IF NEW.geom IS NULL THEN
    RETURN NEW;
  END IF;

  v_poster_id := COALESCE(NEW.poster_id, NEW.user_id);

  SELECT array_agg(p.id)
  INTO v_candidates
  FROM public.profiles p
  WHERE p.geom IS NOT NULL
    AND ST_DWithin(p.geom, NEW.geom, v_radius_m)
    AND p.id IS DISTINCT FROM v_poster_id
    AND p.deleted_at IS NULL
    AND NOT (
      NEW.zip_code IS NOT NULL
      AND btrim(NEW.zip_code) <> ''
      AND p.zip_code = NEW.zip_code
    );

  PERFORM public.fn_score_and_dispatch_bounty_notification(
    NEW.id,
    v_candidates,
    1,
    'New Bounty Near You',
    '"' || NEW.title || '" was just posted near you.',
    jsonb_build_object('match', 'radius', 'radius_miles', 20)
  );

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_notify_service_area_matched_bounty()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_poster_id  uuid;
  v_candidates uuid[];
  v_place      text;
  v_body       text;
BEGIN
  IF NEW.geom IS NULL THEN
    RETURN NEW;
  END IF;

  v_poster_id := COALESCE(NEW.poster_id, NEW.user_id);

  SELECT array_agg(DISTINCT hsa.hunter_id)
  INTO v_candidates
  FROM public.hunter_service_areas hsa
  JOIN public.profiles p ON p.id = hsa.hunter_id
  WHERE hsa.radius_miles IS NOT NULL
    AND hsa.latitude IS NOT NULL
    AND hsa.longitude IS NOT NULL
    AND ST_DWithin(
          NEW.geom,
          ST_SetSRID(ST_MakePoint(hsa.longitude, hsa.latitude), 4326)::geography,
          hsa.radius_miles * 1609.344
        )
    AND hsa.hunter_id IS DISTINCT FROM v_poster_id
    AND p.deleted_at IS NULL
    AND NOT (
      NEW.zip_code IS NOT NULL
      AND btrim(NEW.zip_code) <> ''
      AND p.zip_code = NEW.zip_code
    );

  v_place := NULLIF(btrim(COALESCE(NEW.neighborhood, '')), '');

  v_body := CASE
    WHEN v_place IS NOT NULL
      THEN '"' || NEW.title || '" was just posted near you in ' || v_place || '.'
    ELSE '"' || NEW.title || '" was just posted near you.'
  END;

  PERFORM public.fn_score_and_dispatch_bounty_notification(
    NEW.id,
    v_candidates,
    1,
    'New Bounty Near You',
    v_body,
    jsonb_build_object('match', 'service_area', 'place', v_place)
  );

  RETURN NEW;
END;
$$;

-- ─── 5. Liquidity escalation for unclaimed bounties ────────────────────────
CREATE OR REPLACE FUNCTION public.fn_escalate_stale_bounty_liquidity()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_bounty     record;
  v_candidates uuid[];
  v_poster_id  uuid;
BEGIN
  FOR v_bounty IN
    SELECT b.id, b.title, b.category, b.amount, b.is_for_honor, b.geom, b.zip_code,
           b.work_type, b.liquidity_stage, b.created_at, b.liquidity_last_escalated_at,
           b.poster_id, b.user_id
    FROM public.bounties b
    WHERE b.status = 'open'
      AND b.liquidity_stage BETWEEN 1 AND 2
      AND NOT EXISTS (SELECT 1 FROM public.bounty_requests br WHERE br.bounty_id = b.id)
      AND (
        (b.liquidity_stage = 1
           AND b.created_at < now() - interval '2 hours'
           AND (b.liquidity_last_escalated_at IS NULL OR b.liquidity_last_escalated_at < now() - interval '2 hours'))
        OR
        (b.liquidity_stage = 2
           AND b.liquidity_last_escalated_at IS NOT NULL
           AND b.liquidity_last_escalated_at < now() - interval '12 hours')
      )
  LOOP
    v_poster_id := COALESCE(v_bounty.poster_id, v_bounty.user_id);
    v_candidates := NULL;

    IF v_bounty.work_type = 'online' THEN
      -- No location relevance for remote work -- category/activity/
      -- reliability scoring alone decides who is worth reaching.
      SELECT array_agg(p.id) INTO v_candidates
      FROM public.profiles p
      WHERE p.deleted_at IS NULL
        AND p.id IS DISTINCT FROM v_poster_id;

    ELSIF v_bounty.geom IS NOT NULL THEN
      IF v_bounty.liquidity_stage = 1 THEN
        -- Stage 1 -> 2: double each hunter's own radius; also sweep in
        -- "Anywhere" hunters, but only for jobs worth the reach (real money,
        -- or at least not a $0 honor post) -- the same restraint the
        -- original service-area trigger applies to its normal pool.
        SELECT array_agg(DISTINCT p.id) INTO v_candidates
        FROM public.profiles p
        JOIN public.hunter_service_areas hsa ON hsa.hunter_id = p.id
        WHERE p.deleted_at IS NULL
          AND hsa.hunter_id IS DISTINCT FROM v_poster_id
          AND hsa.latitude IS NOT NULL AND hsa.longitude IS NOT NULL
          AND (
            (hsa.radius_miles IS NOT NULL
               AND ST_DWithin(v_bounty.geom,
                               ST_SetSRID(ST_MakePoint(hsa.longitude, hsa.latitude), 4326)::geography,
                               hsa.radius_miles * 1609.344 * 2))
            OR (hsa.radius_miles IS NULL
                AND (v_bounty.amount >= 15 OR NOT v_bounty.is_for_honor)
                AND ST_DWithin(v_bounty.geom,
                                ST_SetSRID(ST_MakePoint(hsa.longitude, hsa.latitude), 4326)::geography,
                                40 * 1609.344))
          );
      ELSE
        -- Stage 2 -> 3: last, widest push before giving up on geo-targeting.
        -- Flat 50-mile radius regardless of the hunter's own preference --
        -- by now the bounty has been live 14+ hours with zero applications.
        SELECT array_agg(p.id) INTO v_candidates
        FROM public.profiles p
        WHERE p.deleted_at IS NULL
          AND p.id IS DISTINCT FROM v_poster_id
          AND p.geom IS NOT NULL
          AND ST_DWithin(v_bounty.geom, p.geom, 50 * 1609.344);
      END IF;
    END IF;

    PERFORM public.fn_score_and_dispatch_bounty_notification(
      v_bounty.id,
      v_candidates,
      (v_bounty.liquidity_stage + 1)::smallint,
      CASE WHEN v_bounty.liquidity_stage = 1 THEN 'Still looking for someone' ELSE 'This job still needs a hunter' END,
      '"' || v_bounty.title || '" hasn''t found a hunter yet — want to take a look?',
      jsonb_build_object('match', 'liquidity_escalation')
    );

    UPDATE public.bounties
    SET liquidity_stage = v_bounty.liquidity_stage + 1,
        liquidity_last_escalated_at = now()
    WHERE id = v_bounty.id;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.fn_escalate_stale_bounty_liquidity IS
  'Run every 20 minutes by pg_cron. Broadens the notified pool for open bounties with zero applications: stage 1->2 at 2h (2x radius + Anywhere hunters for paid jobs), stage 2->3 at 12h more (flat 50mi). Stops permanently once a bounty has any application. See fn_score_and_dispatch_bounty_notification for the dedup/scoring it delegates to.';

REVOKE ALL ON FUNCTION public.fn_escalate_stale_bounty_liquidity() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_escalate_stale_bounty_liquidity() FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_escalate_stale_bounty_liquidity() TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'escalate-stale-bounty-liquidity';
    PERFORM cron.schedule(
      'escalate-stale-bounty-liquidity',
      '*/20 * * * *',
      $cron$SELECT public.fn_escalate_stale_bounty_liquidity();$cron$
    );
  ELSE
    RAISE WARNING 'pg_cron not enabled — fn_escalate_stale_bounty_liquidity() created but NOT scheduled.';
  END IF;
END $$;

COMMIT;
