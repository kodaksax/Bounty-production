-- =====================================================================
-- SBA-01 steps 3-4: the absent-poster sweep also closes dead listings that
-- have no pending applications.
--
-- fn_sweep_absent_posters (20260925220000, lock/re-check added in
-- 20260925230000) only considered open bounties with at least one pending
-- request. A listing whose applications had already expired under the 72h
-- rule stayed open and appliable forever, so hunters kept applying to posters
-- who had left (Shoal behavioral audit 2026-10-15, SBA-01). After the first
-- real sweep on 2026-10-19 (sweep_id 967fd00f) three such listings remained
-- on production: 9f5355f6, 85ab8334, 11af999b -- all unfunded, none pending.
--
-- Change (same function, same signature, same return type, same daily cron
-- job absent-poster-sweep-daily -- no second way to close a bounty):
--
--   * Candidates are open, unassigned bounties whose poster is absent AND
--     either (a) have a pending request -- unchanged, every poster -- or
--     (b) have none, are not is_test, have an external (non-is_internal)
--     poster, and have not already been flagged poster_absent. (b) is new.
--   * Poster activity is unchanged: the latest of last_session_at,
--     auth.users.last_sign_in_at, messages sent, bounties posted, and
--     application decisions/interactions.
--   * Money is unchanged: fn_bounty_may_hold_funds is re-read under the row
--     lock. A bounty that may hold funds is never archived; it is flagged
--     (is_stale, stale_reason = 'poster_absent', bounty_action
--     'flagged_funded') for a human, exactly as before. A live owner-refund
--     claim (#883 / 20261013140000) now also counts as "may hold funds", so a
--     bounty whose escrow is mid-refund is only ever flagged, never archived.
--     Flagging changes no status, so it cannot interleave with an accept.
--   * Locking is unchanged: pending requests then the bounty, both NOWAIT,
--     then re-check status / worker / poster (plus is_test and the flag for
--     path (b)) before writing.
--   * A bounty swept with nothing pending writes an absent_poster_sweep_log
--     row with requests_closed = 0 and request_ids = '{}', and returns one
--     row with request_id / hunter_id / request_created_at NULL. No hunter is
--     notified (nobody has a pending application) and the poster is not
--     notified (the sweep never has notified posters).
--   * A funded bounty that has already been flagged and has nothing pending
--     is skipped, so the daily job does not re-flag and re-log it every day.
--
-- Nothing in this migration writes to bounty_requests or bounties when
-- applied. The function still defaults to dry-run.
--
-- DONE MEANS OBSERVED (a week after apply on production, should be 0):
--   SELECT count(*)
--   FROM bounties b JOIN profiles p ON p.id = b.poster_id
--   WHERE b.status = 'open' AND b.is_test IS NOT TRUE AND p.is_internal IS NOT TRUE
--     AND COALESCE(p.last_session_at, b.created_at) < now() - interval '14 days';
-- and absent_poster_sweep_log gains rows with requests_closed = 0.
--
-- Rollback: re-run section "(3) Sweep: lock, re-check, then write" of
-- 20260925230000_request_outcomes_review_fixes.sql (same signature, so
-- CREATE OR REPLACE restores it and keeps the grants). Bounties archived by
-- this path can be reopened from the log:
--   UPDATE bounties SET status = 'open', is_stale = false, stale_reason = NULL, stale_detected_at = NULL
--   WHERE id IN (SELECT bounty_id FROM absent_poster_sweep_log
--                WHERE sweep_id = '<id>' AND requests_closed = 0 AND bounty_action = 'archived');
-- =====================================================================

BEGIN;

COMMENT ON TABLE public.absent_poster_sweep_log IS
  'One row per bounty closed or flagged by a real (non-dry-run) fn_sweep_absent_posters run. The row set for one run shares sweep_id with its absent_poster_sweep_runs row. requests_closed = 0 (request_ids = ''{}'') means a dead listing with no pending applications, swept since 2026-10-19 (SBA-01). Service-role only.';

-- Same signature and return type as 20260925230000, so CREATE OR REPLACE
-- keeps its grants (service_role only).
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
  v_is_test   boolean;
  v_flagged   boolean;
  v_funded    boolean;
  v_action    text;
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
    WITH open_unassigned AS (
      SELECT b.id AS bounty_id, b.poster_id, b.title,
             EXISTS (SELECT 1 FROM public.bounty_requests br
                     WHERE br.bounty_id = b.id AND br.status = 'pending' AND br.hunter_id IS NOT NULL) AS has_pending,
             -- Path (b) eligibility: a dead listing with nothing pending is
             -- only swept for external posters on real bounties, and only
             -- once (a funded one stays open, flagged, for a human).
             (b.is_test IS NOT TRUE
              AND NOT COALESCE(pi.is_internal, false)
              AND NOT (COALESCE(b.is_stale, false) AND b.stale_reason = 'poster_absent')) AS empty_eligible
      FROM public.bounties b
      LEFT JOIN public.profiles pi ON pi.id = b.poster_id
      WHERE b.status::text = 'open'
        AND b.poster_id IS NOT NULL
        -- An open bounty with a worker is in an inconsistent state (seen:
        -- 2a39dbf2, accepted 09-07, still open). Not this sweep's to fix.
        AND b.accepted_by IS NULL
        AND b.accepted_request_id IS NULL
    ),
    cand AS (
      SELECT o.bounty_id, o.poster_id, o.title, o.has_pending, o.empty_eligible,
             -- Dry-run reporting only; the real path re-evaluates after the lock.
             (public.fn_bounty_may_hold_funds(o.bounty_id)
              OR EXISTS (SELECT 1 FROM public.bounty_owner_refund_claims oc
                         WHERE oc.bounty_id = o.bounty_id)) AS maybe_funded
      FROM open_unassigned o
      WHERE o.has_pending OR o.empty_eligible
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
    SELECT c.bounty_id, c.poster_id, c.title, c.maybe_funded, c.has_pending, c.empty_eligible,
           a.is_internal, a.last_active
    FROM cand c
    JOIN activity a ON a.poster_id = c.poster_id
    WHERE a.last_active IS NULL OR a.last_active < now() - make_interval(days => v_days)
    ORDER BY c.poster_id, c.bounty_id
  LOOP
    v_scanned := v_scanned + 1;

    IF p_dry_run THEN
      v_action := CASE WHEN r.maybe_funded THEN 'flagged_funded' ELSE 'archived' END;
      RETURN QUERY
      SELECT v_sweep_id, br.id, br.bounty_id, br.hunter_id, br.poster_id, r.is_internal, r.last_active,
             v_action, br.created_at, true
      FROM public.bounty_requests br
      WHERE br.bounty_id = r.bounty_id AND br.status = 'pending' AND br.hunter_id IS NOT NULL;
      -- Nothing pending: one row for the bounty itself.
      IF NOT FOUND THEN
        RETURN QUERY
        SELECT v_sweep_id, NULL::uuid, r.bounty_id, NULL::uuid, r.poster_id, r.is_internal, r.last_active,
               v_action, NULL::timestamptz, true;
      END IF;
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

      SELECT b.status::text, b.accepted_by, b.accepted_request_id, b.poster_id,
             COALESCE(b.is_test, false),
             COALESCE(b.is_stale, false) AND b.stale_reason IS NOT DISTINCT FROM 'poster_absent'
        INTO v_status, v_worker, v_accepted, v_poster, v_is_test, v_flagged
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

    -- Funding is re-read under the lock, never taken from the scan. A live
    -- owner-refund claim (#883) means escrow is or was being returned: flag,
    -- never archive.
    v_funded := public.fn_bounty_may_hold_funds(r.bounty_id)
                OR EXISTS (SELECT 1 FROM public.bounty_owner_refund_claims oc
                           WHERE oc.bounty_id = r.bounty_id);
    v_action := CASE WHEN v_funded THEN 'flagged_funded' ELSE 'archived' END;

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

    -- Nothing pending (path (b), or the scan's pending rows were decided in
    -- the meantime): sweep the listing itself only if it is eligible on the
    -- state just read under the lock.
    IF v_ids IS NULL
       AND (v_is_test OR r.is_internal OR v_flagged) THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;
    v_ids := COALESCE(v_ids, '{}'::uuid[]);

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
       v_action, cardinality(v_ids), v_ids);

    v_swept  := v_swept + 1;
    v_closed := v_closed + cardinality(v_ids);

    IF cardinality(v_ids) = 0 THEN
      RETURN QUERY
      SELECT v_sweep_id, NULL::uuid, r.bounty_id, NULL::uuid, r.poster_id, r.is_internal, r.last_active,
             v_action, NULL::timestamptz, false;
    ELSE
      RETURN QUERY
      SELECT v_sweep_id, br.id, br.bounty_id, br.hunter_id, br.poster_id, r.is_internal, r.last_active,
             v_action, br.created_at, false
      FROM public.bounty_requests br
      WHERE br.id = ANY (v_ids);
    END IF;
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

-- Defensive: CREATE OR REPLACE keeps the existing grants, but a fresh
-- database that never ran 20260925220000's REVOKEs must not end up with
-- PUBLIC execute on a SECURITY DEFINER write path.
REVOKE ALL ON FUNCTION public.fn_sweep_absent_posters(boolean, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_sweep_absent_posters(boolean, integer) FROM anon;
REVOKE ALL ON FUNCTION public.fn_sweep_absent_posters(boolean, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_sweep_absent_posters(boolean, integer) TO service_role;

COMMIT;
