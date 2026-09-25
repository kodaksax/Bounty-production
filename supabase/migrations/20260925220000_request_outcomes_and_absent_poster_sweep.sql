-- =====================================================================
-- Request outcomes: make "nobody decided" distinguishable from "the poster
-- decided", close the expiry gaps found on its first run, and add an
-- explicit, logged sweep for posters who have stopped using the app.
--
-- Context (measured 2026-09-25, after expire-stale-bounty-requests ran for the
-- first time at 19:00 UTC and closed 78 requests):
--
--   * rejection_source already separates 'poster' / 'system_expiry' /
--     'system_bounty_closed' on bounty_requests, but the bounty_events ledger
--     (trg_bounty_events_from_requests) recorded ALL 325 rejections as
--     'application.rejected' with actor_id = the poster -- including the 78
--     expiries and the 138 BNTY-11 zombie closures. Any Command Center count
--     of rejections was a count of system cleanups. Fixed going forward (1)
--     and relabelled for history by an opt-in, reversible function (2).
--
--   * poster_interacted_at made a request immune to expiry FOREVER. 26 of
--     the 74 post-watermark pending rows are immune today, so "pending rows
--     older than the window fall to 0" could never have been true. Interacted
--     rows now get their own, longer window (3).
--
--   * The 72h rule only covers requests created after the 2026-09-13
--     watermark, by design (the pre-period baseline). Hunters who applied to
--     posters who then left the app entirely are therefore never answered.
--     fn_sweep_absent_posters (5) handles that as its own, explicitly-invoked,
--     logged operation with its own rejection_source.
--
-- Nothing in this migration writes to bounty_requests or bounties when
-- applied. The two functions that do (fn_sweep_absent_posters,
-- ops_relabel_system_application_events) default to dry-run and are not
-- scheduled here.
--
-- DONE MEANS OBSERVED:
--   * bounty_requests.rejection_source = 'system_expiry' grows each day and
--     pending rows older than their window reach 0 (scripts/ops/
--     request-outcomes-verify.sql, queries 1-2).
--   * bounty_events rows with event_type = 'application.closed' appear for
--     every system closure after apply; zero new 'application.rejected' rows
--     have a system rejection_source.
--   * absent_poster_sweep_log has rows after the first real sweep.
--
-- Rollback: see the end of this file.
-- =====================================================================

BEGIN;

-- ─── rejection_source: a distinct value for the absent-poster sweep ────────
ALTER TABLE public.bounty_requests
  DROP CONSTRAINT IF EXISTS bounty_requests_rejection_source_check;
ALTER TABLE public.bounty_requests
  ADD CONSTRAINT bounty_requests_rejection_source_check
  CHECK (rejection_source IS NULL OR rejection_source IN (
    'poster', 'system_expiry', 'system_bounty_closed', 'system_poster_absent'
  ));

COMMENT ON COLUMN public.bounty_requests.rejection_source IS
  'Who/what moved this row to rejected. ''poster'' = a human decision (default, stamped by trg_bounty_requests_stamp_decision for any writer that does not set it explicitly). ''system_expiry'' = fn_expire_bounty_requests closed it because the poster never decided within request_expiry_hours (or request_interacted_expiry_hours after engaging). ''system_bounty_closed'' = the bounty itself left status=open while this was pending. ''system_poster_absent'' = fn_sweep_absent_posters closed it because the poster had no activity for absent_poster_days. Every system_* value means NO poster decision was made: never count them as rejections. NULL on rows rejected before 2026-09-13. Use bounty_request_outcomes rather than re-deriving this.';

-- ─── Config ─────────────────────────────────────────────────────────────────
ALTER TABLE public.posting_policy_config
  ADD COLUMN IF NOT EXISTS request_interacted_expiry_hours integer NOT NULL DEFAULT 168,
  ADD COLUMN IF NOT EXISTS absent_poster_days integer NOT NULL DEFAULT 14;

COMMENT ON COLUMN public.posting_policy_config.request_interacted_expiry_hours IS
  'Hours after poster_interacted_at that a still-pending request is closed by fn_expire_bounty_requests. Before 2026-09-25 an interacted request never expired, which left it pending indefinitely. Default 168h (7 days).';

COMMENT ON COLUMN public.posting_policy_config.absent_poster_days IS
  'fn_sweep_absent_posters treats a poster as absent after this many days with no activity (session, sign-in, message, bounty posted, application decided or opened). Default 14.';

-- ─── (1) Ledger: system closures are not poster rejections ─────────────────
-- 'application.rejected' now means a poster decision only. Every system_*
-- closure is recorded as 'application.closed' with no actor (the poster did
-- not act) and its rejection_source in metadata. rejection_source is already
-- final here: trg_bounty_requests_stamp_decision is BEFORE UPDATE and this is
-- AFTER.
CREATE OR REPLACE FUNCTION public.trg_bounty_events_from_requests()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_system boolean;
  v_type   text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.record_bounty_event(
      'application.submitted:' || NEW.id,
      'application.submitted',
      'app',
      NEW.bounty_id,
      NEW.hunter_id,
      NEW.created_at,
      NULL,
      NULL,
      jsonb_build_object('request_id', NEW.id, 'poster_id', NEW.poster_id, 'has_message', NEW.message IS NOT NULL)
    );
    RETURN NULL;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status::text IN ('accepted', 'rejected') THEN
    v_system := NEW.status::text = 'rejected' AND COALESCE(NEW.rejection_source, '') LIKE 'system\_%';
    v_type := CASE WHEN v_system THEN 'application.closed' ELSE 'application.' || NEW.status END;

    PERFORM public.record_bounty_event(
      v_type || ':' || NEW.id,
      v_type,
      CASE WHEN v_system THEN 'system' ELSE 'app' END,
      NEW.bounty_id,
      CASE WHEN v_system THEN NULL ELSE NEW.poster_id END,
      COALESCE(
        CASE WHEN NEW.status::text = 'accepted' THEN NEW.accepted_at ELSE NEW.rejected_at END AT TIME ZONE 'UTC',
        NEW.updated_at,
        now()
      ),
      NULL,
      NULL,
      jsonb_build_object(
        'request_id', NEW.id,
        'hunter_id', NEW.hunter_id,
        'poster_id', NEW.poster_id,
        'rejection_source', NEW.rejection_source
      )
    );
  END IF;

  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'bounty_events: bounty_requests trigger suppressed error: %', SQLERRM;
  RETURN NULL;
END;
$$;

-- ─── (2) Opt-in relabel of the ledger rows written before (1) ──────────────
-- Not run by this migration. Dry-run by default: returns the counts it would
-- change. p_revert = true undoes exactly what a real run did (it only touches
-- rows carrying metadata.relabeled_from, which only this function writes).
CREATE OR REPLACE FUNCTION public.ops_relabel_system_application_events(
  p_dry_run boolean DEFAULT true,
  p_revert  boolean DEFAULT false
)
RETURNS TABLE(rejection_source text, rows_affected bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF p_revert THEN
    IF p_dry_run THEN
      RETURN QUERY
      SELECT e.metadata->>'rejection_source', count(*)
      FROM public.bounty_events e
      WHERE e.event_type = 'application.closed' AND e.metadata ? 'relabeled_from'
      GROUP BY 1;
      RETURN;
    END IF;
    RETURN QUERY
    WITH reverted AS (
      UPDATE public.bounty_events e
      SET event_type = 'application.rejected',
          event_key  = e.metadata->'relabeled_from'->>'event_key',
          actor_id   = (e.metadata->'relabeled_from'->>'actor_id')::uuid,
          source     = e.metadata->'relabeled_from'->>'source',
          metadata   = (e.metadata - 'relabeled_from') - 'rejection_source'
      WHERE e.event_type = 'application.closed' AND e.metadata ? 'relabeled_from'
      RETURNING e.metadata->>'rejection_source' AS src
    )
    SELECT NULL::text, count(*) FROM reverted;
    RETURN;
  END IF;

  IF p_dry_run THEN
    RETURN QUERY
    SELECT br.rejection_source, count(*)
    FROM public.bounty_events e
    JOIN public.bounty_requests br ON br.id = (e.metadata->>'request_id')::uuid
    WHERE e.event_type = 'application.rejected'
      AND br.rejection_source LIKE 'system\_%'
    GROUP BY 1;
    RETURN;
  END IF;

  RETURN QUERY
  WITH relabeled AS (
    UPDATE public.bounty_events e
    SET event_type = 'application.closed',
        event_key  = 'application.closed:' || br.id,
        actor_id   = NULL,
        source     = 'system',
        metadata   = e.metadata
                     || jsonb_build_object('rejection_source', br.rejection_source, 'poster_id', br.poster_id)
                     || jsonb_build_object('relabeled_from', jsonb_build_object(
                          'event_key', e.event_key, 'actor_id', e.actor_id, 'source', e.source,
                          'relabeled_at', now()))
    FROM public.bounty_requests br
    WHERE br.id = (e.metadata->>'request_id')::uuid
      AND e.event_type = 'application.rejected'
      AND br.rejection_source LIKE 'system\_%'
    RETURNING br.rejection_source AS src
  )
  SELECT src, count(*) FROM relabeled GROUP BY 1;
END;
$$;

REVOKE ALL ON FUNCTION public.ops_relabel_system_application_events(boolean, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ops_relabel_system_application_events(boolean, boolean) FROM anon;
REVOKE ALL ON FUNCTION public.ops_relabel_system_application_events(boolean, boolean) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.ops_relabel_system_application_events(boolean, boolean) TO service_role;

-- ─── (3) Expiry: bounded window for interacted rows, richer payload ────────
-- Return type changes (adds poster_interacted), so DROP + CREATE. The only
-- caller is the expire-bounty-requests edge function, which reads columns by
-- name and ignores unknown ones, so the old deployed function keeps working
-- against this until it is redeployed.
DROP FUNCTION IF EXISTS public.fn_expire_bounty_requests(boolean);

CREATE FUNCTION public.fn_expire_bounty_requests(p_dry_run boolean DEFAULT false)
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
      'The poster didn''t respond in time, so this application closed automatically -- this wasn''t a rejection. Feel free to apply to other bounties nearby.',
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

REVOKE ALL ON FUNCTION public.fn_expire_bounty_requests(boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_expire_bounty_requests(boolean) FROM anon;
REVOKE ALL ON FUNCTION public.fn_expire_bounty_requests(boolean) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_expire_bounty_requests(boolean) TO service_role;

-- ─── (4) One canonical outcome per request ──────────────────────────────────
-- Every response-rate query should start here instead of reading status /
-- rejection_source directly. outcome_by says who produced the outcome:
-- 'poster' (a decision), 'system' (nobody decided), or NULL (still pending,
-- or a pre-2026-09-13 rejection whose source was never recorded).
CREATE OR REPLACE VIEW public.bounty_request_outcomes
WITH (security_invoker = true)
AS
SELECT
  br.id          AS request_id,
  br.bounty_id,
  br.poster_id,
  br.hunter_id,
  br.created_at,
  CASE
    WHEN br.status::text = 'accepted'                                THEN 'accepted'
    WHEN br.status::text = 'pending'                                 THEN 'pending'
    WHEN br.rejection_source = 'poster'                              THEN 'poster_declined'
    WHEN br.rejection_source = 'system_expiry'                       THEN 'expired_no_response'
    WHEN br.rejection_source = 'system_poster_absent'                THEN 'closed_poster_absent'
    WHEN br.rejection_source = 'system_bounty_closed'                THEN 'closed_bounty_gone'
    -- Pre-watermark rejections carry no source. The only decision path that
    -- existed then was accepting a sibling, so a filled bounty is attributable.
    WHEN b.accepted_request_id IS NOT NULL AND b.accepted_request_id <> br.id THEN 'not_selected'
    ELSE 'legacy_unknown'
  END AS outcome,
  CASE
    WHEN br.status::text = 'accepted' OR br.rejection_source = 'poster' THEN 'poster'
    WHEN br.rejection_source LIKE 'system\_%'                           THEN 'system'
    WHEN br.status::text = 'rejected'
         AND b.accepted_request_id IS NOT NULL AND b.accepted_request_id <> br.id THEN 'poster'
    ELSE NULL
  END AS outcome_by,
  CASE
    WHEN br.status::text = 'accepted' THEN br.accepted_at AT TIME ZONE 'UTC'
    WHEN br.status::text = 'rejected' THEN br.rejected_at AT TIME ZONE 'UTC'
  END AS outcome_at,
  (COALESCE(pp.is_internal, false) OR COALESCE(hp.is_internal, false) OR COALESCE(b.is_test, false)) AS involves_internal,
  -- The standing "legitimate external" cohort (decided 2026-09-25): no
  -- internal party, not a test bounty, poster account active, and the bounty
  -- was not removed by moderation as fraud. is_internal alone overcounts
  -- (89 vs 68 applications for 09-14..09-22).
  (NOT COALESCE(pp.is_internal, false)
   AND NOT COALESCE(hp.is_internal, false)
   AND NOT COALESCE(b.is_test, false)
   AND COALESCE(pp.account_status, 'active') = 'active'
   AND NOT EXISTS (SELECT 1 FROM public.bounty_moderation bm
                   WHERE bm.bounty_id = br.bounty_id AND bm.state = 'removed')) AS is_legitimate_external
FROM public.bounty_requests br
JOIN public.bounties b ON b.id = br.bounty_id
LEFT JOIN public.profiles pp ON pp.id = br.poster_id
LEFT JOIN public.profiles hp ON hp.id = br.hunter_id;

COMMENT ON VIEW public.bounty_request_outcomes IS
  'One outcome per bounty_request. Poster decision rate = outcome_by = ''poster'' / ALL applications in a fixed created_at cohort past a maturity cutoff (default 7 days). Every system closure (expired_no_response, closed_poster_absent, closed_bounty_gone) stays IN the denominator as a non-decision: excluding them makes the rate rise mechanically every time the expiry job runs, with no change in poster behaviour. Never filter bounty_requests.status = ''rejected'' to mean a poster decision -- use outcome_by. Service role only.';

REVOKE ALL ON public.bounty_request_outcomes FROM PUBLIC;
REVOKE ALL ON public.bounty_request_outcomes FROM anon;
REVOKE ALL ON public.bounty_request_outcomes FROM authenticated;
GRANT SELECT ON public.bounty_request_outcomes TO service_role;

-- ─── (5) Absent-poster sweep ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.absent_poster_sweep_log (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sweep_id              uuid NOT NULL,
  run_at                timestamptz NOT NULL DEFAULT now(),
  absent_days           integer NOT NULL,
  poster_id             uuid NOT NULL,
  poster_is_internal    boolean NOT NULL,
  poster_last_active_at timestamptz,
  bounty_id             uuid NOT NULL,
  -- archived        = unfunded bounty closed (status archived, is_stale)
  -- flagged_funded  = money may be attached: requests closed, bounty left
  --                   open with is_stale=true for a human to resolve
  bounty_action         text NOT NULL CHECK (bounty_action IN ('archived', 'flagged_funded')),
  requests_closed       integer NOT NULL,
  request_ids           uuid[] NOT NULL
);

COMMENT ON TABLE public.absent_poster_sweep_log IS
  'One row per bounty closed by a real (non-dry-run) fn_sweep_absent_posters run. The row set for one run shares sweep_id. Service-role only.';

CREATE INDEX IF NOT EXISTS absent_poster_sweep_log_run_idx ON public.absent_poster_sweep_log (run_at DESC);

ALTER TABLE public.absent_poster_sweep_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.absent_poster_sweep_log FROM PUBLIC;
REVOKE ALL ON public.absent_poster_sweep_log FROM anon;
REVOKE ALL ON public.absent_poster_sweep_log FROM authenticated;

-- Explicit and separate from fn_expire_bounty_requests: it is never called by
-- the 15-minute expiry job, it defaults to dry-run, and every real run is
-- logged. Unlike the 72h rule it deliberately includes pre-watermark
-- requests -- those hunters are exactly who this exists for -- but tags them
-- system_poster_absent so the pre-period baseline can still exclude them.
--
-- Poster activity is the latest of every signal we have, not last_session_at
-- alone: last_session_at is written client-side by MomentsProvider (shipped
-- 2026-07-15), so it is NULL for anyone last seen on an older build. It is
-- computed once per candidate poster in one set-based pass, not per bounty.
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
  v_days     integer;
  v_sweep_id uuid := gen_random_uuid();
  r          record;
  v_ids      uuid[];
BEGIN
  SELECT absent_poster_days INTO v_days FROM public.posting_policy_config WHERE id = true;
  v_days := COALESCE(p_absent_days, v_days, 14);
  IF v_days < 7 THEN
    RAISE EXCEPTION 'absent_days % is below the 7-day floor', v_days;
  END IF;

  FOR r IN
    WITH cand AS (
      SELECT b.id AS bounty_id, b.poster_id, b.title,
             -- Any sign of money: never change the status of a bounty that
             -- may hold funds. A human resolves those.
             (EXISTS (SELECT 1 FROM public.bounty_payments bp WHERE bp.bounty_id = b.id)
              OR EXISTS (SELECT 1 FROM public.wallet_transactions wt WHERE wt.bounty_id = b.id)
              OR (NOT COALESCE(b.is_for_honor, false)
                  AND COALESCE(b.funding_mode, 'at_post') <> 'at_accept'
                  AND COALESCE(b.amount, 0) > 0)) AS maybe_funded
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
    IF p_dry_run THEN
      RETURN QUERY
      SELECT v_sweep_id, br.id, br.bounty_id, br.hunter_id, br.poster_id, r.is_internal, r.last_active,
             CASE WHEN r.maybe_funded THEN 'flagged_funded' ELSE 'archived' END,
             br.created_at, true
      FROM public.bounty_requests br
      WHERE br.bounty_id = r.bounty_id AND br.status = 'pending' AND br.hunter_id IS NOT NULL;
      CONTINUE;
    END IF;

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
        CASE WHEN r.maybe_funded
          THEN 'The poster of "' || COALESCE(r.title, 'this bounty') || '" hasn''t been active on Bounty, so we closed your application -- this wasn''t a rejection. There are other bounties open nearby.'
          ELSE 'The poster of "' || COALESCE(r.title, 'this bounty') || '" hasn''t been active on Bounty, so we closed the bounty and your application -- this wasn''t a rejection. There are other bounties open nearby.'
        END,
        jsonb_build_object('type', 'application_expired', 'bountyId', r.bounty_id,
                           'applicationId', c.id, 'requestId', c.id, 'reason', 'poster_absent',
                           'bountyClosed', NOT r.maybe_funded),
        r.bounty_id::text
      FROM closed c
      RETURNING 1
    )
    SELECT array_agg(c.id ORDER BY c.id) INTO v_ids FROM closed c;

    CONTINUE WHEN v_ids IS NULL;

    -- Requests are already closed above, so the BNTY-11 close trigger finds
    -- nothing pending and cannot relabel them system_bounty_closed.
    IF r.maybe_funded THEN
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
       CASE WHEN r.maybe_funded THEN 'flagged_funded' ELSE 'archived' END,
       cardinality(v_ids), v_ids);

    RETURN QUERY
    SELECT v_sweep_id, br.id, br.bounty_id, br.hunter_id, br.poster_id, r.is_internal, r.last_active,
           CASE WHEN r.maybe_funded THEN 'flagged_funded' ELSE 'archived' END,
           br.created_at, false
    FROM public.bounty_requests br
    WHERE br.id = ANY (v_ids);
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_sweep_absent_posters(boolean, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_sweep_absent_posters(boolean, integer) FROM anon;
REVOKE ALL ON FUNCTION public.fn_sweep_absent_posters(boolean, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_sweep_absent_posters(boolean, integer) TO service_role;

COMMIT;

-- ─── Rollback ───────────────────────────────────────────────────────────────
-- Order matters: revert data first, then code.
--   SELECT * FROM public.ops_relabel_system_application_events(false, true);  -- only if a real relabel ran
--   -- Requests closed by a sweep: reopen from the log (bounties too):
--   --   UPDATE bounty_requests SET status='pending', rejection_source=NULL, rejected_at=NULL
--   --     WHERE id IN (SELECT unnest(request_ids) FROM absent_poster_sweep_log WHERE sweep_id = '<id>');
--   --   UPDATE bounties SET status='open', is_stale=false, stale_reason=NULL, stale_detected_at=NULL
--   --     WHERE id IN (SELECT bounty_id FROM absent_poster_sweep_log WHERE sweep_id = '<id>');
--   DROP FUNCTION IF EXISTS public.fn_sweep_absent_posters(boolean, integer);
--   DROP TABLE IF EXISTS public.absent_poster_sweep_log;
--   DROP VIEW IF EXISTS public.bounty_request_outcomes;
--   DROP FUNCTION IF EXISTS public.ops_relabel_system_application_events(boolean, boolean);
--   -- Restore fn_expire_bounty_requests and trg_bounty_events_from_requests
--   -- from 20260913000000 / the Command Center migration respectively.
--   ALTER TABLE public.posting_policy_config DROP COLUMN IF EXISTS request_interacted_expiry_hours,
--     DROP COLUMN IF EXISTS absent_poster_days;
--   -- rejection_source CHECK: only after no row carries 'system_poster_absent'.
