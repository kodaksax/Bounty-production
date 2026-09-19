-- Migration: admin_liquidity_board() — founder Liquidity Board (BNTY-10)
-- Created: 2026-09-19
--
-- WHY THIS EXISTS
-- ----------------
-- The founder audit behind this ticket needed ~30 manual queries to find
-- stuck demand (open bounties nobody can see, applications nobody opened,
-- posters who vanished). This is one admin-gated RPC that answers "where is
-- the marketplace stuck right now" in one round trip, so the answer is a
-- screen load instead of a psql session.
--
-- Depends on public.bounty_events / admin_assert_role() from
-- 20260828130000_bounty_events_command_center.sql -- that migration must be
-- applied first. This function itself only reads bounties / bounty_requests /
-- profiles; it does not read bounty_events, but it follows the exact same
-- admin-gate pattern (`admin_assert_role()` first line, SECURITY DEFINER,
-- REVOKE PUBLIC/anon then GRANT authenticated/service_role) established
-- there and reused across every admin_* function since
-- (20260829120000_bounty_moderation_queue.sql,
-- 20260904020000_admin_bounty_status_authorization_fix.sql). See
-- docs/development/COMMAND_CENTER.md "Reads (all admin-gated)".
--
-- BUCKETS
-- -------
-- All five scope out `bounties.is_test` (per BNTY-10: "non-test bounties").
--
--   no_geom                   — open, geom IS NULL: structurally invisible to
--                                any nearby/radius search.
--   zero_applications         — open > 2h with no bounty_requests row at all.
--   unopened_applications     — open bounty with a pending application older
--                                than 24h the poster has never opened
--                                (bounty_requests.poster_interacted_at IS
--                                NULL). Aggregated per bounty: a poster only
--                                needs to see this once, not once per stale
--                                application.
--   funding_required_no_hire  — pay-at-accept (funding_mode='at_accept') open
--                                bounty with no hire 24h after posting. There
--                                is no DB column for the client-side
--                                "accept_funding_required" gate (see
--                                hooks/useAcceptFunding.ts — it is a pure UI
--                                moment between tapping Select and the
--                                acceptance RPC, nothing persists it). This is
--                                the closest server-observable proxy: demand
--                                that reached deferred-funding but never
--                                converted to a hire.
--   poster_gone_dark          — poster of an open bounty has not been seen
--                                (profiles.last_seen_at) in 48h. NULL
--                                last_seen_at (pre-dates the column) is
--                                excluded rather than treated as "gone dark",
--                                to avoid false positives on old accounts.
--
-- Read-only, like every Command Center function: this reports stuck demand,
-- it does not act on it. The one-tap actions on the client are "Message
-- poster" (the existing messenger thread route) and "View bounty" (the
-- existing admin bounty timeline/detail route) — no new write path.

CREATE OR REPLACE FUNCTION public.admin_liquidity_board(p_limit integer DEFAULT 500)
RETURNS TABLE (
  bucket          text,
  bounty_id       uuid,
  poster_id       uuid,
  poster_username text,
  title           text,
  amount          numeric,
  status          text,
  funding_mode    text,
  stuck_since     timestamptz,
  stuck_hours     integer,
  detail          jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 500), 1), 2000);
BEGIN
  PERFORM public.admin_assert_role();

  RETURN QUERY
  WITH rows AS (

    SELECT 'no_geom'::text AS bucket, b.id AS bounty_id, COALESCE(b.poster_id, b.user_id) AS poster_id,
           COALESCE(pr.username, pr.display_name) AS poster_username, b.title, b.amount, b.status::text AS status,
           b.funding_mode, b.created_at AS stuck_since,
           GREATEST(0, ROUND(EXTRACT(epoch FROM now() - b.created_at) / 3600.0))::int AS stuck_hours,
           jsonb_build_object('reason', 'No location set; excluded from nearby search') AS detail
    FROM public.bounties b
    LEFT JOIN public.profiles pr ON pr.id = COALESCE(b.poster_id, b.user_id)
    WHERE b.status::text = 'open'
      AND NOT COALESCE(b.is_test, false)
      AND b.geom IS NULL

    UNION ALL

    SELECT 'zero_applications', b.id, COALESCE(b.poster_id, b.user_id),
           COALESCE(pr.username, pr.display_name), b.title, b.amount, b.status::text,
           b.funding_mode, b.created_at,
           GREATEST(0, ROUND(EXTRACT(epoch FROM now() - b.created_at) / 3600.0))::int,
           jsonb_build_object('reason', 'No applications since posting')
    FROM public.bounties b
    LEFT JOIN public.profiles pr ON pr.id = COALESCE(b.poster_id, b.user_id)
    WHERE b.status::text = 'open'
      AND NOT COALESCE(b.is_test, false)
      AND b.created_at < now() - interval '2 hours'
      AND NOT EXISTS (SELECT 1 FROM public.bounty_requests r WHERE r.bounty_id = b.id)

    UNION ALL

    SELECT 'unopened_applications', b.id, COALESCE(b.poster_id, b.user_id),
           COALESCE(pr.username, pr.display_name), b.title, b.amount, b.status::text,
           b.funding_mode, s.oldest_pending,
           GREATEST(0, ROUND(EXTRACT(epoch FROM now() - s.oldest_pending) / 3600.0))::int,
           jsonb_build_object('pending_unopened_count', s.n)
    FROM public.bounties b
    JOIN LATERAL (
      SELECT count(*) AS n, min(r.created_at) AS oldest_pending
      FROM public.bounty_requests r
      WHERE r.bounty_id = b.id
        AND r.status::text = 'pending'
        AND r.poster_interacted_at IS NULL
        AND r.created_at < now() - interval '24 hours'
    ) s ON s.n > 0
    LEFT JOIN public.profiles pr ON pr.id = COALESCE(b.poster_id, b.user_id)
    WHERE b.status::text = 'open'
      AND NOT COALESCE(b.is_test, false)

    UNION ALL

    SELECT 'funding_required_no_hire', b.id, COALESCE(b.poster_id, b.user_id),
           COALESCE(pr.username, pr.display_name), b.title, b.amount, b.status::text,
           b.funding_mode, b.created_at,
           GREATEST(0, ROUND(EXTRACT(epoch FROM now() - b.created_at) / 3600.0))::int,
           jsonb_build_object('reason', 'Pay-at-accept bounty with no hire 24h after posting')
    FROM public.bounties b
    LEFT JOIN public.profiles pr ON pr.id = COALESCE(b.poster_id, b.user_id)
    WHERE b.status::text = 'open'
      AND NOT COALESCE(b.is_test, false)
      AND b.funding_mode = 'at_accept'
      AND b.accepted_by IS NULL
      AND b.created_at < now() - interval '24 hours'

    UNION ALL

    SELECT 'poster_gone_dark', b.id, COALESCE(b.poster_id, b.user_id),
           COALESCE(pr.username, pr.display_name), b.title, b.amount, b.status::text,
           b.funding_mode, pr.last_seen_at,
           GREATEST(0, ROUND(EXTRACT(epoch FROM now() - pr.last_seen_at) / 3600.0))::int,
           jsonb_build_object('last_seen_at', pr.last_seen_at)
    FROM public.bounties b
    JOIN public.profiles pr ON pr.id = COALESCE(b.poster_id, b.user_id)
    WHERE b.status::text = 'open'
      AND NOT COALESCE(b.is_test, false)
      AND pr.last_seen_at IS NOT NULL
      AND pr.last_seen_at < now() - interval '48 hours'
  )
  SELECT r.bucket, r.bounty_id, r.poster_id, r.poster_username, r.title, r.amount, r.status,
         r.funding_mode, r.stuck_since, r.stuck_hours, r.detail
  FROM rows r
  ORDER BY CASE r.bucket
             WHEN 'no_geom' THEN 0
             WHEN 'zero_applications' THEN 1
             WHEN 'unopened_applications' THEN 2
             WHEN 'funding_required_no_hire' THEN 3
             WHEN 'poster_gone_dark' THEN 4
             ELSE 5
           END,
           r.stuck_hours DESC
  LIMIT v_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_liquidity_board(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_liquidity_board(integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_liquidity_board(integer) TO authenticated, service_role;
