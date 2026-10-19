-- SBA-02 "done when": weekly share of new applications to genuine in-person
-- bounties that come from within 25 miles.
-- Requires 20261019200000_applicant_distance.sql.
-- Read-only: node scripts/lib/ro-query.js --env=production -f scripts/ops/applicant-distance-weekly.sql
--
-- Population: the audit's "genuine" filter (docs/audits/shoal-behavioral-audit.md,
-- Appendix A) on the bounty, in-person only, internal applicants excluded.
--
-- Columns:
--   pct_within_25mi_of_measurable  the headline number: of the applications
--                                  where both locations are known
--   pct_within_25mi_of_all         same numerator over every application;
--                                  unknown-location applicants count as not local
--   backfilled                     rows whose distance was computed by the
--                                  migration from locations at that time, not
--                                  at application time (weeks before deploy)
--
-- Baseline (audit, 2026-10-15): 0 of 18 measurable within 50 mi, median 1,504 mi.
-- n is a handful a week: read "did it move off 0", not a point estimate.
WITH b AS (
  SELECT b.*, COALESCE(b.poster_id, b.user_id, b.former_poster_id) AS owner
  FROM public.bounties b
),
genuine AS (
  SELECT b.*
  FROM b
  LEFT JOIN public.profiles p ON p.id = b.owner
  LEFT JOIN public.bounty_moderation m ON m.bounty_id = b.id
  WHERE p.is_internal IS NOT TRUE
    AND b.is_test IS NOT TRUE
    AND COALESCE(m.state, '') <> 'removed'
    AND COALESCE(p.account_status, 'active') NOT IN ('banned', 'suspended')
)
SELECT
  date_trunc('week', r.created_at)::date AS week,
  count(*) AS apps,
  count(*) FILTER (WHERE r.distance_mi IS NOT NULL) AS measurable,
  count(*) FILTER (WHERE r.distance_mi <= 25) AS within_25mi,
  count(*) FILTER (WHERE r.is_far) AS far_over_50mi,
  round(100.0 * count(*) FILTER (WHERE r.distance_mi <= 25)
        / NULLIF(count(*) FILTER (WHERE r.distance_mi IS NOT NULL), 0), 1) AS pct_within_25mi_of_measurable,
  round(100.0 * count(*) FILTER (WHERE r.distance_mi <= 25) / NULLIF(count(*), 0), 1) AS pct_within_25mi_of_all,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY r.distance_mi) AS median_mi,
  count(*) FILTER (WHERE r.distance_computed_at > r.created_at + interval '1 minute') AS backfilled
FROM public.bounty_requests r
JOIN genuine g ON g.id = r.bounty_id
LEFT JOIN public.profiles hp ON hp.id = r.hunter_id
WHERE g.work_type = 'in_person'
  AND hp.is_internal IS NOT TRUE
  AND r.created_at >= now() - interval '12 weeks'
GROUP BY 1
ORDER BY 1;
