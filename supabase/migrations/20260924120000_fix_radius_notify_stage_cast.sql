-- Fix: posting a bounty with a location failed outright.
--
-- fn_notify_radius_matched_bounty() (AFTER INSERT on bounties) called
-- fn_score_and_dispatch_bounty_notification(..., 1, ...) with a bare integer
-- literal for the p_stage smallint parameter. int4 -> int2 is an *assignment*
-- cast, not an implicit one, so function resolution never finds the only
-- overload and Postgres raises:
--
--   42883: function public.fn_score_and_dispatch_bounty_notification(
--          uuid, uuid[], integer, unknown, unknown, jsonb) does not exist
--
-- The trigger returns early when NEW.geom IS NULL, so the failure only hit
-- bounties posted *with* a location -- and because it's an AFTER INSERT
-- trigger, the error rolled back the whole insert. The other two call sites
-- (fn_escalate_stale_bounty_liquidity, the quality-nudge path) already cast
-- with ::smallint, which is why only this one broke.
--
-- Also adds the COALESCE(NEW.is_test, false) guard that 20260913010000 gave
-- fn_notify_zip_matched_bounty and fn_notify_service_area_matched_bounty but
-- skipped here: a QA bounty must not page real hunters.

CREATE OR REPLACE FUNCTION public.fn_notify_radius_matched_bounty()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_poster_id  uuid;
  v_candidates uuid[];
  v_radius_m   constant double precision := 20 * 1609.344;
BEGIN
  -- Test bounties never page a real hunter, regardless of match quality.
  IF COALESCE(NEW.is_test, false) THEN
    RETURN NEW;
  END IF;

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
    1::smallint,
    'New Bounty Near You',
    '"' || NEW.title || '" was just posted near you.',
    jsonb_build_object('match', 'radius', 'radius_miles', 20)
  );

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_notify_radius_matched_bounty() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_notify_radius_matched_bounty() FROM anon;
