-- SBA-13 done-when: `signup_completed` per new profile is about 1 for every
-- sign-in method.
--
-- Two halves, because the numerator lives in PostHog and the denominator in
-- Supabase. Set :since to the moment 20261020140000 went live on prod (the
-- trigger only queues profiles created after that).
--
-- Baseline (45 days to 2026-10-19): 526 new prod profiles (apple 226,
-- google 205, email 94, phone 1) vs 92 production, non-internal client
-- signup_completed events, all method=email: 0.17 per profile, 0 for
-- Apple/Google.

-- ── 1. Supabase (prod, read-only) ──────────────────────────────────────────
-- Profiles per method, and how many of them the server queued and sent.
-- queued = profiles and sent = queued is the server half of "done".
BEGIN READ ONLY;
SELECT
  COALESCE(NULLIF(lower(btrim(u.raw_app_meta_data->>'provider')), ''), 'unknown') AS method,
  count(*)                                         AS new_profiles,
  count(e.user_id)                                 AS queued,
  count(e.sent_at)                                 AS sent,
  count(*) FILTER (WHERE p.is_internal)            AS internal
FROM public.profiles p
JOIN auth.users u ON u.id = p.id
LEFT JOIN public.analytics_signup_events e ON e.user_id = p.id
WHERE p.created_at >= :'since'::timestamptz
GROUP BY 1
ORDER BY 2 DESC;

-- Stuck sends (should be 0 rows older than a few minutes).
SELECT e.user_id, e.method, e.created_at, o.status, o.attempts, o.last_error
FROM public.analytics_signup_events e
LEFT JOIN public.analytics_person_outbox o ON o.user_id = e.user_id
WHERE e.sent_at IS NULL
  AND e.created_at < now() - interval '10 minutes'
ORDER BY e.created_at;
ROLLBACK;

-- ── 2. PostHog (HogQL) ─────────────────────────────────────────────────────
-- Divide events per method by the non-internal new_profiles above. Done when
-- every method is about 1.0 (persons = events: one per account).
--
--   SELECT toString(properties.method) AS method,
--          count() AS events,
--          count(DISTINCT person_id) AS persons
--   FROM events
--   WHERE event = 'signup_completed'
--     AND properties.source = 'server_profile_insert'
--     AND properties.app_env = 'production'
--     AND properties.is_internal != true
--     AND timestamp >= toDateTime('<since>')
--   GROUP BY method
--   ORDER BY events DESC
--
-- Old-build tail: client `signup_completed` events have no `source`. They
-- should only ever be method=email and fade as builds update; they are NOT
-- part of the numerator.
