-- SBA-05 "done when": do genuine paid bounties posted after first-time posters
-- start saving a card get a poster decision?
-- Read-only: node scripts/lib/ro-query.js --env=production -f scripts/ops/card-at-post-done-when.sql
--
-- PASS once any week on or after the switch-on week (the day
-- payment_experiment_config.card_at_post_scope became 'first_time_posters'
-- AND 2.1.3+ is what posters run) shows poster_decided >= 1. That is the
-- audit's done-when: bounty_requests.status = 'accepted' or
-- rejection_source = 'poster' on a genuine bounty posted after the change.
--
-- Population: the audit's "genuine" filter (docs/audits/shoal-behavioral-audit.md,
-- Appendix A), paid bounties charged at hire ('at_accept'), from 2026-09-02,
-- when charge-at-hire became the default, by the week the bounty was created.
--
-- Columns:
--   paid_at_hire        genuine paid bounties with funding_mode 'at_accept'
--   first_time_posts    posted by someone with no earlier bounty that had
--                       reached accepted/completed by then (fn_is_first_time_poster,
--                       evaluated as of the bounty's created_at)
--   card_on_file        poster had a card row in payment_methods by then. A
--                       lower bound: the mirror misses cards saved through
--                       deposit sheets. Expect it to rise after switch-on.
--   with_apps           1+ application from a non-internal hunter
--   poster_decided      THE NUMBER: 1+ request accepted, or declined by the
--                       poster (rejection_source = 'poster')
--   hired               1+ request accepted
--
-- Baseline (audit, 2026-10-15): 0 of 17 genuine at_accept bounties hired since
-- 09-02, and 0 poster decisions on 288 applications since 09-13. n is ~1-5
-- bounties a week: read the direction, not a rate.
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
    AND b.created_at >= '2026-09-02'
    AND b.is_for_honor IS NOT TRUE
    AND b.amount > 0
    AND b.funding_mode = 'at_accept'
),
scored AS (
  SELECT g.id, g.created_at,
         -- fn_is_first_time_poster's signals, as of this bounty's creation.
         NOT EXISTS (
           SELECT 1 FROM public.bounties e
            WHERE COALESCE(e.poster_id, e.user_id) = g.owner
              AND e.id <> g.id
              AND e.created_at < g.created_at
              AND (
                    (e.completed_at IS NOT NULL AND e.completed_at < g.created_at)
                 OR EXISTS (SELECT 1 FROM public.bounty_requests r
                             WHERE r.bounty_id = e.id AND r.status = 'accepted'
                               AND COALESCE(r.accepted_at, r.updated_at) < g.created_at)
                 OR EXISTS (SELECT 1 FROM public.bounty_events ev
                             WHERE ev.bounty_id = e.id
                               AND ev.event_type IN ('application.accepted', 'bounty.accepted',
                                                     'bounty.in_progress', 'bounty.completed')
                               AND ev.occurred_at < g.created_at)
              )
         ) AS first_time,
         EXISTS (SELECT 1 FROM public.payment_methods pm
                  WHERE pm.user_id = g.owner AND pm.type = 'card'
                    AND pm.created_at <= g.created_at) AS card_on_file,
         EXISTS (SELECT 1 FROM public.bounty_requests r
                   LEFT JOIN public.profiles hp ON hp.id = r.hunter_id
                  WHERE r.bounty_id = g.id AND hp.is_internal IS NOT TRUE) AS with_apps,
         EXISTS (SELECT 1 FROM public.bounty_requests r
                  WHERE r.bounty_id = g.id
                    AND (r.status = 'accepted' OR r.rejection_source = 'poster')) AS poster_decided,
         EXISTS (SELECT 1 FROM public.bounty_requests r
                  WHERE r.bounty_id = g.id AND r.status = 'accepted') AS hired
  FROM genuine g
)
SELECT
  date_trunc('week', created_at)::date AS week,
  count(*) AS paid_at_hire,
  count(*) FILTER (WHERE first_time) AS first_time_posts,
  count(*) FILTER (WHERE card_on_file) AS card_on_file,
  count(*) FILTER (WHERE with_apps) AS with_apps,
  count(*) FILTER (WHERE poster_decided) AS poster_decided,
  count(*) FILTER (WHERE hired) AS hired
FROM scored
GROUP BY 1
ORDER BY 1;
