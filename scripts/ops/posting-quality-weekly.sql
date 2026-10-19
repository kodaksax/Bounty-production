-- SBA-03 "done when": weekly description coverage on new genuine bounties,
-- and applications that pile up on bounties whose poster never acts.
-- Requires nothing new; run before and after 20261019230000_posting_quality_rules.sql.
-- Read-only: node scripts/lib/ro-query.js --env=production -f scripts/ops/posting-quality-weekly.sql
--
-- Population: the audit's "genuine" filter (docs/audits/shoal-behavioral-audit.md,
-- Appendix A), by the week the bounty was created.
--
-- Columns:
--   with_description_20     the headline: description of 20+ characters
--                           (whitespace trimmed). Target: ~100% from deploy on.
--   template_title_only     exact TASK_TEMPLATES title with no description
--                           (app/screens/CreateBounty/quick/StepTask.tsx)
--   first_day_posts         posted within 24 h of the poster's profile creation
--   apps                    applications from non-internal hunters
--   ignored_bounties        bounties with 1+ application where the poster never
--                           opened, accepted or declined any of them
--   apps_on_ignored         applications sitting on those bounties
--   apps_per_bounty_ignored apps_on_ignored / bounties. Expect it to fall.
--
-- Baseline (audit, 2026-10-15): 16 of 19 genuine bounties since 09-10 had no
-- description; 12 had an exact template title; 0 poster decisions on 288
-- applications since 09-13. n is ~1-5 bounties a week: read the direction,
-- not a point estimate.
WITH b AS (
  SELECT b.*, COALESCE(b.poster_id, b.user_id, b.former_poster_id) AS owner
  FROM public.bounties b
),
genuine AS (
  SELECT b.*, p.created_at AS owner_joined_at
  FROM b
  LEFT JOIN public.profiles p ON p.id = b.owner
  LEFT JOIN public.bounty_moderation m ON m.bounty_id = b.id
  WHERE p.is_internal IS NOT TRUE
    AND b.is_test IS NOT TRUE
    AND COALESCE(m.state, '') <> 'removed'
    AND COALESCE(p.account_status, 'active') NOT IN ('banned', 'suspended')
    AND b.created_at >= now() - interval '12 weeks'
),
apps AS (
  SELECT r.bounty_id,
         count(*) AS apps,
         -- Expiry and sweeps also set status = 'rejected', so a decision is
         -- read from outcome_by, the same measure as request-outcomes-verify.sql.
         bool_or(r.poster_interacted_at IS NOT NULL
                 OR o.outcome_by = 'poster') AS poster_acted
  FROM public.bounty_requests r
  LEFT JOIN public.bounty_request_outcomes o ON o.request_id = r.id
  LEFT JOIN public.profiles hp ON hp.id = r.hunter_id
  WHERE hp.is_internal IS NOT TRUE
  GROUP BY r.bounty_id
),
scored AS (
  SELECT g.*,
         char_length(btrim(COALESCE(g.description, ''), E' \t\r\n')) AS desc_len,
         COALESCE(a.apps, 0) AS apps,
         COALESCE(a.apps, 0) > 0
           AND NOT COALESCE(a.poster_acted, false)
           AND g.accepted_by IS NULL
           AND g.accepted_request_id IS NULL AS ignored
  FROM genuine g
  LEFT JOIN apps a ON a.bounty_id = g.id
)
SELECT
  date_trunc('week', created_at)::date AS week,
  count(*) AS bounties,
  count(*) FILTER (WHERE desc_len >= 20) AS with_description_20,
  round(100.0 * count(*) FILTER (WHERE desc_len >= 20) / NULLIF(count(*), 0), 1) AS pct_with_description_20,
  count(*) FILTER (WHERE desc_len = 0) AS no_description,
  count(*) FILTER (WHERE desc_len = 0 AND btrim(title) IN (
    'Hold my spot in the merch line', 'Take lecture notes for me', 'Cut my hair at my place',
    'Mount my TV', 'Explain my insurance policy', 'Hem my gown', 'Tagalog language translator',
    'Walk my dog', 'Clean out my closet', 'Help me move in', 'Design an artwork',
    'Assemble my furniture'
  )) AS template_title_only,
  count(*) FILTER (WHERE owner_joined_at > created_at - interval '24 hours') AS first_day_posts,
  sum(apps) AS apps,
  count(*) FILTER (WHERE ignored) AS ignored_bounties,
  COALESCE(sum(apps) FILTER (WHERE ignored), 0) AS apps_on_ignored,
  round(COALESCE(sum(apps) FILTER (WHERE ignored), 0)::numeric / NULLIF(count(*), 0), 1) AS apps_per_bounty_ignored
FROM scored
GROUP BY 1
ORDER BY 1;
