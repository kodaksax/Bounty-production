-- bounties_posted / paid_bounties_posted: count a bounty when its OWNER is
-- assigned after insert, and backfill the bounties that were missed.
--
-- How the counter works (live since 2026-08-08): trg_capture_bounty_analytics_facts
-- writes one public.analytics_user_facts row per (poster, metric, bounty) and
-- calls enqueue_analytics_person_snapshot(), whose outbox row
-- process-analytics-person sends to PostHog as a person `$set`. The count is
-- count(*) of facts, so it is idempotent and survives bounty deletion
-- ("ever posted"), by design.
--
-- The gap: the trigger fired on INSERT and on UPDATE OF status only. A bounty
-- whose owner columns are filled in AFTER insert was never counted. That is
-- exactly how the 2026-09-13 owner-loss repair restored bdaa3028 -> 313c5064
-- (20260913211432_bounty_owner_floor_and_backfill), and how any later restore
-- of the remaining ownerless bounties would go. Verified 2026-11-05 on prod:
-- that was the only owned bounty with no bounties_posted fact (and the only
-- paid one with no paid_bounties_posted fact).
--
-- Also guarded: an INSERT with both owner columns NULL used to attempt a fact
-- row with user_id NULL (a PK violation that would abort the bounty insert).
--
-- Not changed: a PostHog event's own person properties are stamped at capture
-- time (person_on_events_querying_enabled). The client's bounty_published is
-- captured before the server `$set` lands, so it carries the PRE-post value.
-- Current person values are correct (33/33 external posters, 2026-11-05).
-- Filter posters with "performed bounty_published", not bounties_posted on the
-- event. See docs/analytics/EVENT_TAXONOMY_CUTOVER.md.
--
-- Backfill: public.backfill_bounty_posted_facts(p_dry_run) reports what it
-- would write when p_dry_run = true (the default) and writes nothing. With
-- false it inserts the missing facts, logs each inserted row to
-- analytics_facts_backfill_log under p_batch, and re-enqueues those posters
-- so PostHog gets the corrected value. Reversal:
-- supabase/rollbacks/production/20261105180000_bounties_posted_fact_on_owner_assign.down.sql

-- ── Trigger ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.capture_bounty_analytics_facts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_poster_id uuid;
  v_hunter_id uuid;
BEGIN
  v_poster_id := COALESCE(NEW.poster_id, NEW.user_id);

  -- Posted: on insert, or when an owner is assigned / changed afterwards. An
  -- owner going to NULL (account deletion's FK cascade) records nothing; the
  -- previous owner keeps their fact.
  IF v_poster_id IS NOT NULL
     AND (TG_OP = 'INSERT'
          OR v_poster_id IS DISTINCT FROM COALESCE(OLD.poster_id, OLD.user_id)) THEN
    INSERT INTO public.analytics_user_facts(user_id, metric, source_id)
    VALUES (v_poster_id, 'bounties_posted', NEW.id::text)
    ON CONFLICT DO NOTHING;

    IF COALESCE(NEW.is_for_honor, false) = false AND COALESCE(NEW.amount, 0) > 0 THEN
      INSERT INTO public.analytics_user_facts(user_id, metric, source_id)
      VALUES (v_poster_id, 'paid_bounties_posted', NEW.id::text)
      ON CONFLICT DO NOTHING;
    END IF;

    PERFORM public.enqueue_analytics_person_snapshot(v_poster_id);
  END IF;

  -- Unchanged from the live definition.
  IF TG_OP = 'UPDATE'
     AND OLD.status IS DISTINCT FROM NEW.status
     AND NEW.status = 'completed' THEN
    v_hunter_id := NEW.accepted_by;
    IF v_hunter_id IS NOT NULL THEN
      INSERT INTO public.analytics_user_facts(user_id, metric, source_id)
      VALUES (v_hunter_id, 'bounties_completed', NEW.id::text)
      ON CONFLICT DO NOTHING;
      PERFORM public.enqueue_analytics_person_snapshot(v_hunter_id);
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_capture_bounty_analytics_facts ON public.bounties;
CREATE TRIGGER trg_capture_bounty_analytics_facts
  AFTER INSERT OR UPDATE OF status, poster_id, user_id ON public.bounties
  FOR EACH ROW EXECUTE FUNCTION public.capture_bounty_analytics_facts();

-- ── Backfill (reversible, dry-run first) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.analytics_facts_backfill_log (
  batch text NOT NULL,
  user_id uuid NOT NULL,
  metric text NOT NULL,
  source_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (batch, user_id, metric, source_id)
);
ALTER TABLE public.analytics_facts_backfill_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.analytics_facts_backfill_log FROM PUBLIC, anon, authenticated;

-- Facts the trigger would have written for bounties as they stand now.
CREATE OR REPLACE FUNCTION public.missing_bounty_posted_facts()
RETURNS TABLE (user_id uuid, metric text, source_id text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(b.poster_id, b.user_id), m.metric, b.id::text
  FROM public.bounties b
  CROSS JOIN LATERAL (VALUES ('bounties_posted'), ('paid_bounties_posted')) AS m(metric)
  WHERE COALESCE(b.poster_id, b.user_id) IS NOT NULL
    AND (m.metric = 'bounties_posted'
         OR (COALESCE(b.is_for_honor, false) = false AND COALESCE(b.amount, 0) > 0))
    AND NOT EXISTS (
      SELECT 1 FROM public.analytics_user_facts f
      WHERE f.user_id = COALESCE(b.poster_id, b.user_id)
        AND f.metric = m.metric
        AND f.source_id = b.id::text
    );
$function$;

CREATE OR REPLACE FUNCTION public.backfill_bounty_posted_facts(
  p_dry_run boolean DEFAULT true,
  p_batch text DEFAULT 'bounties_posted_2026_11_05'
)
RETURNS TABLE (metric text, fact_rows bigint, posters bigint, written boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid;
BEGIN
  IF p_dry_run THEN
    RETURN QUERY
      SELECT m.metric, count(*), count(DISTINCT m.user_id), false
      FROM public.missing_bounty_posted_facts() m
      GROUP BY m.metric
      ORDER BY m.metric;
    RETURN;
  END IF;

  WITH ins AS (
    INSERT INTO public.analytics_user_facts (user_id, metric, source_id)
    SELECT m.user_id, m.metric, m.source_id FROM public.missing_bounty_posted_facts() m
    ON CONFLICT DO NOTHING
    RETURNING analytics_user_facts.user_id, analytics_user_facts.metric, analytics_user_facts.source_id
  )
  INSERT INTO public.analytics_facts_backfill_log (batch, user_id, metric, source_id, created_at)
  SELECT p_batch, ins.user_id, ins.metric, ins.source_id, now() FROM ins
  ON CONFLICT DO NOTHING;

  -- now() is the transaction start, so these are exactly this run's rows.
  FOR v_user IN
    SELECT DISTINCT l.user_id FROM public.analytics_facts_backfill_log l
    WHERE l.batch = p_batch AND l.created_at = now()
  LOOP
    PERFORM public.enqueue_analytics_person_snapshot(v_user);
  END LOOP;

  RETURN QUERY
    SELECT l.metric, count(*), count(DISTINCT l.user_id), true
    FROM public.analytics_facts_backfill_log l
    WHERE l.batch = p_batch AND l.created_at = now()
    GROUP BY l.metric
    ORDER BY l.metric;
END;
$function$;

-- Supabase grants EXECUTE on new public functions to anon/authenticated
-- directly, so REVOKE FROM PUBLIC alone is not enough.
REVOKE ALL ON FUNCTION public.missing_bounty_posted_facts() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.backfill_bounty_posted_facts(boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.backfill_bounty_posted_facts(boolean, text) TO service_role;
