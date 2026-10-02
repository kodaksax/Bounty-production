-- Escrow commitment, part 2 (trust-spine audit 2026-09-30, T4 / T6).
--
-- 20261001120100 + 20261001130000 locked the bounties row itself: a client can
-- no longer reassign accepted_by, cancel a committed bounty, or refund after
-- acceptance. Two neighbouring tables were still client-writable with no
-- column or transition rules (prod pg_policies, 2026-10-02):
--
--   bounty_requests        "Posters can update requests for their bounties"
--                          (UPDATE, no WITH CHECK, any column) and
--                          "Posters can delete requests for their bounties".
--     A poster could flip the accepted application to 'rejected', promote a
--     different applicant to 'accepted', rewrite hunter_id on the accepted row,
--     or delete it. Money is safe (/wallet/release pays bounties.accepted_by),
--     but every client surface that lists "my jobs" reads bounty_requests, so
--     the accepted hunter could be silently dropped from their own job.
--
--   completion_submissions "completion_submissions_insert_hunter"
--                          (WITH CHECK auth.uid() = hunter_id only),
--                          "..._update_poster" (any column),
--                          "..._update_hunter" (any column while pending).
--     Any signed-in user could insert a "submission" on any bounty. The hunter
--     could backdate submitted_at, the poster could forward-date it or rewrite
--     hunter_id. submitted_at is about to start a 72-hour review clock
--     (20261002120100), so it has to be server-stamped and immutable.
--
-- Both guards follow trg_bounties_guard_lifecycle: SECURITY INVOKER BEFORE
-- triggers that act only on direct client writes (current_user authenticated /
-- anon) by a non-admin. Every SECURITY DEFINER path (fn_accept_bounty_request,
-- the dispute cascade, fn_reject_pending_requests_on_bounty_close, ...) runs
-- as postgres and is untouched; edge functions run as service_role.
--
-- Legitimate client writes, inventoried on main @ d11eebd9:
--   bounty_requests:
--     poster  pending -> rejected            bountyRequestService.rejectRequest
--     hunter  DELETE own pending              application-withdrawal.ts (policy)
--     (accept goes through fn_accept_bounty_request; the client-side fallback
--      in acceptRequest only runs when that RPC is missing and is already
--      refused by trg_bounties_guard_lifecycle.)
--   completion_submissions:
--     hunter  INSERT status 'pending'         completionService.submitCompletion
--     poster  pending -> approved             completionService.approveCompletion
--     poster  pending -> revision_requested   completionService.requestRevision
--     poster  revision_requested -> approved  poster-review-modal (latest row)
--     (a revision is answered with a NEW row, never an update of the old one.)
--
-- Rollback: supabase/rollbacks/production/20261002120000_assignment_and_submission_integrity.down.sql

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. bounty_requests: acceptance and the accepted row are server-managed
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_bounty_requests_guard_assignment()
RETURNS trigger
LANGUAGE plpgsql
-- SECURITY INVOKER on purpose: current_user identifies a direct client write.
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status::text IS DISTINCT FROM 'pending' THEN
      RAISE EXCEPTION 'request_must_start_pending' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.status::text = 'accepted' THEN
      RAISE EXCEPTION 'accepted_request_is_locked'
        USING ERRCODE = '42501',
              HINT = 'The accepted hunter can only leave through a cancellation request or a dispute.';
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.bounty_id IS DISTINCT FROM OLD.bounty_id
     OR NEW.hunter_id IS DISTINCT FROM OLD.hunter_id
     OR NEW.poster_id IS DISTINCT FROM OLD.poster_id
  THEN
    RAISE EXCEPTION 'request_parties_are_immutable' USING ERRCODE = '42501';
  END IF;

  IF OLD.status::text = 'accepted' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'accepted_request_is_locked'
      USING ERRCODE = '42501',
            HINT = 'The accepted hunter can only leave through a cancellation request or a dispute.';
  END IF;

  IF NEW.status::text = 'accepted' AND OLD.status::text <> 'accepted' THEN
    RAISE EXCEPTION 'request_acceptance_is_server_managed'
      USING ERRCODE = '42501',
            HINT = 'Accept an application with fn_accept_bounty_request.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bounty_requests_guard_assignment ON public.bounty_requests;
CREATE TRIGGER trg_bounty_requests_guard_assignment
  BEFORE INSERT OR UPDATE OR DELETE ON public.bounty_requests
  FOR EACH ROW EXECUTE FUNCTION public.fn_bounty_requests_guard_assignment();

-- ---------------------------------------------------------------------------
-- 2. completion_submissions: only the accepted hunter submits; the clock and
--    the parties are server-owned; each side edits only its own fields.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_completion_submissions_guard()
RETURNS trigger
LANGUAGE plpgsql
-- SECURITY INVOKER on purpose: current_user identifies a direct client write.
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_bounty  record;
  -- Fields each party may change on an existing row. Everything else
  -- (bounty_id, hunter_id, submitted_at, revision_count, reviewer stamps and
  -- every reminder/escalation watermark) is server-owned.
  c_hunter_fields constant text[] := ARRAY['message', 'proof_items', 'updated_at'];
  c_poster_fields constant text[] := ARRAY['status', 'poster_feedback', 'reviewed_at', 'updated_at'];
  -- What a hunter may supply when submitting. created_at / updated_at keep
  -- their column defaults.
  c_insert_fields constant text[] := ARRAY['id', 'bounty_id', 'hunter_id', 'message', 'proof_items',
                                           'status', 'created_at', 'updated_at'];
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  IF COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT b.id, b.status::text AS status, b.accepted_by
      INTO v_bounty
      FROM public.bounties b
     WHERE b.id = NEW.bounty_id;

    IF v_uid IS NULL OR NEW.hunter_id IS DISTINCT FROM v_uid
       OR v_bounty.id IS NULL OR v_bounty.accepted_by IS DISTINCT FROM v_uid
    THEN
      RAISE EXCEPTION 'submission_requires_accepted_hunter'
        USING ERRCODE = '42501',
              HINT = 'Only the hunter accepted for this bounty can submit work for it.';
    END IF;
    IF v_bounty.status <> 'in_progress' THEN
      RAISE EXCEPTION 'submission_requires_in_progress_bounty: %', v_bounty.status
        USING ERRCODE = '42501';
    END IF;
    IF NEW.status IS DISTINCT FROM 'pending' THEN
      RAISE EXCEPTION 'submission_must_start_pending' USING ERRCODE = '42501';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.completion_submissions cs
       WHERE cs.bounty_id = NEW.bounty_id
         AND cs.hunter_id = NEW.hunter_id
         AND cs.status = 'pending'
    ) THEN
      RAISE EXCEPTION 'submission_already_pending'
        USING ERRCODE = '23505',
              HINT = 'This work is already with the poster for review.';
    END IF;

    -- Every column outside the client insert allowlist is reset, so stamps a
    -- later migration adds (reminders, escalation) are server-owned without
    -- this guard having to know their names.
    NEW := jsonb_populate_record(NEW, (
      SELECT COALESCE(jsonb_object_agg(k, NULL), '{}'::jsonb)
        FROM jsonb_object_keys(to_jsonb(NEW)) AS k
       WHERE k <> ALL (c_insert_fields)
    ));
    -- The review clock starts when the server received the work, not when
    -- the device says it did.
    NEW.submitted_at := now();
    -- The client never sends revision_count, so handle_completion_submission_
    -- notification always said "finished the work", even on a resubmission.
    NEW.revision_count := (
      SELECT count(*)::int FROM public.completion_submissions cs
       WHERE cs.bounty_id = NEW.bounty_id
         AND cs.hunter_id = NEW.hunter_id
         AND cs.status = 'revision_requested'
    );
    RETURN NEW;
  END IF;

  -- UPDATE
  IF v_uid IS NOT NULL AND v_uid = OLD.hunter_id THEN
    IF (to_jsonb(NEW) - c_hunter_fields) IS DISTINCT FROM (to_jsonb(OLD) - c_hunter_fields) THEN
      RAISE EXCEPTION 'submission_field_not_editable_by_hunter'
        USING ERRCODE = '42501',
              HINT = 'A hunter can edit the message and proof of a pending submission only.';
    END IF;
    RETURN NEW;
  END IF;

  -- Anyone else reaching this point passed completion_submissions_update_poster.
  IF (to_jsonb(NEW) - c_poster_fields) IS DISTINCT FROM (to_jsonb(OLD) - c_poster_fields) THEN
    RAISE EXCEPTION 'submission_field_not_editable_by_poster'
      USING ERRCODE = '42501',
            HINT = 'A poster can approve, request changes or reject; the submission itself is the hunter''s.';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    -- revision_requested -> approved: the poster accepts the work as it is
    -- after asking for changes. poster-review-modal approves the LATEST
    -- submission and releases escrow before this update, so refusing it
    -- would strand a released payment on an unapproved submission.
    IF NOT (
         (OLD.status = 'pending' AND NEW.status IN ('approved', 'revision_requested', 'rejected'))
      OR (OLD.status = 'revision_requested' AND NEW.status = 'approved')
    ) THEN
      RAISE EXCEPTION 'submission_review_transition_not_allowed: % -> %', OLD.status, NEW.status
        USING ERRCODE = '42501';
    END IF;
    -- Server time for the decision. reviewed_at is the watermark
    -- fn_remind_pending_hunter_ratings and the review-window reports read.
    NEW.reviewed_at := now();
  ELSE
    -- A repeated decision (double-tap, retry after a lost response) is a
    -- no-op, not an error: keep the original decision time.
    NEW.reviewed_at := OLD.reviewed_at;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_completion_submissions_guard ON public.completion_submissions;
CREATE TRIGGER trg_completion_submissions_guard
  BEFORE INSERT OR UPDATE ON public.completion_submissions
  FOR EACH ROW EXECUTE FUNCTION public.fn_completion_submissions_guard();

COMMIT;
