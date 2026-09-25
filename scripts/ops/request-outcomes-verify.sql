-- Request expiry / outcome verification queries.
-- Requires 20260925220000_request_outcomes_and_absent_poster_sweep.sql.
-- Read-only. Run against production with the service role.
--
-- Cohort: bounty_request_outcomes.is_legitimate_external -- no internal party,
-- not is_test, poster account_status = 'active', bounty not removed by
-- moderation (bounty_moderation.state = 'removed'). Checked 2026-09-25: 68
-- applications for 09-14..09-22 (50 through 09-20; the planning brief's 60 is
-- in between, i.e. a timing difference, not a filter gap). is_internal alone
-- gives 89.

-- 1. rejection_source by day since the first expiry run (2026-09-25 19:00 UTC).
--    Expect: expired_no_response appears every day there are overdue requests.
SELECT date_trunc('day', outcome_at) AS day, outcome, count(*)
FROM public.bounty_request_outcomes
WHERE outcome_at >= '2026-09-25'
GROUP BY 1, 2
ORDER BY 1, 2;

-- 2. Pending rows older than their window. Expect 0 within ~15 min of any
--    request crossing its window. Pre-watermark rows are excluded by design
--    (fn_sweep_absent_posters is the only path that closes those).
SELECT
  count(*) FILTER (WHERE br.poster_interacted_at IS NULL
                   AND br.created_at < now() - make_interval(hours => c.request_expiry_hours)) AS overdue_silent,
  count(*) FILTER (WHERE br.poster_interacted_at IS NOT NULL
                   AND br.created_at < now() - make_interval(hours => c.request_expiry_hours)
                   AND br.poster_interacted_at < now() - make_interval(hours => c.request_interacted_expiry_hours)) AS overdue_interacted,
  count(*) FILTER (WHERE br.created_at < c.request_lifecycle_enabled_at) AS pre_watermark_pending
FROM public.bounty_requests br
JOIN public.bounties b ON b.id = br.bounty_id
CROSS JOIN public.posting_policy_config c
WHERE c.id AND br.status = 'pending' AND b.status::text = 'open' AND br.hunter_id IS NOT NULL;

-- 3. Poster decision rate (the decider).
--    Denominator: EVERY legitimate-external application in a fixed created_at
--    cohort, once it is >= 7 days old. No outcome is ever removed from it:
--    expired_no_response, closed_poster_absent and closed_bounty_gone are
--    non-decisions and stay in. (Excluding system rows makes the rate drift
--    toward 100% as expiry reclassifies pending rows, with no behaviour change.)
--    Numerator: outcome_by = 'poster' (accept, poster decline, or -- for
--    pre-2026-09-13 rows -- not_selected when a sibling was accepted).
--    Baseline, 2026-09-25: 08-14..09-13 = 6/26 = 23.1%; 09-14..09-18 = 0/24 = 0%.
--    n is tiny: read this as "did it move off 0", not as a point estimate.
SELECT
  date_trunc('week', o.created_at)::date AS cohort_week,
  count(*) AS denominator,
  count(*) FILTER (WHERE o.outcome_by = 'poster') AS poster_decided,
  round(100.0 * count(*) FILTER (WHERE o.outcome_by = 'poster') / nullif(count(*), 0), 1) AS decision_rate_pct,
  count(*) FILTER (WHERE o.outcome = 'expired_no_response') AS expired,
  count(*) FILTER (WHERE o.outcome = 'closed_poster_absent') AS poster_absent,
  count(*) FILTER (WHERE o.outcome = 'closed_bounty_gone') AS bounty_gone,
  count(*) FILTER (WHERE o.outcome = 'pending') AS still_pending
FROM public.bounty_request_outcomes o
WHERE o.is_legitimate_external
  AND o.created_at >= '2026-08-14'
  AND o.created_at < now() - interval '7 days'
GROUP BY 1
ORDER BY 1;

-- 4. Hunter notice delivery for closures (DB side). The PostHog side is
--    notification_sent / notification_failed with notification_type =
--    'application_expired'; an email rescue shows notification_delivered_via = 'email'.
SELECT o.data->>'reason' AS reason, o.status, count(*),
       count(*) FILTER (WHERE o.delivery_errors IS NOT NULL) AS with_delivery_errors,
       count(f.dedupe_key) AS email_fallbacks
FROM public.notifications_outbox o
LEFT JOIN public.notification_email_fallbacks f ON f.outbox_id = o.id
WHERE o.data->>'type' = 'application_expired'
GROUP BY 1, 2;

-- 5. Absent-poster sweeps: what each real run closed.
SELECT sweep_id, min(run_at) AS run_at, absent_days, count(*) AS bounties,
       sum(requests_closed) AS requests,
       count(*) FILTER (WHERE bounty_action = 'flagged_funded') AS funded_left_open,
       count(*) FILTER (WHERE poster_is_internal) AS internal_posters
FROM public.absent_poster_sweep_log
GROUP BY sweep_id, absent_days
ORDER BY 2 DESC;
