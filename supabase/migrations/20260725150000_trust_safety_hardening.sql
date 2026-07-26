-- Migration: Trust & safety hardening -- reports, blocked_users, messaging block enforcement
-- Created: 2026-07-25
--
-- BACKGROUND: a full audit (git migrations + live information_schema/pg_policies
-- dump against project xwlwqzzphmmhghiqvkeu) found:
--
--  1. `reports` and `blocked_users` RLS in the tracked migration history
--     (20251001_baseline_schema.sql) enables RLS but defines zero policies.
--     The live DB actually has undocumented self-service policies (insert/
--     select/update/delete "own row") applied directly in Supabase's SQL
--     editor with no corresponding migration -- but NO admin policy exists
--     for either table. This is why the admin Moderation Queue
--     (app/(admin)/reports.tsx) and Blocked Users screen
--     (app/(admin)/blocked-users.tsx) see nothing and silently fall back to
--     mock/broken data: the admin's own anon-key JWT is subject to the same
--     self-only RLS as any other user.
--  2. The working admin-role check pattern already proven live in this DB is
--     `(auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'` (see the
--     "Admins can view all disputes" policy on bounty_disputes). Two real
--     accounts have `raw_app_meta_data.role = 'admin'` set. The competing
--     `profiles.role = 'admin'` pattern used elsewhere (feature_requests,
--     admin_warnings, feedback_reports) is dead: profiles.role is NULL for
--     all 103 rows in prod, so those admin policies never actually match
--     anyone. This migration uses the proven JWT-claim pattern, not the
--     dead one.
--  3. `blocked_users` blocking a user has zero effect on messaging: none of
--     rpc_get_or_create_dm_conversation, rpc_create_conversation, or the
--     `messages` INSERT RLS policy ever reference blocked_users. This
--     migration adds a bidirectional block-check helper and wires it into
--     every conversation/DM/message creation path.
--  4. A live, ungitted `rpc_create_conversation(p_participant_ids uuid[],
--     p_bounty_id uuid)` (2-arg) overload exists in prod with EXECUTE
--     granted to `anon`, performs zero auth checks, and explicitly disables
--     row_security for its own transaction. It is unreachable by any
--     tracked client code path (every call site passes p_name, which
--     resolves to the 3-arg overload via PostgREST's named-parameter
--     matching) but remains directly callable via a raw REST request and
--     would bypass every block check added here. It is dropped.

-- ============================================================================
-- 1. REPORTS -- schema fix + admin RLS
-- ============================================================================
-- report-service.ts's updateReportStatus() already writes `reviewed_at` and
-- `resolution_notes`, and app/(admin)/reports.tsx already reads them -- but
-- neither column exists on the live table, so every status update has been
-- silently failing. Add them rather than strip the (clearly intended) admin
-- workflow fields.
ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resolution_notes TEXT;

-- Admins can view every report (Moderation Queue list).
DROP POLICY IF EXISTS reports_select_admin ON public.reports;
CREATE POLICY reports_select_admin ON public.reports
  FOR SELECT
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- Admins can update status / reviewed_at / resolution_notes on any report.
DROP POLICY IF EXISTS reports_update_admin ON public.reports;
CREATE POLICY reports_update_admin ON public.reports
  FOR UPDATE
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- ============================================================================
-- 2. BLOCKED_USERS -- self-block guard + admin RLS
-- ============================================================================
-- blocking-service.ts already rejects self-blocks client-side; enforce the
-- same rule server-side so it can't be bypassed by a direct API call.
ALTER TABLE public.blocked_users
  DROP CONSTRAINT IF EXISTS blocked_users_no_self_block;
ALTER TABLE public.blocked_users
  ADD CONSTRAINT blocked_users_no_self_block CHECK (blocker_id <> blocked_id);

-- Admins can view every block relationship (Blocked Users admin screen).
DROP POLICY IF EXISTS blocked_users_select_admin ON public.blocked_users;
CREATE POLICY blocked_users_select_admin ON public.blocked_users
  FOR SELECT
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- Admins can remove any block relationship (Blocked Users "Remove Block").
DROP POLICY IF EXISTS blocked_users_delete_admin ON public.blocked_users;
CREATE POLICY blocked_users_delete_admin ON public.blocked_users
  FOR DELETE
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- ============================================================================
-- 3. Block-check helpers
-- ============================================================================
-- `blocked_users` SELECT RLS only exposes rows where blocker_id = auth.uid(),
-- so a plain query run as user A can never see that B has blocked A. These
-- helpers are SECURITY DEFINER so they can see both directions of a block
-- regardless of which user is asking, and are used both inside RLS policies
-- and inside the SECURITY DEFINER conversation RPCs below.

CREATE OR REPLACE FUNCTION public.is_blocked_pair(p_user_a UUID, p_user_b UUID)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.blocked_users
    WHERE (blocker_id = p_user_a AND blocked_id = p_user_b)
       OR (blocker_id = p_user_b AND blocked_id = p_user_a)
  );
$$;

REVOKE ALL ON FUNCTION public.is_blocked_pair(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_blocked_pair(UUID, UUID) TO authenticated;

-- True if p_user_id and any OTHER currently-active participant of
-- p_conversation_id have a block relationship in either direction.
CREATE OR REPLACE FUNCTION public.conversation_has_block(p_conversation_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.conversation_participants cp
    WHERE cp.conversation_id = p_conversation_id
      AND cp.user_id <> p_user_id
      AND cp.deleted_at IS NULL
      AND public.is_blocked_pair(cp.user_id, p_user_id)
  );
$$;

REVOKE ALL ON FUNCTION public.conversation_has_block(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.conversation_has_block(UUID, UUID) TO authenticated;

-- ============================================================================
-- 4. Messaging RLS -- block enforcement on direct client paths
-- ============================================================================

-- Sending a new message: reject if sender and any other active participant
-- in the conversation have blocked each other.
DROP POLICY IF EXISTS "Users can send messages in their conversations" ON public.messages;
CREATE POLICY "Users can send messages in their conversations" ON public.messages
  FOR INSERT
  WITH CHECK (
    conversation_id IN (
      SELECT conversation_participants.conversation_id
      FROM conversation_participants
      WHERE conversation_participants.user_id = auth.uid()
        AND conversation_participants.deleted_at IS NULL
    )
    AND sender_id = auth.uid()
    AND NOT public.conversation_has_block(conversation_id, sender_id)
  );

-- Adding a participant (group invites / creator-driven adds): reject if the
-- acting user and the invitee have blocked each other.
DROP POLICY IF EXISTS "Participants and owners can add conversation participants" ON public.conversation_participants;
CREATE POLICY "Participants and owners can add conversation participants" ON public.conversation_participants
  FOR INSERT
  WITH CHECK (
    (
      user_id = auth.uid()
      OR is_conversation_creator(conversation_id)
      OR is_user_participant(conversation_id, auth.uid())
    )
    AND NOT public.is_blocked_pair(auth.uid(), user_id)
  );

-- ============================================================================
-- 5. Messaging RPCs -- block enforcement (these run SECURITY DEFINER owned
--    by a role with BYPASSRLS, so the RLS policies above do NOT gate them;
--    the checks must live inside the function bodies themselves)
-- ============================================================================

-- rpc_get_or_create_dm_conversation handles BOTH creating a new 1:1
-- conversation and reactivating ("re-opening") a soft-deleted one -- add a
-- single check that covers both bullets.
CREATE OR REPLACE FUNCTION public.rpc_get_or_create_dm_conversation(
  p_user_id UUID,
  p_other_user_id UUID,
  p_bounty_id TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conversation_id UUID;
  v_caller_id       UUID := auth.uid();
  v_safe_bounty_id  UUID;
  v_lock_key        BIGINT;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  IF v_caller_id != p_user_id AND v_caller_id != p_other_user_id THEN
    RAISE EXCEPTION 'unauthorized: caller must be one of the participants';
  END IF;

  IF p_user_id = p_other_user_id THEN
    RAISE EXCEPTION 'cannot create a DM conversation with yourself';
  END IF;

  IF public.is_blocked_pair(p_user_id, p_other_user_id) THEN
    RAISE EXCEPTION 'cannot create or reopen a conversation with a blocked user'
      USING ERRCODE = '42501';
  END IF;

  BEGIN
    v_safe_bounty_id := CASE
      WHEN p_bounty_id IS NOT NULL
        AND p_bounty_id <> ''
        AND p_bounty_id <> 'undefined'
      THEN p_bounty_id::uuid
      ELSE NULL
    END;
  EXCEPTION WHEN invalid_text_representation THEN
    v_safe_bounty_id := NULL;
  END;

  v_lock_key := hashtext(
    LEAST(p_user_id::text, p_other_user_id::text)
    || ':'
    || GREATEST(p_user_id::text, p_other_user_id::text)
  );

  PERFORM pg_advisory_xact_lock(v_lock_key);

  SELECT cp1.conversation_id INTO v_conversation_id
  FROM   conversation_participants cp1
  JOIN   conversation_participants cp2
    ON  cp2.conversation_id = cp1.conversation_id
    AND cp2.user_id         = p_other_user_id
    AND cp2.deleted_at IS NULL
  JOIN   conversations c
    ON  c.id       = cp1.conversation_id
    AND c.is_group = false
  WHERE  cp1.user_id = p_user_id
  LIMIT  1;

  IF v_conversation_id IS NOT NULL THEN
    UPDATE conversation_participants
    SET    deleted_at = NULL
    WHERE  conversation_id = v_conversation_id
      AND  user_id IN (p_user_id, p_other_user_id)
      AND  deleted_at IS NOT NULL;

    RETURN v_conversation_id;
  END IF;

  INSERT INTO conversations (bounty_id, name, is_group, created_by)
  VALUES (v_safe_bounty_id, '', false, v_caller_id)
  RETURNING id INTO v_conversation_id;

  INSERT INTO conversation_participants (conversation_id, user_id)
  VALUES
    (v_conversation_id, p_user_id),
    (v_conversation_id, p_other_user_id)
  ON CONFLICT (conversation_id, user_id) DO NOTHING;

  RETURN v_conversation_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_get_or_create_dm_conversation(UUID, UUID, TEXT) TO authenticated;

-- Canonical rpc_create_conversation(uuid[], uuid, text): reject if ANY two
-- participants (including the caller) have a block relationship. Checking
-- for a blocked_users row where both blocker_id and blocked_id are members
-- of the participant set is equivalent to -- and cheaper than -- pairwise
-- comparison, since a block row only ever exists between two specific users.
CREATE OR REPLACE FUNCTION public.rpc_create_conversation(
  p_participant_ids UUID[],
  p_bounty_id UUID DEFAULT NULL::UUID,
  p_name TEXT DEFAULT NULL::TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog', 'pg_temp'
AS $$
DECLARE
  v_conv_id UUID;
  v_is_group BOOLEAN;
  has_name_col BOOLEAN := false;
  has_created_by_col BOOLEAN := false;
  participants UUID[];
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'rpc_create_conversation: auth.uid() is null';
  END IF;

  participants := ARRAY(SELECT DISTINCT u
                        FROM (
                          SELECT unnest(COALESCE(p_participant_ids, ARRAY[]::uuid[]))::uuid AS u
                          UNION
                          SELECT auth.uid()::uuid AS u
                        ) AS derived);

  IF EXISTS (
    SELECT 1
    FROM public.blocked_users bu
    WHERE bu.blocker_id = ANY(participants)
      AND bu.blocked_id = ANY(participants)
  ) THEN
    RAISE EXCEPTION 'cannot start a conversation that includes a blocked relationship'
      USING ERRCODE = '42501';
  END IF;

  v_is_group := array_length(participants, 1) IS NOT NULL AND array_length(participants, 1) > 2;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'conversations' AND column_name = 'name'
  ) INTO has_name_col;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'conversations' AND column_name = 'created_by'
  ) INTO has_created_by_col;

  IF has_name_col AND has_created_by_col THEN
    EXECUTE
      'INSERT INTO public.conversations (is_group, bounty_id, name, created_by) VALUES ($1, $2, $3, $4) RETURNING id'
    INTO v_conv_id
    USING v_is_group, p_bounty_id, COALESCE(p_name, ''), auth.uid()::uuid;

  ELSIF has_name_col THEN
    EXECUTE
      'INSERT INTO public.conversations (is_group, bounty_id, name) VALUES ($1, $2, $3) RETURNING id'
    INTO v_conv_id
    USING v_is_group, p_bounty_id, COALESCE(p_name, '');

  ELSIF has_created_by_col THEN
    EXECUTE
      'INSERT INTO public.conversations (is_group, bounty_id, created_by) VALUES ($1, $2, $3) RETURNING id'
    INTO v_conv_id
    USING v_is_group, p_bounty_id, auth.uid()::uuid;

  ELSE
    INSERT INTO public.conversations (is_group, bounty_id)
    VALUES (v_is_group, p_bounty_id)
    RETURNING id INTO v_conv_id;
  END IF;

  INSERT INTO public.conversation_participants (conversation_id, user_id)
  SELECT v_conv_id, p.uid
  FROM (
    SELECT DISTINCT unnest(participants) AS uid
  ) AS p
  WHERE EXISTS (SELECT 1 FROM public.profiles WHERE id = p.uid)
  ON CONFLICT (conversation_id, user_id) DO NOTHING;

  RETURN v_conv_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_create_conversation(UUID[], UUID, TEXT) TO authenticated;

-- Drop the dangerous, ungitted 2-arg overload: no auth.uid() check at all,
-- explicitly disables row_security, and is EXECUTE-granted to `anon`. It is
-- unreachable by any tracked client call (every call site passes p_name,
-- which resolves to the 3-arg overload above via PostgREST's named-param
-- matching), so removing it changes no legitimate behavior while closing a
-- hole that would otherwise bypass every block check added in this
-- migration.
DROP FUNCTION IF EXISTS public.rpc_create_conversation(UUID[], UUID);

NOTIFY pgrst, 'reload schema';
