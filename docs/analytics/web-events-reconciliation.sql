-- Web events reconciliation: website-created bounties and poster-web decisions
-- ↔ PostHog server events. See EVENT_TAXONOMY_CUTOVER.md, "Server-side web
-- events — 2026-11-24".
--
-- Set `since` to the deploy time (UTC) of BOTH `webhooks` and `poster-web`.
-- Counts are distinct uuids: PostHog merges a resent duplicate in the
-- background, so raw rows can briefly read 2 for one fact.
--
-- ── Check 1: one bounty_published per website-created bounty ────────────────
-- Step 1: run this in Supabase (project xwlwqzzphmmhghiqvkeu, read-only).
-- Step 2: paste `hogql_per_bounty` into PostHog SQL (project 461576).
--         Pass: every row has web_events = 1 AND same_poster = 1.
--         A row with web_events = 0 is a website post that sent nothing.
--         poster_id NULL means the poster's account was deleted since:
--         same_poster reads 0 there by construction; judge it on web_events.
--         Dry run 2026-11-24 with since = 2026-10-21 listed exactly the 3
--         known posts (e97153e6, 37b7be80, 5d448641), each web_events = 0.

with params as (select timestamptz '2026-11-25 00:00:00+00' as since),  -- <- deploy time
web as (
  select b.id::text as bounty_id, coalesce(b.poster_id, b.user_id)::text as poster_id
  from public.pending_bounties pb
  join public.bounties b on b.id = pb.resulting_bounty_id, params p
  where b.created_at >= p.since
),
lit as (
  select count(*) as web_bounties,
    coalesce(string_agg(format('(%L, %L)', bounty_id, poster_id), ', '), '') as tuples,
    (select to_char(since at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS') from params) as since
  from web
)
select web_bounties,
  case when web_bounties = 0 then '-- no website-created bounties since deploy; nothing to match' else
  'SELECT x.l.1 AS bounty_id, x.l.2 AS poster_id, '
  || 'uniqIf(e.uuid, e.event != '''') AS web_events, '
  || 'uniqIf(e.uuid, e.event != '''' AND e.distinct_id = x.l.2) AS same_poster '
  || 'FROM (SELECT arrayJoin([' || tuples || ']) AS l) AS x '
  || 'LEFT JOIN (SELECT uuid, event, distinct_id, toString(properties.bounty_id) AS bounty_id FROM events '
  || 'WHERE event = ''bounty_published'' AND properties.surface = ''web_checkout'' AND timestamp >= ''' || since || ''') AS e '
  || 'ON e.bounty_id = x.l.1 '
  || 'GROUP BY bounty_id, poster_id ORDER BY web_events, bounty_id'
  end as hogql_per_bounty
from lit;

-- Check 1b (Supabase): web_checkout events whose bounty did not come from
-- pending_bounties. Paste the bounty ids from Check 3 (or from
--   SELECT DISTINCT toString(properties.bounty_id) FROM events
--   WHERE event = 'bounty_published' AND properties.surface = 'web_checkout'
--     AND timestamp >= '2026-11-25 00:00:00')
-- into the array. Pass: no rows.
-- select id from unnest(array[]::uuid[]) as id
-- where not exists (select 1 from public.pending_bounties pb where pb.resulting_bounty_id = id);
--
-- ── Check 2: one application_accepted per poster-web hire (PostHog only) ─────
-- No table records which surface accepted a request, so the reference is the
-- web diagnostic `web_applicant_decision_completed` (decision accept, outcome
-- accepted), sent by the same handler just before the canonical event.
-- Pass: every row has canonical = 1 AND same_poster = 1.
--
-- SELECT d.request_id, d.bounty_id, d.poster_id,
--        uniqIf(a.uuid, a.event != '') AS canonical,
--        uniqIf(a.uuid, a.event != '' AND a.distinct_id = d.poster_id) AS same_poster
-- FROM (
--   SELECT DISTINCT toString(properties.request_id) AS request_id,
--          toString(properties.bounty_id) AS bounty_id, distinct_id AS poster_id
--   FROM events
--   WHERE event = 'web_applicant_decision_completed'
--     AND properties.decision = 'accept' AND properties.outcome = 'accepted'
--     AND timestamp >= '2026-11-25 00:00:00'
-- ) AS d
-- LEFT JOIN (
--   SELECT uuid, event, distinct_id, toString(properties.application_id) AS application_id
--   FROM events
--   WHERE event = 'application_accepted' AND properties.surface = 'web_poster_page'
--     AND timestamp >= '2026-11-25 00:00:00'
-- ) AS a ON a.application_id = d.request_id
-- GROUP BY d.request_id, d.bounty_id, d.poster_id
-- ORDER BY canonical, d.request_id
--
-- Check 2b (Supabase): every web_poster_page application_accepted points at a
-- request that really is accepted on a bounty owned by the sender. Get the
-- pairs from PostHog:
--   SELECT DISTINCT toString(properties.application_id), distinct_id FROM events
--   WHERE event = 'application_accepted' AND properties.surface = 'web_poster_page'
--     AND timestamp >= '2026-11-25 00:00:00'
-- and paste them into the VALUES list. Pass: no rows.
-- with ph(request_id, poster_id) as (values ('00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid))
-- select ph.*, r.status, b.accepted_request_id, coalesce(b.poster_id, b.user_id) as owner
-- from ph
-- left join public.bounty_requests r on r.id = ph.request_id
-- left join public.bounties b on b.id = r.bounty_id
-- where r.id is null or r.status <> 'accepted'
--    or b.accepted_request_id is distinct from r.id
--    or coalesce(b.poster_id, b.user_id) is distinct from ph.poster_id;
--
-- ── Check 3: no bounty_published counted twice, any surface (PostHog only) ───
-- Pass: no rows. The app sends bounty_published with no `source`; the web
-- sends `source` 'webhooks' or 'poster-web'. A bounty with both is a double
-- count (a website post that also ran the app's publish path).
--
-- SELECT toString(properties.bounty_id) AS bounty_id,
--        uniq(uuid) AS events,
--        groupUniqArray(coalesce(toString(properties.source), 'app')) AS sources,
--        groupUniqArray(coalesce(toString(properties.surface), '')) AS surfaces
-- FROM events
-- WHERE event = 'bounty_published' AND timestamp >= '2026-11-25 00:00:00'
--   AND properties.bounty_id IS NOT NULL
-- GROUP BY bounty_id
-- HAVING events > 1
-- ORDER BY events DESC
