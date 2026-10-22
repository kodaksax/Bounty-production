-- Done-when checks for the 2026-10-22 data-integrity pass (read-only).
-- Run after 20261022120000, 20261022120100 + backfill, and
-- close-stale-listings-2026-10-22.sql.

-- 1. profiles.is_internal matches the team list, both ways.
--    Expected: internal_profiles = listed_accounts = 17, unlisted_internal = 0,
--    listed_not_internal = 0.
SELECT
  (SELECT count(*) FROM public.profiles WHERE is_internal) AS internal_profiles,
  (SELECT count(DISTINCT u.id) FROM auth.users u
     JOIN public.internal_account_emails i ON i.email = lower(btrim(u.email))
     JOIN public.profiles p ON p.id = u.id) AS listed_accounts,
  (SELECT count(*) FROM public.profiles p JOIN auth.users u ON u.id = p.id
    WHERE p.is_internal
      AND NOT EXISTS (SELECT 1 FROM public.internal_account_emails i WHERE i.email = lower(btrim(u.email)))) AS unlisted_internal,
  (SELECT count(*) FROM public.profiles p JOIN auth.users u ON u.id = p.id
     JOIN public.internal_account_emails i ON i.email = lower(btrim(u.email))
    WHERE NOT p.is_internal) AS listed_not_internal;

-- 2. No internal poster's bounty can reach the hunter feed. Expected 0.
SELECT count(*) AS internal_bounties_not_test
FROM public.bounties b
JOIN public.profiles p ON p.id = COALESCE(b.poster_id, b.user_id)
WHERE p.is_internal AND b.is_test IS NOT TRUE;

-- 3. Fast accepts by internal hunters on external posters' bounties
--    (the jordanmag11 signature). Expected: none.
SELECT b.id, pp.username AS poster, hp.username AS hunter,
       extract(epoch FROM (r.accepted_at AT TIME ZONE 'UTC') - r.created_at)::int AS seconds
FROM public.bounty_requests r
JOIN public.bounties b ON b.id = r.bounty_id
JOIN public.profiles hp ON hp.id = r.hunter_id AND hp.is_internal
JOIN public.profiles pp ON pp.id = COALESCE(b.poster_id, b.user_id) AND NOT pp.is_internal
WHERE r.accepted_at IS NOT NULL
  AND (r.accepted_at AT TIME ZONE 'UTC') - r.created_at <= interval '60 seconds';

-- 4. ZIP: every profile whose label carries a ZIP has one. Expected 0;
--    backfill_log = rows the backfill filled (191 expected on 2026-10-22).
SELECT
  (SELECT count(*) FROM public.profiles
    WHERE NULLIF(btrim(zip_code), '') IS NULL
      AND substring(location from '(?:^|[\s,])(\d{5})(?:-\d{4})?\s*$') IS NOT NULL) AS label_zip_missing,
  (SELECT count(*) FROM public.profile_zip_backfill_log) AS backfill_log,
  (SELECT count(*) FILTER (WHERE NULLIF(btrim(zip_code), '') IS NOT NULL) || ' / ' || count(*)
     FROM public.profiles WHERE created_at >= '2026-10-12') AS zip_since_1012;

-- 5. Server signup_completed coverage per week. Expected: queued = sent =
--    profiles for every week that starts after 2026-10-20. The PostHog side
--    is the same count of signup_completed with source = server_profile_insert.
SELECT date_trunc('week', p.created_at)::date AS week,
       count(*) AS profiles,
       count(s.user_id) AS queued,
       count(s.sent_at) AS sent
FROM public.profiles p
LEFT JOIN public.analytics_signup_events s ON s.user_id = p.id
WHERE p.created_at >= '2026-10-19'
GROUP BY 1 ORDER BY 1;

-- 6. The stale listings are closed. Expected: cancelled / archived, both is_test.
SELECT id, title, status::text, is_test
FROM public.bounties
WHERE id IN ('2a39dbf2-e720-4cff-b95d-bbe8fb84523d', '9f5355f6-faaa-499f-a809-e3dc2955724a');
