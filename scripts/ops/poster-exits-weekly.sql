-- SBA-10 "done when", part 1 of 2 (Postgres). Read-only:
--   node scripts/lib/ro-query.js --env=production -f scripts/ops/poster-exits-weekly.sql
--
-- (A) Poster exits: how open listings ended, by week. The target is that a
--     poster who gives up CANCELS (bounty.cancelled with by_poster = true,
--     from the Inbox trash icon or the bounty screen's "Cancel and refund",
--     recorded by 20261019235500) instead of going quiet until the absent-poster
--     sweep archives the listing (bounty.flagged_stale, reason poster_absent).
--     Before 20261019235500 a poster delete wrote no ledger row at all, so
--     poster_cancellations reads 0 for every earlier week by construction.
--
-- (B) First-application times for new genuine posters' bounties, the
--     denominator of part 2 (PostHog, below): did the poster open the
--     applicant list (applicant_list_viewed) within 24 h of the first
--     application? Copy the bounty_id / first_app_at rows into the HogQL.
--
-- "Genuine": not is_test, poster not profiles.is_internal (the audit's
-- filter). "New": poster's profile created within 30 days of the bounty.
-- n is a handful a week: read the direction, not a point estimate.

-- ── (A) ─────────────────────────────────────────────────────────────────────
WITH ev AS (
  SELECT e.*, COALESCE((e.metadata->>'poster_id')::uuid, b.poster_id, b.user_id, e.actor_id) AS poster,
         COALESCE((e.metadata->>'is_test')::boolean, b.is_test, false) AS test
  FROM public.bounty_events e
  LEFT JOIN public.bounties b ON b.id = e.bounty_id
  WHERE e.occurred_at > now() - interval '12 weeks'
    AND (e.event_type = 'bounty.cancelled'
         OR (e.event_type = 'bounty.flagged_stale' AND e.metadata->>'reason' = 'poster_absent'))
)
SELECT date_trunc('week', ev.occurred_at)::date AS week,
       count(*) FILTER (WHERE ev.event_type = 'bounty.cancelled' AND ev.metadata->>'by_poster' = 'true') AS poster_cancellations,
       count(*) FILTER (WHERE ev.event_type = 'bounty.cancelled' AND ev.metadata->>'via' IS NULL)       AS other_cancellations,
       count(*) FILTER (WHERE ev.event_type = 'bounty.flagged_stale')                                    AS abandoned_swept
FROM ev
LEFT JOIN public.profiles p ON p.id = ev.poster
WHERE NOT ev.test AND p.is_internal IS NOT TRUE
GROUP BY 1 ORDER BY 1;

-- ── (B) ─────────────────────────────────────────────────────────────────────
SELECT b.id AS bounty_id,
       COALESCE(b.poster_id, b.user_id) AS poster_id,
       min(br.created_at) AS first_app_at
FROM public.bounties b
JOIN public.profiles p ON p.id = COALESCE(b.poster_id, b.user_id)
JOIN public.bounty_requests br ON br.bounty_id = b.id AND br.hunter_id IS NOT NULL
WHERE b.created_at > now() - interval '12 weeks'
  AND b.is_test IS NOT TRUE AND p.is_internal IS NOT TRUE
  AND b.created_at < p.created_at + interval '30 days'
GROUP BY 1, 2
ORDER BY 3;

-- ── Part 2 of 2 (PostHog HogQL) ─────────────────────────────────────────────
-- Paste (B)'s rows into the VALUES list. A bounty "converts" when its poster's
-- first applicant_list_viewed for it lands within 24 h of first_app_at.
--
--   WITH firsts AS (
--     SELECT * FROM (SELECT 'bounty-uuid' AS bounty_id, toDateTime('2026-10-20 12:00:00') AS first_app_at
--                    /* UNION ALL SELECT ... per row of (B) */)
--   ), views AS (
--     SELECT properties.bountyId AS bounty_id, min(timestamp) AS first_view
--     FROM events
--     WHERE event = 'applicant_list_viewed' AND coalesce(properties.is_internal, false) = false
--     GROUP BY bounty_id
--   )
--   SELECT toStartOfWeek(f.first_app_at) AS week,
--          count() AS bounties_with_applications,
--          countIf(v.first_view IS NOT NULL AND v.first_view <= f.first_app_at + INTERVAL 24 HOUR) AS viewed_within_24h
--   FROM firsts f LEFT JOIN views v ON v.bounty_id = f.bounty_id
--   GROUP BY week ORDER BY week
