-- BNTY-02: liquidity escalation must not silently advance bounties that
-- reached nobody.
--
-- fn_escalate_stale_bounty_liquidity() bumped liquidity_stage on every pass,
-- regardless of whether fn_score_and_dispatch_bounty_notification() actually
-- enqueued anything. An in_person bounty with geom IS NULL has no candidate
-- pool at any stage (the candidate branches are keyed off geom), so it was
-- carried 1 -> 2 -> 3 with zero bounty_hunter_notifications rows, and the
-- stage then read as "we escalated twice" when nothing had happened. Prod
-- example: bounty 51cad7d5 sat at stage 3 with 0 hunter notifications.
--
-- Changes, all in one transaction:
--
--   1. fn_score_and_dispatch_bounty_notification() now RETURNS integer -- the
--      number of hunters it logged to bounty_hunter_notifications and put in
--      the outbox. Return-type changes need DROP + CREATE, which resets the
--      ACL, so the grants are restated explicitly below (a freshly created
--      function is EXECUTE-able by PUBLIC, i.e. anon, until revoked).
--
--   2. fn_escalate_stale_bounty_liquidity() only advances liquidity_stage when
--      that count is > 0. A pass that dispatched nothing still stamps
--      liquidity_last_escalated_at so the bounty is re-tried on the normal
--      2h / 12h cadence rather than on every 20-minute tick.
--
--   3. work_type = 'in_person' AND geom IS NULL is handled up front: no
--      candidate query, no stage bump. Instead the poster gets exactly one
--      "add a location" nudge (guarded by the new
--      bounties.liquidity_location_nudged_at column) and an admin anomaly is
--      recorded via record_reconciliation_finding() so it shows up in the
--      operator findings list / 48h digest. Severity 'warning' -- this is a
--      matching failure, not a money problem, and must not page anyone
--      (the critical-finding trigger only fires on severity = 'critical').
--
--   4. fn_reconciliation_finding_key() learns the new finding type so the
--      anomaly upserts onto one open row per bounty (occurrence_count grows)
--      instead of inserting a fresh row every 2 hours.
--
-- The online-bounty candidate branch is restated exactly as it runs in prod
-- (unbounded array_agg over active profiles). The LIMIT 500 cap from
-- 20260912152257 was deliberately reverted in prod on 2026-09-19 and is not
-- reintroduced here; this migration changes only stage progression.
--
-- Client side: the new 'bounty_location_nudge' notification type is wired in
-- lib/types.ts, lib/config/notification-taxonomy.ts,
-- lib/services/notification-deep-links.ts (-> /postings/<id>?openEdit=true),
-- components/notifications/notification-action-sheet.tsx and
-- supabase/functions/process-notification/index.ts.

BEGIN;

-- ─── 1. bounties.liquidity_location_nudged_at ───────────────────────────────

ALTER TABLE public.bounties
  ADD COLUMN IF NOT EXISTS liquidity_location_nudged_at timestamptz;

COMMENT ON COLUMN public.bounties.liquidity_location_nudged_at IS
  'When the poster was sent the one-time "add a location so nearby hunters can be notified" nudge by fn_escalate_stale_bounty_liquidity(). NULL = never sent. Set exactly once; the nudge is never repeated.';

-- ─── 2. fn_score_and_dispatch_bounty_notification -> returns dispatched count

DROP FUNCTION IF EXISTS public.fn_score_and_dispatch_bounty_notification(uuid, uuid[], smallint, text, text, jsonb);

CREATE FUNCTION public.fn_score_and_dispatch_bounty_notification(
  p_bounty_id  uuid,
  p_candidates uuid[],
  p_stage      smallint,
  p_title      text,
  p_body       text,
  p_extra_data jsonb DEFAULT '{}'::jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_bounty     record;
  v_cap        int;
  v_dispatched int := 0;
BEGIN
  IF p_candidates IS NULL OR array_length(p_candidates, 1) IS NULL THEN
    RETURN 0;
  END IF;

  SELECT category, amount, is_for_honor, geom
    INTO v_bounty
  FROM public.bounties
  WHERE id = p_bounty_id;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  v_cap := CASE
    WHEN v_bounty.is_for_honor THEN 15
    WHEN v_bounty.amount >= 100 THEN 60
    WHEN v_bounty.amount >= 40  THEN 40
    ELSE 25
  END;

  WITH candidates AS (
    SELECT
      p.id AS hunter_id,
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
      AND NOT EXISTS (
        SELECT 1 FROM public.bounty_hunter_notifications bhn
        WHERE bhn.bounty_id = p_bounty_id AND bhn.hunter_id = p.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.bounty_requests br
        WHERE br.bounty_id = p_bounty_id AND br.hunter_id = p.id
      )
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
  ),
  enqueued AS (
    INSERT INTO public.notifications_outbox (recipients, title, body, data, bounty_id)
    SELECT
      jsonb_agg(hunter_id), p_title, p_body,
      p_extra_data || jsonb_build_object('type', 'bounty_nearby', 'bountyId', p_bounty_id, 'stage', p_stage),
      p_bounty_id::text
    FROM logged
    HAVING count(*) > 0
    RETURNING jsonb_array_length(recipients) AS n
  )
  SELECT COALESCE(sum(n), 0)::int INTO v_dispatched FROM enqueued;

  RETURN v_dispatched;
END;
$$;

COMMENT ON FUNCTION public.fn_score_and_dispatch_bounty_notification(uuid, uuid[], smallint, text, text, jsonb) IS
  'Scores p_candidates for p_bounty_id, logs the top-N to bounty_hunter_notifications and enqueues one outbox row for them. Returns the number of hunters actually dispatched (0 when the pool is empty, the bounty is gone, or every candidate was already notified). Callers gate liquidity_stage progression on this count.';

-- ─── 3. fn_reconciliation_finding_key: identity for the new anomaly type ────
--
-- Restated in full from the live definition (only the one WHEN is added).

CREATE OR REPLACE FUNCTION public.fn_reconciliation_finding_key(
  p_finding_type text,
  p_details      jsonb,
  p_user_id      uuid DEFAULT NULL
)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  -- Detail key casing is NOT uniform across producers: the `reconciliation`
  -- Edge Function writes camelCase (transactionId, payoutId, accountId) while
  -- the DB-side run_withdrawal_reconciliation() writes snake_case
  -- (transaction_id, stripe_account_id). Both are accepted here rather than
  -- normalised at the source, because rewriting historical details would edit
  -- the audit record. Verified against every open finding_type in production
  -- on 2026-09-01: with these fallbacks, 0 open findings fail to derive a key.
  SELECT CASE
    WHEN subject IS NULL OR btrim(subject) = '' THEN NULL
    ELSE p_finding_type || ':' || btrim(subject)
  END
  FROM (
    SELECT CASE p_finding_type
      WHEN 'orphan_stripe_payout'        THEN p_details->>'payoutId'
      WHEN 'orphan_ledger_withdrawal'    THEN p_details->>'payoutId'
      WHEN 'payout_id_never_recorded'    THEN p_details->>'payoutId'
      WHEN 'completed_withdrawal_without_payout'
        THEN COALESCE(p_details->>'transactionId', p_details->>'transaction_id')
      WHEN 'stale_pending_withdrawal'
        THEN COALESCE(p_details->>'transactionId', p_details->>'transaction_id')
      WHEN 'withdrawal_missing_transfer_id'
        THEN COALESCE(p_details->>'transactionId', p_details->>'transaction_id')
      WHEN 'stuck_pending_withdrawal'
        THEN COALESCE(p_details->>'transactionId', p_details->>'transaction_id')
      WHEN 'connect_account_mismatch'
        THEN COALESCE(p_details->>'transactionId', p_details->>'transaction_id')
      WHEN 'stripe_account_unreadable'
        THEN COALESCE(p_details->>'accountId', p_details->>'stripe_account_id')
      WHEN 'connect_account_balance_drift'
        THEN COALESCE(p_details->>'stripe_account_id', p_details->>'accountId', p_user_id::text)
      -- balance_drift is per user and its details carry only the amounts.
      WHEN 'balance_drift'
        THEN COALESCE(p_details->>'transaction_id', p_details->>'user_id', p_user_id::text)
      WHEN 'amount_mismatch'
        THEN COALESCE(p_details->>'payoutId', p_details->>'transactionId', p_details->>'transaction_id')
      WHEN 'status_mismatch'
        THEN COALESCE(p_details->>'payoutId', p_details->>'transactionId', p_details->>'transaction_id')
      -- Liquidity anomaly (BNTY-02): one open row per bounty that can never be
      -- matched because it is in_person with no location.
      WHEN 'bounty_liquidity_no_candidates'
        THEN COALESCE(p_details->>'bountyId', p_details->>'bounty_id')
      -- Rollups describe a set, not a row: one open rollup per type is correct.
      WHEN 'completed_withdrawal_without_payout_total' THEN p_finding_type
      WHEN 'completed_withdrawal_without_payout_grandfathered' THEN p_finding_type
      WHEN 'invariant_sweep_failed'      THEN p_finding_type
      WHEN 'platform_balance_drift'      THEN p_finding_type
      ELSE NULL
    END AS subject
  ) s;
$$;

-- ─── 4. fn_escalate_stale_bounty_liquidity ──────────────────────────────────

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
  v_dispatched int;
BEGIN
  FOR v_bounty IN
    SELECT b.id, b.title, b.category, b.amount, b.is_for_honor, b.geom, b.zip_code,
           b.work_type, b.liquidity_stage, b.created_at, b.liquidity_last_escalated_at,
           b.poster_id, b.user_id, b.quality_score, b.quality_nudge_stage,
           b.liquidity_location_nudged_at
    FROM public.bounties b
    WHERE b.status = 'open'
      AND b.liquidity_stage BETWEEN 1 AND 2
      AND NOT COALESCE(b.is_test, false)
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
    v_dispatched := 0;

    -- An in-person bounty with no location has no candidate pool at any
    -- stage: nobody can be "nearby". Escalating it would be pure fiction, so
    -- instead: tell the poster once, record an admin anomaly, stamp the
    -- attempt so we re-check on the normal cadence (the poster may add a
    -- location, at which point the geom branches below take over), and leave
    -- liquidity_stage exactly where it is.
    IF v_bounty.work_type = 'in_person' AND v_bounty.geom IS NULL THEN
      IF v_bounty.liquidity_location_nudged_at IS NULL AND v_poster_id IS NOT NULL THEN
        INSERT INTO public.notifications_outbox (recipients, title, body, data, bounty_id)
        VALUES (
          jsonb_build_array(v_poster_id),
          'Add a location so nearby hunters can be notified',
          '"' || v_bounty.title || '" is an in-person job but has no location, so we can''t tell hunters near you about it. Add one and we''ll start reaching out.',
          jsonb_build_object('type', 'bounty_location_nudge', 'bountyId', v_bounty.id, 'section', 'where'),
          v_bounty.id::text
        );
        UPDATE public.bounties
        SET liquidity_location_nudged_at = now()
        WHERE id = v_bounty.id;
      END IF;

      PERFORM public.record_reconciliation_finding(
        'bounty_liquidity_no_candidates',
        'warning',
        v_poster_id,
        jsonb_build_object(
          'bountyId',        v_bounty.id,
          'title',           v_bounty.title,
          'workType',        v_bounty.work_type,
          'liquidityStage',  v_bounty.liquidity_stage,
          'createdAt',       v_bounty.created_at,
          'note',            'in_person bounty has no geom, so no hunter can ever be matched. Liquidity escalation is parked at its current stage until the poster adds a location. Poster was nudged once.'
        )
      );

      UPDATE public.bounties
      SET liquidity_last_escalated_at = now()
      WHERE id = v_bounty.id;

      CONTINUE;
    END IF;

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

    v_dispatched := public.fn_score_and_dispatch_bounty_notification(
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

    -- The stage is a claim about who has been reached. Only advance it when
    -- somebody actually was; otherwise just record the attempt so the next
    -- try waits the normal 2h / 12h rather than 20 minutes.
    IF v_dispatched > 0 THEN
      UPDATE public.bounties
      SET liquidity_stage = v_bounty.liquidity_stage + 1,
          liquidity_last_escalated_at = now()
      WHERE id = v_bounty.id;
    ELSE
      UPDATE public.bounties
      SET liquidity_last_escalated_at = now()
      WHERE id = v_bounty.id;
    END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'fn_escalate_stale_bounty_liquidity: skipping bounty % after error: %', v_bounty.id, SQLERRM;
    END;
  END LOOP;
END;
$$;

-- ─── 5. Grants ──────────────────────────────────────────────────────────────
--
-- Both functions are cron / trigger only. The DROP above wiped the dispatch
-- function's ACL (new functions default to PUBLIC EXECUTE, which includes
-- anon), and the live escalate function still carried an `authenticated`
-- grant it never needed. fn_notify_radius_matched_bounty() is SECURITY
-- DEFINER and calls the dispatcher as its owner, so it keeps working.

REVOKE ALL ON FUNCTION public.fn_score_and_dispatch_bounty_notification(uuid, uuid[], smallint, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_score_and_dispatch_bounty_notification(uuid, uuid[], smallint, text, text, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.fn_escalate_stale_bounty_liquidity() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_escalate_stale_bounty_liquidity() TO service_role;

-- ─── 6. Repair stages that were advanced without reaching anyone ────────────
--
-- Bounded to the exact shape the bug produced: open, in_person, no geom,
-- stage > 1, and not a single escalation-stage row in
-- bounty_hunter_notifications. Resetting to 1 makes the column honest; it
-- does not re-trigger anything for bounties that already have applications
-- (the sweep skips those), and a still-empty one is handled by the new
-- no-geom branch above on its next eligible pass. 2 rows in prod on
-- 2026-09-19 (51cad7d5, 76ce4d21).

UPDATE public.bounties b
SET liquidity_stage = 1
WHERE b.status = 'open'
  AND b.work_type = 'in_person'
  AND b.geom IS NULL
  AND b.liquidity_stage > 1
  AND NOT EXISTS (
    SELECT 1 FROM public.bounty_hunter_notifications n
    WHERE n.bounty_id = b.id AND n.stage > 1
  );

COMMIT;
