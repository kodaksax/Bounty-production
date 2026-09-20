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
--   poster_gone_dark          — poster of an open bounty has not been active
--                                (profiles.last_session_at) in 48h.
--                                profiles.last_seen_at is NOT an activity
--                                signal in this schema: it is NULL for every
--                                production profile and nothing writes it
--                                (see 20260818120000_add_count_active_hunters_
--                                nearby.sql, which documents the same dead
--                                column). Real session activity is written to
--                                last_session_at by
--                                providers/moments-provider.tsx on every
--                                foreground session. NULL last_session_at
--                                (never had a tracked session -- e.g. a
--                                pre-tracking account that hasn't opened the
--                                app since) is excluded rather than treated as
--                                "gone dark", to avoid false positives on old
--                                accounts.
--
-- Read-only, like every Command Center function: this reports stuck demand,
-- it does not act on it. The one-tap actions on the client are "Message
-- poster" (the existing messenger thread route) and "View bounty" (the
-- existing admin bounty timeline/detail route) — no new write path.
--
-- TRUNCATION
-- ----------
-- The five buckets are UNIONed and returned in one priority-ordered,
-- p_limit-capped result. With a single flat LIMIT applied after the union,
-- a bucket that happens to sort first (no_geom) and is large enough can
-- consume the entire response and silently hide every row from the other
-- four buckets -- there is no way for an operator to tell "this bucket is
-- genuinely empty" from "this bucket got crowded out". To keep every bucket
-- represented in a bounded response:
--   * each bucket is capped independently at p_per_bucket_limit (default
--     100) BEFORE the union-wide ORDER BY / LIMIT p_limit is applied, so one
--     bucket cannot starve the others;
--   * every row also carries `bucket_total`, the true count for its bucket
--     before that per-bucket cap, so the client can render "showing 100 of
--     412" instead of presenting a capped list as if it were complete.

-- Adding p_per_bucket_limit makes this a distinct overload from the original
-- admin_liquidity_board(integer), not a replacement of it -- CREATE OR
-- REPLACE only reuses an existing function when the argument list matches
-- exactly. Left alone, both signatures would coexist and a PostgREST call
-- passing only p_limit (as every current client does) would fail with
-- PGRST203 "Could not choose the best candidate function" because both
-- overloads accept it. Drop the old one explicitly.
DROP FUNCTION IF EXISTS public.admin_liquidity_board(integer);

CREATE OR REPLACE FUNCTION public.admin_liquidity_board(
  p_limit integer DEFAULT 500,
  p_per_bucket_limit integer DEFAULT 100
)
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
  detail          jsonb,
  bucket_total    integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 500), 1), 2000);
  v_bucket_limit integer := LEAST(GREATEST(COALESCE(p_per_bucket_limit, 100), 1), 500);
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
           b.funding_mode, pr.last_session_at,
           GREATEST(0, ROUND(EXTRACT(epoch FROM now() - pr.last_session_at) / 3600.0))::int,
           jsonb_build_object('last_session_at', pr.last_session_at)
    FROM public.bounties b
    JOIN public.profiles pr ON pr.id = COALESCE(b.poster_id, b.user_id)
    WHERE b.status::text = 'open'
      AND NOT COALESCE(b.is_test, false)
      AND pr.last_session_at IS NOT NULL
      AND pr.last_session_at < now() - interval '48 hours'
  ),
  ranked AS (
    SELECT r.*,
           count(*) OVER (PARTITION BY r.bucket)::int AS bucket_total,
           row_number() OVER (PARTITION BY r.bucket ORDER BY r.stuck_hours DESC) AS rn
    FROM rows r
  )
  SELECT ranked.bucket, ranked.bounty_id, ranked.poster_id, ranked.poster_username, ranked.title, ranked.amount,
         ranked.status, ranked.funding_mode, ranked.stuck_since, ranked.stuck_hours, ranked.detail,
         ranked.bucket_total
  FROM ranked
  WHERE ranked.rn <= v_bucket_limit
  ORDER BY CASE ranked.bucket
             WHEN 'no_geom' THEN 0
             WHEN 'zero_applications' THEN 1
             WHEN 'unopened_applications' THEN 2
             WHEN 'funding_required_no_hire' THEN 3
             WHEN 'poster_gone_dark' THEN 4
             ELSE 5
           END,
           ranked.stuck_hours DESC
  LIMIT v_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_liquidity_board(integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_liquidity_board(integer, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_liquidity_board(integer, integer) TO authenticated, service_role;
