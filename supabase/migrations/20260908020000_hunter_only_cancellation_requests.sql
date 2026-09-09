-- Cancellation requests are the HUNTER's exit, and only the hunter's.
--
-- WHY
-- ---
-- A cancellation request asks the other party for release from work already
-- under way, and granting it returns the poster's escrow in full
-- (admin_approve_bounty_cancellation, 20260908010000). That only makes sense
-- filed by the hunter. Every request in production so far was filed by a
-- POSTER, which made the poster both the requester and the sole beneficiary of
-- a flow whose entire point is the counterparty's consent.
--
-- A poster with an unaccepted bounty deletes it and is refunded on the spot;
-- once a hunter is on the clock the poster's route is a dispute, which is the
-- flow that can settle escrow in either direction.
--
-- WHY AN RPC AND NOT JUST RLS
-- ---------------------------
-- Filing a request has to move `bounties.status` to 'cancellation_requested',
-- and the only UPDATE policies on `bounties` are `auth.uid() = poster_id`.
-- A hunter therefore cannot flip that status at all — their UPDATE matches
-- zero rows and PostgREST reports success, so the request row would be created
-- against a bounty still showing 'in_progress'. That is precisely why this had
-- to be poster-only before. SECURITY DEFINER is what makes a hunter-filed
-- request possible; the INSERT policy below is the backstop for anything that
-- writes the table directly.

-- ---------------------------------------------------------------------------
-- 1. File a request (hunter only)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_bounty_cancellation(
  p_bounty_id UUID,
  p_reason    TEXT
)
RETURNS SETOF public.bounty_cancellations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_bounty public.bounties%rowtype;
  v_caller UUID := auth.uid();
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_bounty FROM public.bounties WHERE id = p_bounty_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bounty % not found', p_bounty_id USING ERRCODE = 'P0002';
  END IF;

  -- The whole rule, enforced server-side rather than by which screen rendered
  -- the button.
  IF v_bounty.accepted_by IS NULL OR v_bounty.accepted_by <> v_caller THEN
    RAISE EXCEPTION 'only the accepted hunter may request cancellation'
      USING ERRCODE = '42501';
  END IF;

  IF v_bounty.status::text = 'cancellation_requested' THEN
    RAISE EXCEPTION 'a cancellation request is already open for this bounty'
      USING ERRCODE = '23505';
  END IF;

  IF v_bounty.status::text <> 'in_progress' THEN
    RAISE EXCEPTION 'cannot request cancellation from status %', v_bounty.status
      USING ERRCODE = '22023';
  END IF;

  -- For-honor bounties hold no money, so there is nothing for the poster to
  -- weigh: they cancel outright, exactly as the old client-side branch did.
  IF COALESCE(v_bounty.is_for_honor, FALSE) THEN
    UPDATE public.bounties
       SET status = 'cancelled', updated_at = now()
     WHERE id = p_bounty_id;

    RETURN QUERY
      INSERT INTO public.bounty_cancellations (
        bounty_id, requester_id, requester_type, reason, status,
        refund_percentage, response_message, resolved_at
      ) VALUES (
        p_bounty_id, v_caller, 'hunter', p_reason, 'accepted',
        0,
        'Auto-accepted: for honor bounties do not require manual dispute resolution.',
        now()
      )
      RETURNING *;
    RETURN;
  END IF;

  UPDATE public.bounties
     SET status = 'cancellation_requested', updated_at = now()
   WHERE id = p_bounty_id;

  -- 100, not calculateRecommendedRefund's suggestion: approving this returns
  -- the whole escrow, and nothing in the settlement path ever pays a hunter a
  -- remainder, so a partial figure here would be a promise nobody keeps.
  RETURN QUERY
    INSERT INTO public.bounty_cancellations (
      bounty_id, requester_id, requester_type, reason, status, refund_percentage
    ) VALUES (
      p_bounty_id, v_caller, 'hunter', p_reason, 'pending', 100
    )
    RETURNING *;
END;
$$;

-- SECURITY DEFINER + created-with-PUBLIC-execute would otherwise be reachable
-- unauthenticated.
REVOKE ALL ON FUNCTION public.request_bounty_cancellation(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_bounty_cancellation(UUID, TEXT)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Backstop: direct inserts must satisfy the same rule
-- ---------------------------------------------------------------------------
-- The previous policy allowed `poster_id = auth.uid() OR accepted_by =
-- auth.uid()`. Narrowed to the accepted hunter so an older build (or a raw
-- PostgREST call) cannot keep filing poster-initiated requests behind the RPC's
-- back. Existing rows are untouched; this governs new inserts only.
DROP POLICY IF EXISTS bounty_cancellations_insert_related ON public.bounty_cancellations;

CREATE POLICY bounty_cancellations_insert_hunter_only
  ON public.bounty_cancellations
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) = requester_id
    AND requester_type = 'hunter'
    AND EXISTS (
      SELECT 1 FROM public.bounties b
       WHERE b.id = bounty_cancellations.bounty_id
         AND b.accepted_by = (SELECT auth.uid())
    )
  );

NOTIFY pgrst, 'reload schema';
