-- Review fixes for the trust-spine hardening (PR #882, Copilot review 2026-10-01).
--
-- 1. bounties INSERT: the policy checked ownership and account status but left the
--    lifecycle columns client-controlled, so an active account could insert a
--    bounty already 'completed' with someone else's accepted_by (no acceptance, no
--    escrow) -- which also satisfies the ratings transaction check. Client inserts
--    must now be a fresh, unassigned, open bounty. (The app only ever inserts
--    status 'open'; legitimate state changes go through the lifecycle RPCs.)
-- 2. trg_bounties_guard_lifecycle: cancellation_requested -> in_progress was
--    unconditional. A poster could take the refund while the hunter's cancellation
--    was pending, then reject it and resume work, leaving the hunter working
--    against an escrow that had already been returned. Resuming is now refused
--    once a refund / cancellation settlement exists for the bounty.
-- 3. fn_owner_refund_block_reason: an admin ruling resolved_poster_wins left the
--    owner unable to complete the Stripe refund via /bounty-payments/cancel (the
--    path dispute-service uses for poster-win settlement). That outcome now allows
--    the refund.
--
-- Rollback: supabase/rollbacks/production/20261001130000_trust_spine_review_fixes.down.sql

BEGIN;

DROP POLICY IF EXISTS bounties_insert_active_owner ON public.bounties;
CREATE POLICY bounties_insert_active_owner
  ON public.bounties FOR INSERT TO authenticated
  WITH CHECK (
    poster_id = (SELECT auth.uid())
    AND (user_id IS NULL OR user_id = (SELECT auth.uid()))
    AND public.is_account_active((SELECT auth.uid()))
    AND status::text = 'open'
    AND accepted_by IS NULL
    AND accepted_request_id IS NULL
    AND completed_at IS NULL
  );

CREATE OR REPLACE FUNCTION public.fn_bounties_guard_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
-- SECURITY INVOKER on purpose: current_user identifies a direct client write.
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_from text;
  v_to   text;
  v_committed boolean;
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  v_from := OLD.status::text;
  v_committed := OLD.accepted_by IS NOT NULL
                 OR v_from IN ('in_progress', 'cancellation_requested', 'completed');

  IF TG_OP = 'DELETE' THEN
    IF v_committed THEN
      RAISE EXCEPTION 'bounty_delete_not_allowed_after_acceptance'
        USING ERRCODE = '42501',
              HINT = 'A hunter is committed to this bounty. Use the cancellation or dispute flow.';
    END IF;
    RETURN OLD;
  END IF;

  v_to := NEW.status::text;

  -- Hunter assignment is owned by fn_accept_bounty_request. The one implicit
  -- change allowed is fn_bounties_clear_worker_when_reopened nulling
  -- accepted_by when a never-committed bounty goes back to 'open'.
  IF NEW.accepted_by IS DISTINCT FROM OLD.accepted_by
     AND NOT (NEW.accepted_by IS NULL AND v_to = 'open'
              AND v_from NOT IN ('in_progress', 'cancellation_requested', 'completed'))
  THEN
    RAISE EXCEPTION 'bounty_assignment_is_server_managed'
      USING ERRCODE = '42501',
            HINT = 'Accept an application with fn_accept_bounty_request.';
  END IF;
  -- (Not hunter_id: that legacy column exists on staging but not on prod.)
  IF NEW.accepted_request_id IS DISTINCT FROM OLD.accepted_request_id THEN
    RAISE EXCEPTION 'bounty_assignment_is_server_managed' USING ERRCODE = '42501';
  END IF;

  IF NEW.completed_at IS DISTINCT FROM OLD.completed_at
     AND NOT (v_to = 'completed' AND v_from IS DISTINCT FROM 'completed')
  THEN
    RAISE EXCEPTION 'bounty_completed_at_is_server_managed' USING ERRCODE = '42501';
  END IF;

  IF v_to IS NOT DISTINCT FROM v_from THEN
    RETURN NEW;
  END IF;

  IF (v_from = 'in_progress' AND v_to = 'completed')
     OR (v_from = 'completed' AND v_to IN ('archived', 'deleted'))
  THEN
    RETURN NEW;
  END IF;

  -- The poster may reject the hunter's cancellation and resume work, but not
  -- after the escrow has been (or is being) returned to them: the hunter would
  -- work for nothing and /wallet/release refuses any bounty with a refund.
  IF v_from = 'cancellation_requested' AND v_to = 'in_progress' THEN
    IF NOT EXISTS (
         SELECT 1 FROM public.wallet_transactions wt
          WHERE wt.bounty_id = OLD.id AND wt.type::text = 'refund'
       )
       AND NOT EXISTS (
         SELECT 1 FROM public.bounty_payments bp
          WHERE bp.bounty_id = OLD.id
            AND bp.status IN ('refund_pending', 'refunded', 'canceled')
       )
    THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'bounty_resume_blocked_escrow_refunded'
      USING ERRCODE = '42501',
            HINT = 'The escrow was already returned to the poster. Contact Bounty support.';
  END IF;

  IF v_from = 'cancellation_requested' AND v_to = 'cancelled' THEN
    IF EXISTS (
      SELECT 1 FROM public.bounty_cancellations bc
       WHERE bc.bounty_id = OLD.id
         AND bc.requester_id = OLD.accepted_by
         AND bc.status IN ('pending', 'accepted')
    ) THEN
      RETURN NEW;
    END IF;
  ELSIF v_from IN ('cancelled', 'archived', 'deleted') AND OLD.accepted_by IS NOT NULL THEN
    -- Ended after a hunter was accepted: tidy-up only (archive / delete),
    -- never back into the marketplace with the old hunter's escrow history.
    IF v_to IN ('cancelled', 'archived', 'deleted') THEN
      RETURN NEW;
    END IF;
  ELSIF NOT v_committed
        AND v_to NOT IN ('in_progress', 'cancellation_requested', 'completed')
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'bounty_status_transition_not_allowed: % -> %', v_from, v_to
    USING ERRCODE = '42501',
          HINT = 'Once a hunter is accepted the bounty can only be completed, or ended through '
                 'the hunter''s cancellation request or a dispute.';
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_owner_refund_block_reason(p_bounty_id uuid, p_caller uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  b public.bounties%ROWTYPE;
BEGIN
  SELECT * INTO b FROM public.bounties WHERE id = p_bounty_id;
  IF NOT FOUND THEN
    RETURN 'bounty_not_found';
  END IF;
  IF p_caller IS NULL OR p_caller NOT IN (COALESCE(b.user_id, b.poster_id), COALESCE(b.poster_id, b.user_id)) THEN
    RETURN 'not_bounty_owner';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.bounty_disputes d
     WHERE d.bounty_id = p_bounty_id
       AND d.status IN ('open', 'under_review')
  ) THEN
    RETURN 'refund_blocked_by_open_dispute';
  END IF;

  -- An admin ruled for the poster (bounty_disputes.status is admin-only after
  -- 20261001120000, so this is a trusted outcome). The Stripe settlement in
  -- dispute-service calls /bounty-payments/cancel, and the owner must be able to
  -- complete or retry that refund.
  IF EXISTS (
    SELECT 1 FROM public.bounty_disputes d
     WHERE d.bounty_id = p_bounty_id
       AND d.status = 'resolved_poster_wins'
       AND d.winner = 'poster'
  ) THEN
    RETURN NULL;
  END IF;

  -- Never committed to a hunter: the poster's money is the poster's.
  IF b.accepted_by IS NULL
     AND b.accepted_request_id IS NULL
     AND b.status::text NOT IN ('in_progress', 'cancellation_requested', 'completed')
     AND NOT EXISTS (
       SELECT 1 FROM public.bounty_requests br
        WHERE br.bounty_id = p_bounty_id AND br.status::text = 'accepted'
     )
  THEN
    RETURN NULL;
  END IF;

  -- Committed: only the accepted hunter's own cancellation releases the
  -- escrow back to the poster. acceptCancellation() refunds *before* it marks
  -- the request accepted, so 'pending' must count.
  IF b.status::text IN ('cancellation_requested', 'cancelled')
     AND EXISTS (
       SELECT 1 FROM public.bounty_cancellations bc
        WHERE bc.bounty_id = p_bounty_id
          AND bc.requester_id = b.accepted_by
          AND bc.status IN ('pending', 'accepted')
     )
  THEN
    RETURN NULL;
  END IF;

  RETURN 'refund_requires_cancellation_or_dispute';
END;
$$;

COMMIT;
