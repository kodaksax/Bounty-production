-- Dispute authorization lockdown (trust-spine audit 2026-09-30, T5 / S1 / S7).
--
-- Before this migration any signed-in user could INSERT a dispute on any
-- bounty ("Participants insert" only checked initiator_id = auth.uid()) and
-- the initiator could UPDATE every column ("Initiator update"), including
-- status / winner / resolved_by. Setting status = 'resolved_*' fires the
-- SECURITY DEFINER trg_fn_cascade_dispute_resolution, which cancels or
-- completes the bounty and rejects or approves the hunter's submission.
-- Both policies came from 20260715i_sync_rls_policies_across_environments.sql
-- and OR'd away the stricter participant policy (permissive policies combine
-- with OR). Reproduced on staging 2026-10-01 before this fix.
--
-- After this migration:
--   * only a participant (poster or accepted hunter) can open a dispute, only
--     on an accepted bounty (in_progress / cancellation_requested), and only
--     in status 'open' with no outcome columns set;
--   * only an admin (JWT app_metadata.role = 'admin') or a privileged server
--     path (service_role, SECURITY DEFINER functions) can UPDATE a dispute;
--     participants cannot touch status / winner / resolved_by / resolution;
--   * nobody but the server can DELETE a dispute;
--   * participants keep submitting evidence (dispute_evidence) and comments
--     (dispute_comments) exactly as before -- those tables are unchanged;
--   * the one participant UPDATE the client used ("Request escalation",
--     status -> under_review) is replaced by request_dispute_escalation(),
--     which flags the dispute without changing its status.
--
-- Defence in depth: the invariants are enforced twice, by RLS and by a BEFORE
-- trigger. The trigger is the layer a future permissive policy cannot OR away,
-- which is exactly how the 20260715i sync migration reopened this hole.
--
-- Policies are rebuilt from scratch (drop every policy on the table, then
-- create the canonical set) because prod and staging had drifted to different
-- policy sets; dropping by name would leave each environment's extras behind.
--
-- Rollback (generated from each environment's live pre-migration state):
--   supabase/rollbacks/production/20261001120000_dispute_authorization_lockdown.down.sql
--   supabase/rollbacks/staging/20261001120000_dispute_authorization_lockdown.down.sql

BEGIN;

-- ── 1. bounty_disputes policies: rebuild canonical set ─────────────────────
DO $$
DECLARE p record;
BEGIN
  FOR p IN SELECT policyname FROM pg_policies
            WHERE schemaname = 'public' AND tablename = 'bounty_disputes'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.bounty_disputes', p.policyname);
  END LOOP;
END $$;

ALTER TABLE public.bounty_disputes ENABLE ROW LEVEL SECURITY;

-- Read: the two parties to the bounty, or an admin.
CREATE POLICY bounty_disputes_select_participant_or_admin
  ON public.bounty_disputes FOR SELECT TO authenticated
  USING (
    COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin'
    OR EXISTS (
      SELECT 1 FROM public.bounties b
       WHERE b.id = bounty_disputes.bounty_id
         AND (b.poster_id = (SELECT auth.uid())
              OR b.user_id = (SELECT auth.uid())
              OR b.accepted_by = (SELECT auth.uid()))
    )
  );

-- Create: a party to an accepted bounty, opening a fresh, undecided dispute.
CREATE POLICY bounty_disputes_insert_participant
  ON public.bounty_disputes FOR INSERT TO authenticated
  WITH CHECK (
    initiator_id = (SELECT auth.uid())
    AND status = 'open'
    AND winner IS NULL
    AND resolution IS NULL
    AND resolved_by IS NULL
    AND resolved_at IS NULL
    AND COALESCE(hold_amount, 0) = 0
    AND COALESCE(escalated, false) = false
    AND stripe_dispute_id IS NULL
    AND EXISTS (
      SELECT 1 FROM public.bounties b
       WHERE b.id = bounty_disputes.bounty_id
         AND b.accepted_by IS NOT NULL
         AND b.status::text IN ('in_progress', 'cancellation_requested')
         AND ((SELECT auth.uid()) IN (b.poster_id, b.user_id, b.accepted_by))
         AND (bounty_disputes.respondent_id IS NULL
              OR bounty_disputes.respondent_id IN (b.poster_id, b.user_id, b.accepted_by))
    )
  );

-- Decide: admins only. (service_role and SECURITY DEFINER owners bypass RLS.)
CREATE POLICY bounty_disputes_update_admin
  ON public.bounty_disputes FOR UPDATE TO authenticated
  USING (COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin')
  WITH CHECK (COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin');

-- No DELETE policy: disputes are a record, not a draft.

-- ── 2. bounty_disputes grants (S7) ─────────────────────────────────────────
REVOKE ALL ON public.bounty_disputes FROM anon;
REVOKE ALL ON public.bounty_disputes FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON public.bounty_disputes TO authenticated;
-- Keep the id sequence usable for participant inserts.
GRANT USAGE ON SEQUENCE public.bounty_disputes_id_seq TO authenticated;

-- ── 3. Trigger guard (cannot be OR'd away by a future permissive policy) ───
-- SECURITY INVOKER on purpose: current_user is 'authenticated'/'anon' only for
-- a direct PostgREST write. Inside a SECURITY DEFINER function (the cascade,
-- fn_close_dispute_hold, request_dispute_escalation) current_user is the
-- function owner, and for edge functions it is service_role.
CREATE OR REPLACE FUNCTION public.fn_bounty_disputes_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    RAISE EXCEPTION 'dispute_change_requires_admin'
      USING ERRCODE = '42501',
            HINT = 'Disputes are decided by Bounty support. Add evidence or comments instead, '
                   'or call request_dispute_escalation() to ask for priority review.';
  END IF;

  -- INSERT by a non-admin client.
  IF v_uid IS NULL OR NEW.initiator_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'dispute_initiator_must_be_caller' USING ERRCODE = '42501';
  END IF;
  IF NEW.status IS DISTINCT FROM 'open'
     OR NEW.winner IS NOT NULL OR NEW.resolution IS NOT NULL
     OR NEW.resolved_by IS NOT NULL OR NEW.resolved_at IS NOT NULL
     OR COALESCE(NEW.hold_amount, 0) <> 0 OR COALESCE(NEW.escalated, false)
     OR NEW.stripe_dispute_id IS NOT NULL
  THEN
    RAISE EXCEPTION 'dispute_must_open_undecided' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.bounties b
     WHERE b.id = NEW.bounty_id
       AND b.accepted_by IS NOT NULL
       AND b.status::text IN ('in_progress', 'cancellation_requested')
       AND v_uid IN (b.poster_id, b.user_id, b.accepted_by)
  ) THEN
    RAISE EXCEPTION 'dispute_requires_bounty_participant' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bounty_disputes_guard ON public.bounty_disputes;
CREATE TRIGGER trg_bounty_disputes_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.bounty_disputes
  FOR EACH ROW EXECUTE FUNCTION public.fn_bounty_disputes_guard();

-- ── 4. Participant escalation without touching status ──────────────────────
CREATE OR REPLACE FUNCTION public.request_dispute_escalation(p_dispute_id integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_status text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT d.status INTO v_status
    FROM public.bounty_disputes d
    JOIN public.bounties b ON b.id = d.bounty_id
   WHERE d.id = p_dispute_id
     AND v_uid IN (b.poster_id, b.user_id, b.accepted_by)
   FOR UPDATE OF d;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'dispute not found' USING ERRCODE = '42501';
  END IF;
  IF v_status NOT IN ('open', 'under_review') THEN
    RAISE EXCEPTION 'dispute is already closed' USING ERRCODE = '22023';
  END IF;

  UPDATE public.bounty_disputes
     SET escalated = true, last_activity_at = now()
   WHERE id = p_dispute_id;

  INSERT INTO public.dispute_audit_log (dispute_id, action, actor_id, actor_type, details)
  VALUES (p_dispute_id, 'escalation_requested', v_uid, 'user', '{}'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.request_dispute_escalation(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_dispute_escalation(integer) TO authenticated, service_role;

-- update_dispute_last_activity runs as a trigger on participant evidence /
-- comment inserts and writes bounty_disputes.last_activity_at. It was
-- SECURITY INVOKER, so it only ever worked for the initiator (via the old
-- "Initiator update" policy). Make it run as owner so activity tracking keeps
-- working for both parties now that participants have no UPDATE policy.
CREATE OR REPLACE FUNCTION public.update_dispute_last_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  UPDATE public.bounty_disputes
     SET last_activity_at = NOW(),
         updated_at = NOW()
   WHERE id = NEW.dispute_id;
  RETURN NEW;
END;
$$;

-- ── 5. dispute_audit_log: honest actor attribution + scoped writes ─────────
-- Both functions classified admins with auth.jwt() ->> 'role', which is
-- always 'authenticated' for a signed-in user, so every admin decision was
-- logged as actor_type 'user'. That made "non-admin dispute status changes"
-- (the audit's success metric) unmeasurable.
CREATE OR REPLACE FUNCTION public.log_dispute_status_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    PERFORM log_dispute_audit(
      NEW.id,
      'status_changed',
      auth.uid(),
      CASE WHEN COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin'
           THEN 'admin' ELSE 'user' END,
      jsonb_build_object(
        'old_status', OLD.status,
        'new_status', NEW.status
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_dispute_audit_log_actor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required to write a dispute audit log entry'
      USING ERRCODE = '42501';
  END IF;

  NEW.actor_id := auth.uid();
  NEW.actor_type := CASE WHEN COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin'
                         THEN 'admin' ELSE 'user' END;
  NEW.created_at := now();

  RETURN NEW;
END;
$$;

DO $$
DECLARE p record;
BEGIN
  FOR p IN SELECT policyname FROM pg_policies
            WHERE schemaname = 'public' AND tablename = 'dispute_audit_log'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.dispute_audit_log', p.policyname);
  END LOOP;
END $$;

CREATE POLICY dispute_audit_log_select_admin
  ON public.dispute_audit_log FOR SELECT TO authenticated
  USING (COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin');

-- Was WITH CHECK (true): anyone could append entries to any dispute's log.
CREATE POLICY dispute_audit_log_insert_participant_or_admin
  ON public.dispute_audit_log FOR INSERT TO authenticated
  WITH CHECK (
    COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin'
    OR EXISTS (
      SELECT 1 FROM public.bounty_disputes d
        JOIN public.bounties b ON b.id = d.bounty_id
       WHERE d.id = dispute_audit_log.dispute_id
         AND (SELECT auth.uid()) IN (b.poster_id, b.user_id, b.accepted_by)
    )
  );

REVOKE ALL ON public.dispute_audit_log FROM anon;
REVOKE ALL ON public.dispute_audit_log FROM authenticated;
GRANT SELECT, INSERT ON public.dispute_audit_log TO authenticated;

-- ── 6. dispute_evidence: no anon writes (S7). Policies unchanged. ──────────
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.dispute_evidence FROM anon;

COMMIT;
