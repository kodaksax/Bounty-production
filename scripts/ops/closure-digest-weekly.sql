-- SBA-09 "done when": no hunter gets more than one closure notification a day.
-- Read-only:
--   node scripts/lib/ro-query.js --env=production -f scripts/ops/closure-digest-weekly.sql
--
-- A "closure notification" is anything that could interrupt the hunter:
--   * an outbox row of type application_expired, application_bounty_closed
--     or application_closure_digest (push, plus email when push fails), and
--   * an in-app row of those types that was NOT written silently by the hold
--     (data.heldForDigest). Held rows are stored already read: they show in
--     the list but never notify.
-- Days are the hunter's local day: profiles.notification_timezone when it
-- names a real zone, else America/Chicago (the digest's own rule).
--
-- Window: the 7 days from go-live, taken as the first held closure, so the
-- query dates itself. Baseline (60 days before go-live, in-app rows): max 10
-- a day, 92 hunter-days over 1, 82 notices in the last 7 days.
--
-- PASS = (A) max_per_hunter_day <= 1 and hunter_days_over_1 = 0 for both
-- sources, with (C) showing digests actually going out.

-- ── (A) Max closure notifications per hunter per local day ─────────────────
WITH live AS (
  SELECT min(closed_at) AS live_at FROM public.hunter_closure_items
),
win AS (
  SELECT live_at, live_at + interval '7 days' AS until FROM live
),
tz AS (
  SELECT p.id, COALESCE(z.name, 'America/Chicago') AS tz
  FROM public.profiles p
  LEFT JOIN pg_catalog.pg_timezone_names z ON z.name = p.notification_timezone
),
outbox AS (
  SELECT (o.recipients ->> 0)::uuid AS hunter_id, o.created_at
  FROM public.notifications_outbox o, win
  WHERE o.data ->> 'type' IN ('application_expired', 'application_bounty_closed', 'application_closure_digest')
    AND jsonb_typeof(o.recipients) = 'array'
    AND o.created_at >= win.live_at AND o.created_at < win.until
),
in_app AS (
  SELECT n.user_id AS hunter_id, n.created_at
  FROM public.notifications n, win
  WHERE n.type IN ('application_expired', 'application_bounty_closed', 'application_closure_digest')
    AND NOT COALESCE((n.data ->> 'heldForDigest')::boolean, false)
    AND n.created_at >= win.live_at AND n.created_at < win.until
),
per_day AS (
  SELECT 'outbox (push/email)' AS source, s.hunter_id,
         (s.created_at AT TIME ZONE COALESCE(tz.tz, 'America/Chicago'))::date AS local_day, count(*) AS n
  FROM outbox s LEFT JOIN tz ON tz.id = s.hunter_id GROUP BY 1, 2, 3
  UNION ALL
  SELECT 'in-app, notifying', s.hunter_id,
         (s.created_at AT TIME ZONE COALESCE(tz.tz, 'America/Chicago'))::date, count(*)
  FROM in_app s LEFT JOIN tz ON tz.id = s.hunter_id GROUP BY 1, 2, 3
)
SELECT (SELECT live_at FROM win) AS live_at,
       src.source,
       COALESCE(max(d.n), 0)                     AS max_per_hunter_day,
       count(d.n) FILTER (WHERE d.n > 1)         AS hunter_days_over_1,
       count(d.n)                                AS hunter_days
FROM (VALUES ('outbox (push/email)'), ('in-app, notifying')) AS src(source)
LEFT JOIN per_day d ON d.source = src.source
GROUP BY src.source
ORDER BY src.source;

-- ── (B) Offenders, if any (expect no rows) ─────────────────────────────────
WITH win AS (
  SELECT min(closed_at) AS live_at, min(closed_at) + interval '7 days' AS until FROM public.hunter_closure_items
)
SELECT (o.recipients ->> 0) AS hunter_id,
       (o.created_at AT TIME ZONE 'America/Chicago')::date AS chicago_day,
       count(*) AS n,
       array_agg(o.data ->> 'type' ORDER BY o.created_at) AS types
FROM public.notifications_outbox o, win
WHERE o.data ->> 'type' IN ('application_expired', 'application_bounty_closed', 'application_closure_digest')
  AND o.created_at >= win.live_at AND o.created_at < win.until
GROUP BY 1, 2
HAVING count(*) > 1
ORDER BY n DESC
LIMIT 20;

-- ── (C) Is the digest working? ─────────────────────────────────────────────
-- closures_held: notices the hold took in. digests_sent / hunters: what went
-- out. stuck_over_36h should be 0: an undigested closure older than 36 h
-- means the hourly job is failing (also visible in job_health as
-- hunter-closure-digest-hourly). Quiet hours can only delay a digest by a day.
SELECT
  (SELECT count(*) FROM public.hunter_closure_items)                                AS closures_held,
  (SELECT count(*) FROM public.hunter_closure_items WHERE notification_id IS NOT NULL) AS silent_in_app_rows,
  (SELECT count(*) FROM public.hunter_closure_digests)                              AS digests_sent,
  (SELECT count(DISTINCT hunter_id) FROM public.hunter_closure_digests)             AS hunters,
  (SELECT round(avg(item_count), 2) FROM public.hunter_closure_digests)             AS avg_closures_per_digest,
  (SELECT count(*) FILTER (WHERE cardinality(alternative_bounty_ids) > 0)
     FROM public.hunter_closure_digests)                                            AS digests_with_alternatives,
  (SELECT count(*) FROM public.hunter_closure_items
     WHERE digest_id IS NULL AND closed_at < now() - interval '36 hours')            AS stuck_over_36h,
  (SELECT count(*) FROM public.notifications_outbox
     WHERE data ->> 'type' IN ('application_expired', 'application_bounty_closed')
       AND created_at >= (SELECT min(closed_at) FROM public.hunter_closure_items))    AS hold_bypassed;
