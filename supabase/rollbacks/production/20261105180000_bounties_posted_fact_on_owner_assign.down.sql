-- Reverts 20261105180000_bounties_posted_fact_on_owner_assign.sql.
--
-- 1. Removes exactly the facts the backfill wrote (by batch log), and
--    re-enqueues those posters so PostHog gets the reverted count.
-- 2. Restores the previous trigger definition (INSERT / UPDATE OF status,
--    no NULL-owner guard) as it was live on 2026-11-05.
-- 3. Drops the backfill helpers and log table.
--
-- Facts the NEW trigger wrote between apply and rollback (owner assigned
-- after insert) are kept: they describe real postings.

BEGIN;

CREATE TEMP TABLE _reverted_posters ON COMMIT DROP AS
  SELECT DISTINCT user_id FROM public.analytics_facts_backfill_log;

DELETE FROM public.analytics_user_facts f
USING public.analytics_facts_backfill_log l
WHERE f.user_id = l.user_id
  AND f.metric = l.metric
  AND f.source_id = l.source_id;

SELECT public.enqueue_analytics_person_snapshot(user_id) FROM _reverted_posters;

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

  IF TG_OP = 'INSERT' THEN
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

  IF TG_OP = 'UPDATE'
     AND OLD.status IS DISTINCT FROM NEW.status
     AND NEW.status = 'completed' THEN
    v_hunter_id := NEW.accepted_by;  -- fixed: removed NEW.hunter_id
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
  AFTER INSERT OR UPDATE OF status ON public.bounties
  FOR EACH ROW EXECUTE FUNCTION public.capture_bounty_analytics_facts();

DROP FUNCTION IF EXISTS public.backfill_bounty_posted_facts(boolean, text);
DROP FUNCTION IF EXISTS public.missing_bounty_posted_facts();
DROP TABLE IF EXISTS public.analytics_facts_backfill_log;

COMMIT;
