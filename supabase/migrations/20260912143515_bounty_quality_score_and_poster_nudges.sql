-- =====================================================================
-- Notification system overhaul, Phase 2: bounty quality scoring + poster
-- nudges.
--
-- A poster nudge fires in exactly two moments, each once per bounty:
--
--   Stage 1 (at post time): if the bounty is clearly missing information
--   (score < 50), nudge immediately -- "Help hunters understand the job."
--
--   Stage 2 (2h later, piggybacked on the existing liquidity-escalation
--   sweep from the previous migration): if the bounty still has zero
--   applications AND the score is still middling (< 70), a second, softer
--   nudge -- "Your bounty hasn't gotten much attention yet." This runs
--   alongside (not instead of) the hunter-facing reach broadening that sweep
--   already does; they're two different levers on the same problem.
--
-- Never a third nudge -- quality_nudge_stage caps at 2, matching the
-- anti-spam requirement to not repeat the same complaint.
--
-- SCORING
-- fn_compute_bounty_quality_score() is category-aware via a keyword
-- heuristic (no structured category taxonomy exists yet -- see the DB audit)
-- rather than a flat character-count rule: a bounty whose category/title
-- suggests real scope (repair, install, plumbing, moving, etc.) is scored
-- against skills/duration/photos as well as description length; a simple
-- errand-type bounty is not penalized for lacking those. Location is only
-- scored for work_type = 'in_person' -- an online bounty isn't missing
-- anything by having no address. Each applicable component contributes its
-- weight to a running total, and the score is (earned / applicable-weight)
-- * 100, so the scale is always 0-100 regardless of which components apply.
-- =====================================================================

BEGIN;

ALTER TABLE public.bounties
  ADD COLUMN IF NOT EXISTS quality_score smallint;

ALTER TABLE public.bounties
  ADD COLUMN IF NOT EXISTS quality_nudge_stage smallint NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.bounties.quality_score IS
  '0-100 completeness score from fn_compute_bounty_quality_score, category-aware (a "walk my dog" post and an "install a ceiling fan" post are scored against different expectations). Recomputed on insert and on any edit to a scored field.';

COMMENT ON COLUMN public.bounties.quality_nudge_stage IS
  '0 = no poster quality nudge sent. 1 = sent at post time (score was <50). 2 = sent again at the 2h liquidity-escalation checkpoint (score still <70 and zero applications). Caps at 2 -- a poster is never nudged about quality a third time.';

ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check CHECK (
    type = ANY (ARRAY[
      'application', 'acceptance', 'completion', 'payment', 'message', 'follow',
      'cancellation_request', 'cancellation_accepted', 'cancellation_rejected',
      'dispute_created', 'dispute_resolved', 'workflow_dispute_created',
      'stale_bounty', 'stale_bounty_cancelled', 'stale_bounty_reposted',
      'update', 'review_needed', 'balance_update', 'bounty_nearby',
      'bounty_expiry', 'dispute_escalated', 'account_warning',
      'account_restricted', 'payout_paid', 'payout_failed', 'payout_canceled',
      'withdrawal_reversed', 'bank_disconnected', 'payout_method_changed',
      'verification_submitted', 'verification_verified', 'verification_rejected',
      'verification_canceled', 'marketing_promo',
      'reconciliation_alert', 'reconciliation_digest',
      -- Phase 2 of the notification overhaul: poster-facing quality nudges.
      'bounty_quality_nudge'
    ]::text[])
  );

CREATE OR REPLACE FUNCTION public.fn_compute_bounty_quality_score(p_bounty_id uuid)
RETURNS smallint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  b               record;
  v_detail_needed boolean;
  v_desc_len      int;
  v_scope_weight  numeric;
  v_total_weight  numeric := 0;
  v_earned        numeric := 0;
BEGIN
  SELECT title, description, category, work_type, zip_code, latitude, longitude,
         schedule_type, start_date, deadline, skills_required, duration_minutes,
         attachments, attachments_json
    INTO b
  FROM public.bounties
  WHERE id = p_bounty_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Keyword heuristic: no structured category taxonomy exists yet (category
  -- is free text), so scope/photo relevance is inferred from category+title.
  -- A false positive/negative here only shifts weighting, never gates
  -- anything, so a loose substring match is an acceptable v1.
  -- Postgres regex word-boundary is \y, not \b (\b matches a literal
  -- backspace in this engine) -- see reference_bounties_status_enum_accepted_by.
  v_detail_needed := (COALESCE(b.category, '') || ' ' || COALESCE(b.title, '')) ~*
    '(repair|install|assembl|mount|plumb|electric|wiring|renovat|construct|paint|moving|furniture|appliance|handyman|carpentry|drywall|tile|roof|hvac|\yfix\y)';

  v_desc_len := length(COALESCE(b.description, ''));

  -- Description quality: weight 25.
  v_total_weight := v_total_weight + 25;
  v_earned := v_earned + CASE
    WHEN v_desc_len >= 40 THEN 25
    WHEN v_desc_len >= 15 THEN 12.5
    ELSE 0
  END;

  -- Category set: weight 10.
  v_total_weight := v_total_weight + 10;
  v_earned := v_earned + CASE WHEN COALESCE(btrim(b.category), '') <> '' THEN 10 ELSE 0 END;

  -- Location: weight 20, only meaningful for in-person work.
  IF b.work_type = 'in_person' THEN
    v_total_weight := v_total_weight + 20;
    v_earned := v_earned + CASE
      WHEN b.latitude IS NOT NULL AND b.longitude IS NOT NULL THEN 20
      WHEN COALESCE(btrim(b.zip_code), '') <> '' THEN 10
      ELSE 0
    END;
  END IF;

  -- Timing: weight 15.
  v_total_weight := v_total_weight + 15;
  v_earned := v_earned + CASE
    WHEN b.schedule_type IS NOT NULL OR b.start_date IS NOT NULL OR b.deadline IS NOT NULL THEN 15
    ELSE 0
  END;

  -- Scope (skills/duration, or a genuinely detailed description): weight
  -- scales up for jobs a keyword match says need real scope information.
  v_scope_weight := CASE WHEN v_detail_needed THEN 20 ELSE 10 END;
  v_total_weight := v_total_weight + v_scope_weight;
  v_earned := v_earned + v_scope_weight * CASE
    WHEN COALESCE(btrim(b.skills_required), '') <> '' OR b.duration_minutes IS NOT NULL OR v_desc_len >= 120 THEN 1.0
    WHEN v_desc_len >= 60 THEN 0.5
    ELSE 0.0
  END;

  -- Photos: only scored for jobs where visual context plausibly matters.
  IF v_detail_needed THEN
    v_total_weight := v_total_weight + 15;
    v_earned := v_earned + CASE
      WHEN (jsonb_typeof(b.attachments) = 'array' AND jsonb_array_length(b.attachments) > 0)
        OR (jsonb_typeof(b.attachments_json) = 'array' AND jsonb_array_length(b.attachments_json) > 0)
      THEN 15
      ELSE 0
    END;
  END IF;

  IF v_total_weight = 0 THEN
    RETURN 100;
  END IF;

  RETURN round((v_earned / v_total_weight) * 100)::smallint;
END;
$$;

COMMENT ON FUNCTION public.fn_compute_bounty_quality_score IS
  'Category-aware 0-100 completeness score (description, category, location for in-person work, timing, scope, and -- for jobs a keyword heuristic flags as needing it -- skills/duration/photos). See fn_bounty_quality_score_and_nudge for what acts on it.';

REVOKE ALL ON FUNCTION public.fn_compute_bounty_quality_score(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_compute_bounty_quality_score(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_compute_bounty_quality_score(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_bounty_quality_score_and_nudge()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_score smallint;
BEGIN
  v_score := public.fn_compute_bounty_quality_score(NEW.id);

  IF TG_OP = 'INSERT' AND v_score IS NOT NULL AND v_score < 50 AND COALESCE(NEW.quality_nudge_stage, 0) = 0 THEN
    UPDATE public.bounties SET quality_score = v_score, quality_nudge_stage = 1 WHERE id = NEW.id;

    INSERT INTO public.notifications_outbox (recipients, title, body, data, bounty_id)
    VALUES (
      jsonb_build_array(COALESCE(NEW.poster_id, NEW.user_id)),
      'Help hunters understand the job',
      'Add a few details -- like the location, timing, and what needs to be done -- so the right hunter can tell it''s a fit.',
      jsonb_build_object('type', 'bounty_quality_nudge', 'bountyId', NEW.id, 'stage', 1, 'qualityScore', v_score),
      NEW.id::text
    );
  ELSE
    UPDATE public.bounties SET quality_score = v_score WHERE id = NEW.id;
  END IF;

  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'fn_bounty_quality_score_and_nudge failed for bounty %: %', NEW.id, SQLERRM;
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.fn_bounty_quality_score_and_nudge IS
  'AFTER INSERT / AFTER UPDATE OF (scored columns) on bounties. Recomputes quality_score always; sends the stage-1 "help hunters understand the job" nudge on insert only, once, when the score is under 50. The stage-2 follow-up lives in fn_escalate_stale_bounty_liquidity instead, since it depends on application count at the 2h mark.';

REVOKE ALL ON FUNCTION public.fn_bounty_quality_score_and_nudge() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_bounty_quality_score_and_nudge() FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_bounty_quality_score_and_nudge() TO service_role;

DROP TRIGGER IF EXISTS trg_bounties_quality_score_on_insert ON public.bounties;
CREATE TRIGGER trg_bounties_quality_score_on_insert
  AFTER INSERT ON public.bounties
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_bounty_quality_score_and_nudge();

-- Deliberately excludes quality_score/quality_nudge_stage from the watched
-- column list -- the function's own UPDATE of those columns must not
-- re-trigger this same trigger.
DROP TRIGGER IF EXISTS trg_bounties_quality_score_on_update ON public.bounties;
CREATE TRIGGER trg_bounties_quality_score_on_update
  AFTER UPDATE OF title, description, category, work_type, zip_code, latitude, longitude,
    schedule_type, start_date, deadline, skills_required, duration_minutes,
    attachments, attachments_json
  ON public.bounties
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_bounty_quality_score_and_nudge();

-- ─── Backfill: score every existing bounty once so the stage-2 check below
-- has data to work with immediately rather than waiting for the next edit.
-- Per-row, not a single bulk UPDATE: live data has at least one bounty that
-- already violates bounties_open_implies_unassigned (see the comment in
-- fn_escalate_stale_bounty_liquidity below), and a single UPDATE statement
-- touching multiple rows fails atomically -- one bad row would silently
-- prevent every other bounty from ever getting backfilled.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.bounties WHERE quality_score IS NULL LOOP
    BEGIN
      UPDATE public.bounties SET quality_score = public.fn_compute_bounty_quality_score(r.id) WHERE id = r.id;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'quality_score backfill: skipping bounty % after error: %', r.id, SQLERRM;
    END;
  END LOOP;
END $$;

-- ─── Stage 2: fold the quality follow-up into the existing liquidity sweep.
-- Same candidate set (open, zero applications, due for its first escalation)
-- -- fires once, alongside the hunter-facing reach broadening, never again.
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
           b.poster_id, b.user_id, b.quality_score, b.quality_nudge_stage
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
    -- Isolate one bounty's failure from the rest of the sweep. Live data has
    -- at least one row that already violates bounties_open_implies_unassigned
    -- (a NOT VALID constraint added 20260911000000_marketplace_state_integrity
    -- that never revalidated pre-existing rows) -- status='open' with
    -- accepted_by already set. That's a bounty-lifecycle data bug, out of
    -- scope here, but ANY update to that row (including the liquidity_stage
    -- bump below) fails against it, and an unhandled exception here would
    -- abort this whole function call -- silently skipping every other
    -- eligible bounty in the same cron run, every 20 minutes, forever.
    BEGIN
    v_poster_id := COALESCE(v_bounty.poster_id, v_bounty.user_id);
    v_candidates := NULL;

    IF v_bounty.work_type = 'online' THEN
      SELECT array_agg(p.id) INTO v_candidates
      FROM public.profiles p
      WHERE p.deleted_at IS NULL
        AND p.id IS DISTINCT FROM v_poster_id;

    ELSIF v_bounty.geom IS NOT NULL THEN
      IF v_bounty.liquidity_stage = 1 THEN
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

    -- Poster-facing quality follow-up: only at the first (2h) checkpoint, only
    -- once, and only when there's genuine room to improve.
    IF v_bounty.liquidity_stage = 1
       AND COALESCE(v_bounty.quality_score, 100) < 70
       AND COALESCE(v_bounty.quality_nudge_stage, 0) < 2
       AND v_poster_id IS NOT NULL
    THEN
      INSERT INTO public.notifications_outbox (recipients, title, body, data, bounty_id)
      VALUES (
        jsonb_build_array(v_poster_id),
        'Your bounty hasn''t gotten much attention yet',
        'Adding a few more details may help the right hunter understand the job and decide it''s a fit.',
        jsonb_build_object('type', 'bounty_quality_nudge', 'bountyId', v_bounty.id, 'stage', 2, 'qualityScore', v_bounty.quality_score),
        v_bounty.id::text
      );
      UPDATE public.bounties SET quality_nudge_stage = 2 WHERE id = v_bounty.id;
    END IF;

    UPDATE public.bounties
    SET liquidity_stage = v_bounty.liquidity_stage + 1,
        liquidity_last_escalated_at = now()
    WHERE id = v_bounty.id;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'fn_escalate_stale_bounty_liquidity: skipping bounty % after error: %', v_bounty.id, SQLERRM;
    END;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_escalate_stale_bounty_liquidity() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_escalate_stale_bounty_liquidity() FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_escalate_stale_bounty_liquidity() TO service_role;

COMMIT;
