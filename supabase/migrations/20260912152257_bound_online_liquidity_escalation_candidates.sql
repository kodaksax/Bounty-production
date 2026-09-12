-- Code review follow-up on the notification-overhaul migrations: the
-- work_type = 'online' branch of fn_escalate_stale_bounty_liquidity()
-- aggregated every non-deleted profile in the table into a single uuid[]
-- (array_agg(p.id) with no filter beyond deleted_at), then passed that whole
-- array into fn_score_and_dispatch_bounty_notification(). That function
-- already caps what it actually sends to ~60 recipients, but the
-- intermediate array itself has no bound -- as the user base grows this
-- becomes an unbounded-memory / unbounded-CPU operation on every 20-minute
-- cron tick for every stale online bounty.
--
-- Fix: pre-filter to recently-active profiles (matching the activity signal
-- the scorer already uses -- a dormant account scores low there anyway, so
-- excluding them here changes nothing about who ends up notified) and cap
-- the candidate pool with LIMIT before it ever becomes an in-memory array.
-- Every other clause is unchanged from the live definition.

BEGIN;

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
    BEGIN
    v_poster_id := COALESCE(v_bounty.poster_id, v_bounty.user_id);
    v_candidates := NULL;

    IF v_bounty.work_type = 'online' THEN
      -- Bounded: recently-active profiles only, capped at 500, ordered by
      -- recency so the ones most likely to actually see/act on a push are
      -- the ones kept if the pool is larger than the cap. Dormant accounts
      -- already score ~0 on the scorer's activity component, so excluding
      -- them here doesn't change who would have been selected anyway.
      SELECT array_agg(p.id) INTO v_candidates
      FROM (
        SELECT p.id
        FROM public.profiles p
        WHERE p.deleted_at IS NULL
          AND p.id IS DISTINCT FROM v_poster_id
          AND p.last_session_at > now() - interval '90 days'
        ORDER BY p.last_session_at DESC
        LIMIT 500
      ) p;

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
