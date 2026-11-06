-- Acceptance root cause: why applications don't get accepted.
-- HogQL. Paste into PostHog SQL (or run via the PostHog MCP execute-sql).
--
-- Puts every application submitted since the release into exactly ONE bucket,
-- the furthest the poster got with it:
--
--   0 did_not_return          poster sent no event at all after it arrived
--   1 returned_did_not_look   poster used the app afterwards, never had it on screen
--   2a seen_in_list_only      saw the Inbox row, never opened it
--   2b opened_undecided       opened it in the bounty thread; no dismiss/decision
--                             (still there, or messaged the hunter)
--   3 looked_and_left         application_dismissed: opened it and walked away
--   4 declined                application_declined: tapped Pass
--   5 blocked_by_payment      accept_blocked_by_payment: tried to hire, payment stopped it
--   6 hired                   application_accepted
--
-- 0+1 large  -> "posters aren't returning / aren't looking" (reach problem).
-- 3+4 large  -> "posters look and reject" (applicant quality / trust problem).
-- 5 large    -> the pay-to-hire step is the wall.
--
-- Set the two literals before running:
--   RELEASE_DATE     first day the build with these events was live
--   MIN_APP_VERSION  that build's version. Posters only on older builds emit
--                    none of the view events and would all read as bucket 1,
--                    so they are excluded.
--
-- Bounty -> poster comes from the poster's own bounty_published (bounty_id),
-- so no Postgres step is needed. Internal accounts are excluded on both sides
-- via person is_internal. n is small: read the split, not a point estimate.
-- Events/props: lib/services/analytics-service.ts "Acceptance root cause".

WITH
  posts AS (
    SELECT
      toString(properties.bounty_id) AS bounty_id,
      any(person_id) AS poster_person
    FROM events
    WHERE event = 'bounty_published'
      AND timestamp >= now() - INTERVAL 120 DAY
      AND coalesce(person.properties.is_internal, false) != true
    GROUP BY bounty_id
  ),
  apps AS (
    SELECT
      toString(properties.application_id) AS application_id,
      any(toString(properties.bounty_id)) AS bounty_id,
      min(timestamp) AS applied_at
    FROM events
    WHERE event = 'application_submitted'
      AND timestamp >= toDateTime('2026-11-12 00:00:00')            -- RELEASE_DATE
      AND toString(properties.is_onboarding_demo) != 'true'
      AND coalesce(person.properties.is_internal, false) != true
    GROUP BY application_id
  ),
  poster_activity AS (
    SELECT
      person_id AS poster_person,
      max(timestamp) AS last_seen,
      countIf(
        sortableSemver(toString(properties.$app_version)) >= sortableSemver('2.1.5')  -- MIN_APP_VERSION
      ) > 0 AS on_new_build
    FROM events
    WHERE timestamp >= toDateTime('2026-11-12 00:00:00')            -- RELEASE_DATE
      AND person_id IN (SELECT poster_person FROM posts)
    GROUP BY person_id
  ),
  signals AS (
    SELECT
      toString(properties.application_id) AS application_id,
      countIf(event = 'application_viewed') AS views,
      countIf(event = 'application_viewed' AND properties.surface = 'bounty_thread') AS opened,
      countIf(event = 'application_dismissed') AS dismissed,
      countIf(event = 'application_declined') AS declined,
      countIf(event = 'accept_blocked_by_payment') AS blocked,
      countIf(event = 'application_accepted') AS accepted
    FROM events
    WHERE timestamp >= toDateTime('2026-11-12 00:00:00')            -- RELEASE_DATE
      AND event IN (
        'application_viewed', 'application_dismissed', 'application_declined',
        'accept_blocked_by_payment', 'application_accepted'
      )
    GROUP BY application_id
  )
SELECT
  multiIf(
    s.accepted > 0,  '6 hired',
    s.blocked > 0,   '5 blocked_by_payment',   -- tried to hire; a later hire wins above
    s.declined > 0,  '4 declined',
    s.dismissed > 0, '3 looked_and_left',
    s.opened > 0,    '2b opened_undecided',
    s.views > 0,     '2a seen_in_list_only',
    pa.last_seen > a.applied_at, '1 returned_did_not_look',
    '0 did_not_return'
  ) AS bucket,
  count() AS applications,
  uniq(p.poster_person) AS posters
FROM apps a
INNER JOIN posts p ON p.bounty_id = a.bounty_id
LEFT JOIN poster_activity pa ON pa.poster_person = p.poster_person
LEFT JOIN signals s ON s.application_id = a.application_id
WHERE pa.on_new_build
GROUP BY bucket
ORDER BY bucket

-- Drill-downs once the split is in:
--   bucket 3: application_dismissed.dwell_ms (glance vs. read), hunter_verified,
--             has_message, applicant_distance_mi, application_age_hours.
--   bucket 5: accept_blocked_by_payment by trigger x balanceCovers
--             (balanceCovers=true + cancel = balked at the price;
--              false = had to go find money), and lastFailureCode.
--   bucket 1 vs 2: application_viewed.application_age_hours on first view
--             (first_view_this_session) = how long applicants wait to be seen.
