-- =====================================================================
-- Follow-up to 20260925220000_request_outcomes_and_absent_poster_sweep.sql
-- (already applied to production 2026-09-25, so it is left as applied and
-- these fixes ship as their own migration). From the PR #865 review:
--
--   (1) fn_bounty_may_hold_funds: one conservative funding check, now
--       including architecture-v3 state. bounty_v3_funding is the source of
--       truth for v3 funding and an at_accept v3 bounty can hold an
--       authorization while still open, so the sweep's inline check
--       (bounty_payments / wallet_transactions / at_post amount) called it
--       unfunded and would have archived it.
--
--   (2) fn_expire_bounty_requests skips bounties that already have a worker
--       (issue #864: 2a39dbf2 is open with an accepted hunter, and its
--       external applicants were told the poster "didn't respond"). Applied
--       to the dry-run AND write paths so the preview matches the real run.
--       The notice says "didn't make a decision in time": interacted rows
--       expire 168h after the poster engaged (e.g. messaged), so "didn't
--       respond" was false for them.
--
--   (3) fn_sweep_absent_posters:
--       * locks each candidate's pending requests, then the bounty (the
--         same order fn_accept_bounty_request uses), and re-checks that the
--         bounty is still open and unassigned before closing anything. The
--         candidate scan held no lock, so a concurrent accept could land
--         between scan and write and the sweep would archive a bounty that
--         had just gone in_progress. Both locks are NOWAIT: a bounty under
--         contention is skipped for this run rather than waited on, so the
--         sweep can never deadlock with an accept or a bounty close.
--       * re-evaluates funding (1) after the lock, not from the scan.
--       * writes one absent_poster_sweep_runs row per real run, including
--         runs that closed nothing, so every real sweep leaves a record.
--
-- Nothing here writes to bounty_requests or bounties when applied.
--
-- DONE MEANS OBSERVED:
--   * absent_poster_sweep_runs has a row for every real sweep (even a no-op).
--   * fn_expire_bounty_requests(true) returns 0 rows whose bounty has
--     accepted_by / accepted_request_id set, and 2a39dbf2's pending
--     applications stay pending across expiry runs.
--
-- Rollback: see the end of this file.
-- =====================================================================

BEGIN;

-- ─── (1) Conservative "may this bounty hold funds?" ────────────────────────
-- Any sign of money in any payment architecture counts. False positives only
-- mean a human resolves the bounty instead of the sweep archiving it.
CREATE OR REPLACE FUNCTION public.fn_bounty_may_hold_funds(p_bounty_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT
    EXISTS (SELECT 1 FROM public.bounty_payments bp WHERE bp.bounty_id = p_bounty_id)
    OR EXISTS (SELECT 1 FROM public.wallet_transactions wt WHERE wt.bounty_id = p_bounty_id)
    -- v3: any funding row at all, whatever its state.
    OR EXISTS (SELECT 1 FROM public.bounty_v3_funding bf WHERE bf.bounty_id = p_bounty_id)
    OR EXISTS (SELECT 1 FROM public.bounties b
               WHERE b.id = p_bounty_id
                 AND NOT COALESCE(b.is_for_honor, false)
                 AND COALESCE(b.funding_mode, 'at_post') <> 'at_accept'
                 AND COALESCE(b.amount, 0) > 0);
$$;

REVOKE ALL ON FUNCTION public.fn_bounty_may_hold_funds(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_bounty_may_hold_funds(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.fn_bounty_may_hold_funds(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_bounty_may_hold_funds(uuid) TO service_role;

-- ─── (2) Expiry: skip bounties that already have a worker ──────────────────
-- Same signature and return type as 20260925220000, so CREATE OR REPLACE
-- keeps its grants.
CREATE OR REPLACE FUNCTION public.fn_expire_bounty_requests(p_dry_run boolean DEFAULT false)
RETURNS TABLE(request_id uuid, bounty_id uuid, hunter_id uuid, poster_id uuid, hours_open numeric, poster_interacted boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_expiry_hours     integer;
  v_interacted_hours integer;
  v_enabled_at       timestamptz;
BEGIN
  -- Singleton row selected by its known key (id = true), not LIMIT 1.
  SELECT request_expiry_hours, request_interacted_expiry_hours, request_lifecycle_enabled_at
    INTO v_expiry_hours, v_interacted_hours, v_enabled_at
  FROM public.posting_policy_config WHERE id = true;

  v_expiry_hours     := COALESCE(v_expiry_hours, 72);
  v_interacted_hours := COALESCE(v_interacted_hours, 168);
  -- Fail closed: no watermark means nothing is eligible, never "everything".
  v_enabled_at       := COALESCE(v_enabled_at, now());

  -- Keep this WHERE clause identical to the write path's below.
  IF p_dry_run THEN
    RETURN QUERY
    SELECT br.id, br.bounty_id, br.hunter_id, br.poster_id,
           round(EXTRACT(epoch FROM (now() - br.created_at)) / 3600.0, 1),
           br.poster_interacted_at IS NOT NULL
    FROM public.bounty_requests br
    JOIN public.bounties b ON b.id = br.bounty_id
    WHERE br.status = 'pending'
      AND br.accepted_at IS NULL
      AND br.rejected_at IS NULL
      AND br.hunter_id IS NOT NULL
      AND b.status = 'open'
      -- A worker is already set (#864): the poster did decide, just not on
      -- these rows. Not expiry's to close, and "no decision" would be false.
      AND b.accepted_by IS NULL
      AND b.accepted_request_id IS NULL
      AND br.created_at >= v_enabled_at
      AND br.created_at < now() - make_interval(hours => v_expiry_hours)
      AND (br.poster_interacted_at IS NULL
           OR br.poster_interacted_at < now() - make_interval(hours => v_interacted_hours));
    RETURN;
  END IF;

  RETURN QUERY
  WITH expired AS (
    UPDATE public.bounty_requests br
    SET status = 'rejected', rejection_source = 'system_expiry'
    FROM public.bounties b
    WHERE br.bounty_id = b.id
      AND br.status = 'pending'
      AND br.accepted_at IS NULL
      AND br.rejected_at IS NULL
      -- bounty_requests_hunter_id_present is NOT VALID, so an UPDATE of a
      -- legacy NULL-hunter row fails the check and would abort the whole
      -- batch. Those rows have no one to notify anyway.
      AND br.hunter_id IS NOT NULL
      AND b.status = 'open'
      AND b.accepted_by IS NULL
      AND b.accepted_request_id IS NULL
      AND br.created_at >= v_enabled_at
      AND br.created_at < now() - make_interval(hours => v_expiry_hours)
      AND (br.poster_interacted_at IS NULL
           OR br.poster_interacted_at < now() - make_interval(hours => v_interacted_hours))
    RETURNING br.id, br.bounty_id, br.hunter_id, br.poster_id, br.created_at, br.poster_interacted_at
  ),
  notified AS (
    INSERT INTO public.notifications_outbox (recipients, title, body, data, bounty_id)
    SELECT
      jsonb_build_array(e.hunter_id),
      'Application closed',
      'The poster didn''t make a decision in time, so this application closed automatically -- this wasn''t a rejection. Feel free to apply to other bounties nearby.',
      jsonb_build_object(
        'type', 'application_expired',
        'bountyId', e.bounty_id,
        'applicationId', e.id,
        'requestId', e.id,
        'reason', 'no_response'
      ),
      e.bounty_id::text
    FROM expired e
    RETURNING 1
  )
  SELECT e.id, e.bounty_id, e.hunter_id, e.poster_id,
         round(EXTRACT(epoch FROM (now() - e.created_at)) / 3600.0, 1),
         e.poster_interacted_at IS NOT NULL
  FROM expired e;
END;
$$;

-- ─── (3) Sweep: run-level audit log ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.absent_poster_sweep_runs (
  sweep_id         uuid PRIMARY KEY,
  started_at       timestamptz NOT NULL DEFAULT now(),
  finished_at      timestamptz,
  absent_days      integer NOT NULL,
  -- Bounties the scan selected / actually changed / left alone because they
  -- were locked, changed state, or had nothing pending by the time the sweep
  -- got to them.
  bounties_scanned integer NOT NULL DEFAULT 0,
  bounties_swept   integer NOT NULL DEFAULT 0,
  bounties_skipped integer NOT NULL DEFAULT 0,
  requests_closed  integer NOT NULL DEFAULT 0
);

COMMENT ON TABLE public.absent_poster_sweep_runs IS
  'One row per real (non-dry-run) fn_sweep_absent_posters run, including runs that closed nothing. Per-bounty detail is in absent_poster_sweep_log under the same sweep_id. Service-role only.';

ALTER TABLE public.absent_poster_sweep_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.absent_poster_sweep_runs FROM PUBLIC;
REVOKE ALL ON public.absent_poster_sweep_runs FROM anon;
REVOKE ALL ON public.absent_poster_sweep_runs FROM authenticated;

COMMENT ON TABLE public.absent_poster_sweep_log IS
  'One row per bounty closed by a real (non-dry-run) fn_sweep_absent_posters run. The row set for one run shares sweep_id with its absent_poster_sweep_runs row. Service-role only.';

-- ─── (3) Sweep: lock, re-check, then write ──────────────────────────────────
-- Same signature and return type as 20260925220000.
CREATE OR REPLACE FUNCTION public.fn_sweep_absent_posters(
  p_dry_run     boolean DEFAULT true,
  p_absent_days integer DEFAULT NULL
)
RETURNS TABLE(
  sweep_id uuid, request_id uuid, bounty_id uuid, hunter_id uuid, poster_id uuid,
  poster_is_internal boolean, poster_last_active_at timestamptz, bounty_action text,
  request_created_at timestamptz, dry_run boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
#variable_conflict use_column
DECLARE
  v_days      integer;
  v_sweep_id  uuid := gen_random_uuid();
  r           record;
  v_ids       uuid[];
  v_locked    boolean;
  v_status    text;
  v_worker    uuid;
  v_accepted  uuid;
  v_poster    uuid;
  v_funded    boolean;
  v_scanned   integer := 0;
  v_swept     integer := 0;
  v_skipped   integer := 0;
  v_closed    integer := 0;
BEGIN
  SELECT absent_poster_days INTO v_days FROM public.posting_policy_config WHERE id = true;
  v_days := COALESCE(p_absent_days, v_days, 14);
  IF v_days < 7 THEN
    RAISE EXCEPTION 'absent_days % is below the 7-day floor', v_days;
  END IF;

  -- Written first so a real run is recorded even if it finds nothing.
  IF NOT p_dry_run THEN
    INSERT INTO public.absent_poster_sweep_runs (sweep_id, absent_days)
    VALUES (v_sweep_id, v_days);
  END IF;

  FOR r IN
    WITH cand AS (
      SELECT b.id AS bounty_id, b.poster_id, b.title,
             -- Dry-run reporting only; the real path re-evaluates after the lock.
             public.fn_bounty_may_hold_funds(b.id) AS maybe_funded
      FROM public.bounties b
      WHERE b.status::text = 'open'
        AND b.poster_id IS NOT NULL
        -- An open bounty with a worker is in an inconsistent state (seen:
        -- 2a39dbf2, accepted 09-07, still open). Not this sweep's to fix.
        AND b.accepted_by IS NULL
        AND b.accepted_request_id IS NULL
        AND EXISTS (SELECT 1 FROM public.bounty_requests br
                    WHERE br.bounty_id = b.id AND br.status = 'pending' AND br.hunter_id IS NOT NULL)
    ),
    posters AS (SELECT DISTINCT c.poster_id FROM cand c),
    msg AS (
      SELECT m.sender_id AS poster_id, max(m.created_at) AS last_at
      FROM public.messages m WHERE m.sender_id IN (SELECT p.poster_id FROM posters p) GROUP BY 1
    ),
    posted AS (
      SELECT pb.poster_id, max(pb.created_at) AS last_at
      FROM public.bounties pb WHERE pb.poster_id IN (SELECT p.poster_id FROM posters p) GROUP BY 1
    ),
    decided AS (
      SELECT q.poster_id, max(GREATEST(
               COALESCE(q.accepted_at AT TIME ZONE 'UTC', '-infinity'),
               CASE WHEN q.rejection_source = 'poster'
                    THEN COALESCE(q.rejected_at AT TIME ZONE 'UTC', '-infinity') ELSE '-infinity' END,
               COALESCE(q.poster_interacted_at, '-infinity'))) AS last_at
      FROM public.bounty_requests q WHERE q.poster_id IN (SELECT p.poster_id FROM posters p) GROUP BY 1
    ),
    activity AS (
      SELECT p.poster_id,
             COALESCE(pr.is_internal, false) AS is_internal,
             NULLIF(GREATEST(
               COALESCE(pr.last_session_at, '-infinity'),
               COALESCE(u.last_sign_in_at, '-infinity'),
               COALESCE(msg.last_at, '-infinity'),
               COALESCE(posted.last_at, '-infinity'),
               COALESCE(decided.last_at, '-infinity')
             ), '-infinity'::timestamptz) AS last_active
      FROM posters p
      LEFT JOIN public.profiles pr ON pr.id = p.poster_id
      LEFT JOIN auth.users u       ON u.id = p.poster_id
      LEFT JOIN msg                ON msg.poster_id = p.poster_id
      LEFT JOIN posted             ON posted.poster_id = p.poster_id
      LEFT JOIN decided            ON decided.poster_id = p.poster_id
    )
    SELECT c.bounty_id, c.poster_id, c.title, c.maybe_funded, a.is_internal, a.last_active
    FROM cand c
    JOIN activity a ON a.poster_id = c.poster_id
    WHERE a.last_active IS NULL OR a.last_active < now() - make_interval(days => v_days)
    ORDER BY c.poster_id, c.bounty_id
  LOOP
    v_scanned := v_scanned + 1;

    IF p_dry_run THEN
      RETURN QUERY
      SELECT v_sweep_id, br.id, br.bounty_id, br.hunter_id, br.poster_id, r.is_internal, r.last_active,
             CASE WHEN r.maybe_funded THEN 'flagged_funded' ELSE 'archived' END,
             br.created_at, true
      FROM public.bounty_requests br
      WHERE br.bounty_id = r.bounty_id AND br.status = 'pending' AND br.hunter_id IS NOT NULL;
      CONTINUE;
    END IF;

    -- The scan above held no locks. Lock the pending requests, then the
    -- bounty -- fn_accept_bounty_request's order -- and re-check the bounty
    -- before writing. NOWAIT on both: a row someone else holds means this
    -- bounty is mid-change, so skip it this run instead of waiting (waiting
    -- while holding locks is how a sweep would deadlock with an accept or a
    -- bounty close, which lock in the opposite order).
    v_locked := true;
    BEGIN
      PERFORM 1 FROM public.bounty_requests br
      WHERE br.bounty_id = r.bounty_id AND br.status = 'pending' AND br.hunter_id IS NOT NULL
      ORDER BY br.id
      FOR UPDATE NOWAIT;

      SELECT b.status::text, b.accepted_by, b.accepted_request_id, b.poster_id
        INTO v_status, v_worker, v_accepted, v_poster
      FROM public.bounties b WHERE b.id = r.bounty_id
      FOR UPDATE NOWAIT;
    EXCEPTION WHEN lock_not_available THEN
      v_locked := false;
    END;

    IF NOT v_locked
       OR v_status IS DISTINCT FROM 'open'
       OR v_worker IS NOT NULL
       OR v_accepted IS NOT NULL
       OR v_poster IS DISTINCT FROM r.poster_id THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    -- Funding is re-read under the lock, never taken from the scan.
    v_funded := public.fn_bounty_may_hold_funds(r.bounty_id);

    -- Notifications are inserted straight from the closed rows, so each notice
    -- goes to exactly the hunter whose request it names. Only claim the
    -- bounty closed when it actually will be (unfunded -> archived below);
    -- a funded bounty stays open with is_stale set.
    WITH closed AS (
      UPDATE public.bounty_requests br
      SET status = 'rejected', rejection_source = 'system_poster_absent'
      WHERE br.bounty_id = r.bounty_id AND br.status = 'pending' AND br.hunter_id IS NOT NULL
      RETURNING br.id, br.hunter_id
    ),
    notified AS (
      INSERT INTO public.notifications_outbox (recipients, title, body, data, bounty_id)
      SELECT
        jsonb_build_array(c.hunter_id),
        'Application closed',
        CASE WHEN v_funded
          THEN 'The poster of "' || COALESCE(r.title, 'this bounty') || '" hasn''t been active on Bounty, so we closed your application -- this wasn''t a rejection. There are other bounties open nearby.'
          ELSE 'The poster of "' || COALESCE(r.title, 'this bounty') || '" hasn''t been active on Bounty, so we closed the bounty and your application -- this wasn''t a rejection. There are other bounties open nearby.'
        END,
        jsonb_build_object('type', 'application_expired', 'bountyId', r.bounty_id,
                           'applicationId', c.id, 'requestId', c.id, 'reason', 'poster_absent',
                           'bountyClosed', NOT v_funded),
        r.bounty_id::text
      FROM closed c
      RETURNING 1
    )
    SELECT array_agg(c.id ORDER BY c.id) INTO v_ids FROM closed c;

    IF v_ids IS NULL THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    -- Requests are already closed above, so the BNTY-11 close trigger finds
    -- nothing pending and cannot relabel them system_bounty_closed.
    IF v_funded THEN
      UPDATE public.bounties
      SET is_stale = true, stale_reason = 'poster_absent', stale_detected_at = now()
      WHERE id = r.bounty_id;
    ELSE
      UPDATE public.bounties
      SET status = 'archived', is_stale = true, stale_reason = 'poster_absent', stale_detected_at = now()
      WHERE id = r.bounty_id;
    END IF;

    INSERT INTO public.absent_poster_sweep_log
      (sweep_id, absent_days, poster_id, poster_is_internal, poster_last_active_at,
       bounty_id, bounty_action, requests_closed, request_ids)
    VALUES
      (v_sweep_id, v_days, r.poster_id, r.is_internal, r.last_active, r.bounty_id,
       CASE WHEN v_funded THEN 'flagged_funded' ELSE 'archived' END,
       cardinality(v_ids), v_ids);

    v_swept  := v_swept + 1;
    v_closed := v_closed + cardinality(v_ids);

    RETURN QUERY
    SELECT v_sweep_id, br.id, br.bounty_id, br.hunter_id, br.poster_id, r.is_internal, r.last_active,
           CASE WHEN v_funded THEN 'flagged_funded' ELSE 'archived' END,
           br.created_at, false
    FROM public.bounty_requests br
    WHERE br.id = ANY (v_ids);
  END LOOP;

  IF NOT p_dry_run THEN
    UPDATE public.absent_poster_sweep_runs s
    SET finished_at      = now(),
        bounties_scanned = v_scanned,
        bounties_swept   = v_swept,
        bounties_skipped = v_skipped,
        requests_closed  = v_closed
    WHERE s.sweep_id = v_sweep_id;
  END IF;
END;
$$;

COMMIT;

-- ─── Rollback ───────────────────────────────────────────────────────────────
--   Re-run sections (3) and (5) of 20260925220000 to restore the previous
--   fn_expire_bounty_requests and fn_sweep_absent_posters, then:
--   DROP FUNCTION IF EXISTS public.fn_bounty_may_hold_funds(uuid);
--   DROP TABLE IF EXISTS public.absent_poster_sweep_runs;
