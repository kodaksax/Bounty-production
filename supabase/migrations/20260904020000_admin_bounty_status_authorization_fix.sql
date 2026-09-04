-- Migration: Admin bounty lifecycle-status authorization fix
-- Created: 2026-09-04
--
-- Follow-up to 20260904010000_admin_bounty_removal_authorization_fix.sql,
-- which fixed the admin "Remove for violation" action. This fixes the
-- identical root cause in the same screen's "Status actions" section
-- (Archive / Cancel / Mark completed / Reopen / Approve cancellation /
-- Decline, resume work -- app/(admin)/bounty/[id]/index.tsx's
-- STATUS_TRANSITIONS, and the status filter on app/(admin)/bounties.tsx).
--
-- BUG: adminDataClient.updateBountyStatus wrote directly to `bounties` with
-- the ordinary Supabase client:
--   supabase.from('bounties').update({ status }).eq('id', id).select().maybeSingle()
-- gated only by the same ownership-only UPDATE policy ("auth.uid() =
-- poster_id", 20260413_fix_bounty_status_flow.sql). Any admin who was not
-- also the bounty's poster got a silently-dropped row -> `.maybeSingle()`
-- null -> "Bounty not found, or you do not have permission to update it" --
-- the same false failure as the removal bug, on every lifecycle button on
-- this screen.
--
-- FIX: the same shape as the removal fix -- a SECURITY DEFINER RPC that
-- re-checks admin role server-side via the existing admin_assert_role(),
-- not RLS ownership. Two differences from admin_moderation_transition:
--   * this drives `bounties.status` (the lifecycle enum: open/in_progress/
--     completed/archived/cancelled/cancellation_requested/deleted)
--     directly, not the separate `bounty_moderation.state` domain
--   * the transition-validity check is ported here from the client's
--     STATUS_TRANSITIONS map (app/(admin)/bounty/[id]/index.tsx), so an
--     illegal jump (e.g. 'completed' -> 'in_progress') is rejected
--     server-side too, not only by which buttons the UI happens to render --
--     see feedback memory on client-only guardrails not actually firing.
-- A same-status call is an idempotent success (returns the row unchanged),
-- matching the removal RPC's idempotency behaviour.

-- ============================================================================
-- 1. Transition validity, mirroring STATUS_TRANSITIONS in
--    app/(admin)/bounty/[id]/index.tsx exactly (every value of
--    bounty_status_enum has an entry there; same here).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_bounty_status_transition_allowed(
  p_from text, p_to text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_from IS NULL OR p_to IS NULL THEN false
    WHEN p_from = p_to THEN false
    WHEN p_from = 'open'                  THEN p_to IN ('in_progress','archived','cancelled')
    WHEN p_from = 'in_progress'           THEN p_to IN ('completed','open','cancelled','archived')
    WHEN p_from = 'completed'             THEN p_to IN ('archived')
    WHEN p_from = 'archived'              THEN p_to IN ('open')
    WHEN p_from = 'cancelled'             THEN p_to IN ('open','archived')
    WHEN p_from = 'cancellation_requested' THEN p_to IN ('cancelled','in_progress')
    WHEN p_from = 'deleted'               THEN p_to IN ('archived')
    ELSE false
  END;
$$;
REVOKE ALL ON FUNCTION public.admin_bounty_status_transition_allowed(text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_bounty_status_transition_allowed(text,text) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_bounty_status_transition_allowed(text,text) TO authenticated, service_role;

-- ============================================================================
-- 2. The write. Reuses admin_assert_role() (from the moderation-queue
--    migration) and record_bounty_event() defensively -- exactly the pattern
--    admin_moderation_transition already uses, so this degrades the same way
--    if the Command Center ledger migration is not applied in a given
--    environment.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_set_bounty_status(
  p_bounty_id uuid,
  p_status    text,
  p_reason    text DEFAULT NULL
)
RETURNS public.bounties
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row  public.bounties%rowtype;
  v_from text;
BEGIN
  PERFORM public.admin_assert_role();

  IF p_status NOT IN ('open','in_progress','completed','archived','cancelled','cancellation_requested','deleted') THEN
    RAISE EXCEPTION 'invalid bounty status: %', p_status USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_row FROM public.bounties WHERE id = p_bounty_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bounty % not found', p_bounty_id USING ERRCODE = 'P0002';
  END IF;

  v_from := v_row.status::text;

  -- Idempotent no-op: already in the requested status (double submission,
  -- stale admin list, or a race with another admin session).
  IF v_from = p_status THEN
    RETURN v_row;
  END IF;

  IF NOT public.admin_bounty_status_transition_allowed(v_from, p_status) THEN
    RAISE EXCEPTION 'illegal bounty status transition: % -> %', v_from, p_status USING ERRCODE = '22023';
  END IF;

  EXECUTE format('UPDATE public.bounties SET status = %L, updated_at = now() WHERE id = $1', p_status)
    USING p_bounty_id;

  IF to_regprocedure(
       'public.record_bounty_event(text,text,text,uuid,uuid,timestamptz,numeric,text,jsonb)'
     ) IS NOT NULL THEN
    PERFORM public.record_bounty_event(
      'admin.status_changed:' || p_bounty_id::text || ':'
        || to_char(now() AT TIME ZONE 'UTC', 'YYYYMMDD"T"HH24MISS.US'),
      'admin.status_changed', 'system', p_bounty_id, auth.uid(), now(), NULL, NULL,
      jsonb_build_object('from', v_from, 'to', p_status, 'reason', p_reason));
  END IF;

  SELECT * INTO v_row FROM public.bounties WHERE id = p_bounty_id;
  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_set_bounty_status(uuid,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_set_bounty_status(uuid,text,text) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_set_bounty_status(uuid,text,text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
