-- Migration: Admin bounty-removal authorization fix
-- Created: 2026-09-04
--
-- BUG: the admin bounty-detail screen's "Remove for violation" action
-- (app/(admin)/bounty/[id]/index.tsx -> adminDataClient.removeBountyForViolation)
-- wrote directly to `bounties` with the ordinary Supabase client:
--   supabase.from('bounties').update({ status: 'archived' }).eq('id', id)
-- The only UPDATE policy on `bounties` is "Owners can update their own
-- bounties" (auth.uid() = poster_id) -- see 20260413_fix_bounty_status_flow.sql.
-- There is no admin-bypass policy on that table. So for any admin who is not
-- the bounty's poster, RLS silently dropped the row from the UPDATE, PostgREST
-- returned zero rows with no error, and the client's `.maybeSingle()` saw
-- `data: null` -- which it (reasonably, given what it could see) reported as
-- "Bounty not found, or you do not have permission to remove it." That is the
-- exact bug: a legitimate admin action was being evaluated against ordinary
-- user ownership rules instead of an admin authorization path.
--
-- FIX: route "remove" through the already-existing, correctly-authorized
-- admin_moderation_transition() RPC (added in
-- 20260829120000_bounty_moderation_queue.sql), which:
--   * re-checks admin role server-side via admin_assert_role()
--     ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'), not RLS ownership
--   * is SECURITY DEFINER, so it is not subject to the ownership-only RLS
--     policy at all -- and that policy is left completely untouched, so
--     normal users keep exactly the permissions they had
--   * distinguishes "bounty not found" (P0002) from "not admin" (42501) from
--     an illegal state transition (22023), so the client can show accurate,
--     specific error copy instead of one generic message
--   * writes an audit trail row to bounty_moderation_events
--
-- This migration adds one behaviour that RPC did not have: transitioning a
-- listing to the state it is already in (e.g. "Remove" clicked twice against
-- a stale admin list, or two admins racing on the same bounty) is now an
-- idempotent success instead of an "illegal transition" error. The general
-- state machine's `from = to => false` rule is otherwise unchanged.
--
-- It also fixes admin_warnings' RLS policy, which trust_safety_hardening.sql
-- (2026-07-25) already documented as one of several tables still using the
-- dead `profiles.role = 'admin'` check (profiles.role is NULL for every row
-- in prod -- the real claim lives in the JWT's app_metadata). "Remove + warn
-- poster" on the bounty-removal screen inserts into admin_warnings, so that
-- half of the flow silently failed for every real admin until now.

-- ============================================================================
-- 1. admin_moderation_transition: idempotent no-op on a repeated target state
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_moderation_transition(
  p_bounty_id uuid,
  p_new_state text,
  p_reason    text,
  p_notes     text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_from       text;
  v_actor      uuid := auth.uid();
  v_bounty     public.bounties%rowtype;
  v_new_status text;
  v_resolution text;
  v_score      numeric;
BEGIN
  PERFORM public.admin_assert_role();

  IF p_new_state NOT IN ('active','flagged','under_review','hidden','removed','approved') THEN
    RAISE EXCEPTION 'invalid target state: %', p_new_state USING ERRCODE = '22023';
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'a reason is required for a moderation transition' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_bounty FROM public.bounties WHERE id = p_bounty_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bounty % not found', p_bounty_id USING ERRCODE = 'P0002';
  END IF;

  SELECT state INTO v_from FROM public.bounty_moderation WHERE bounty_id = p_bounty_id;
  v_from := COALESCE(v_from, 'active');

  -- Idempotent no-op: the listing is already in the requested state (a
  -- double submission, a stale admin list, or two admins racing on the same
  -- bounty). moderation_transition_allowed() treats from = to as illegal,
  -- which is correct for the general state machine but wrong for a repeated
  -- "remove" -- that must succeed quietly, not surface a false failure.
  IF v_from = p_new_state THEN
    RETURN jsonb_build_object(
      'bounty_id', p_bounty_id,
      'from_state', v_from,
      'to_state', p_new_state,
      'resolution', (SELECT resolution FROM public.bounty_moderation WHERE bounty_id = p_bounty_id),
      'bounty_status', v_bounty.status::text,
      'idempotent', true);
  END IF;

  IF NOT public.moderation_transition_allowed(v_from, p_new_state, 'admin') THEN
    RAISE EXCEPTION 'illegal moderation transition: % -> %', v_from, p_new_state USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(sum(weight), 0) INTO v_score
  FROM public.moderation_signals WHERE bounty_id = p_bounty_id;

  v_resolution := CASE
    WHEN p_new_state = 'approved' THEN 'legitimate'
    WHEN p_new_state IN ('hidden','removed') THEN 'suspicious_confirmed'
    ELSE NULL
  END;

  INSERT INTO public.bounty_moderation AS m
    (bounty_id, state, signal_score, notes, review_started_at, reviewed_by, resolved_at, resolution)
  VALUES (
    p_bounty_id, p_new_state, v_score, p_notes,
    CASE WHEN p_new_state = 'under_review' THEN now() END,
    CASE WHEN p_new_state = 'under_review' THEN v_actor END,
    CASE WHEN v_resolution IS NOT NULL THEN now() END,
    v_resolution
  )
  ON CONFLICT (bounty_id) DO UPDATE SET
    state             = EXCLUDED.state,
    notes             = COALESCE(EXCLUDED.notes, m.notes),
    review_started_at = CASE WHEN EXCLUDED.state = 'under_review' AND m.review_started_at IS NULL
                             THEN now() ELSE m.review_started_at END,
    reviewed_by       = CASE WHEN EXCLUDED.state = 'under_review' THEN v_actor ELSE m.reviewed_by END,
    resolved_at       = CASE WHEN v_resolution IS NOT NULL THEN now() ELSE m.resolved_at END,
    resolution        = CASE WHEN v_resolution IS NOT NULL THEN v_resolution ELSE m.resolution END,
    updated_at        = now();

  INSERT INTO public.bounty_moderation_events
    (bounty_id, from_state, to_state, actor, actor_id, reason, notes)
  VALUES (p_bounty_id, v_from, p_new_state, 'admin', v_actor, p_reason, p_notes);

  -- Take the listing out of / back into the marketplace via bounties.status --
  -- the exclusion every feed query already honours.
  -- bounties.status is an enum in prod; assign via a string literal (EXECUTE
  -- format %L) since text-variable -> enum has no implicit assignment cast.
  IF p_new_state IN ('hidden','removed') THEN
    v_new_status := public._moderation_takedown_status(p_new_state);
    IF v_bounty.status::text <> 'completed' AND v_bounty.status::text <> v_new_status THEN
      EXECUTE format('UPDATE public.bounties SET status = %L, updated_at = now() WHERE id = $1', v_new_status)
        USING p_bounty_id;
    END IF;
  ELSIF p_new_state IN ('approved','active')
        AND v_bounty.status::text IN ('archived','deleted')
        AND v_bounty.accepted_by IS NULL THEN
    -- Only reinstate a listing that was actually taken down and never progressed.
    EXECUTE format('UPDATE public.bounties SET status = %L, updated_at = now() WHERE id = $1', 'open')
      USING p_bounty_id;
  END IF;

  -- Best-effort mirror into the canonical event ledger if it is installed.
  IF to_regprocedure(
       'public.record_bounty_event(text,text,text,uuid,uuid,timestamptz,numeric,text,jsonb)'
     ) IS NOT NULL THEN
    PERFORM public.record_bounty_event(
      'moderation.state_changed:' || p_bounty_id::text || ':'
        || to_char(now() AT TIME ZONE 'UTC', 'YYYYMMDD"T"HH24MISS.US'),
      'moderation.state_changed', 'system', p_bounty_id, v_actor, now(), NULL, NULL,
      jsonb_build_object('from', v_from, 'to', p_new_state, 'reason', p_reason));
  END IF;

  RETURN jsonb_build_object(
    'bounty_id', p_bounty_id,
    'from_state', v_from,
    'to_state', p_new_state,
    'resolution', v_resolution,
    'bounty_status', (SELECT status::text FROM public.bounties WHERE id = p_bounty_id));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_moderation_transition(uuid,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_moderation_transition(uuid,text,text,text) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_moderation_transition(uuid,text,text,text) TO authenticated, service_role;

-- ============================================================================
-- 2. admin_warnings RLS: swap the dead profiles.role check for the proven
--    auth.jwt() app_metadata.role claim (see 20260725150000_trust_safety_hardening.sql,
--    which named this table as still carrying the dead pattern without fixing it).
-- ============================================================================
ALTER TABLE public.admin_warnings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage warnings" ON public.admin_warnings;
CREATE POLICY "Admins can manage warnings" ON public.admin_warnings
  FOR ALL
  TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

DROP POLICY IF EXISTS "Users can read their own warnings" ON public.admin_warnings;
CREATE POLICY "Users can read their own warnings" ON public.admin_warnings
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

NOTIFY pgrst, 'reload schema';
