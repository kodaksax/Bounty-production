-- Migration: Enforce profiles.account_status (suspended/banned) across the app
-- Created: 2026-07-26
--
-- BACKGROUND: an audit found that profiles.account_status (added in
-- 20260719030000_add_profiles_account_status.sql, whose own column comment
-- literally says "not yet enforced anywhere") is settable by admins via the
-- admin-profiles Edge Function's updateStatus action, but nothing actually
-- reads it except the withdrawal path (supabase/functions/connect/index.ts +
-- withdrawal-validation.ts's validateAccountEligibility). A banned or
-- suspended user can still sign in, post bounties, apply to bounties, accept
-- requests, message, create conversations, and edit their own profile.
--
-- This migration follows the exact same shape of fix as
-- 20260725150000_trust_safety_hardening.sql (which found blocked_users had
-- zero enforcement effect and fixed it with SECURITY DEFINER helpers wired
-- into both RLS policies and SECURITY DEFINER RPC bodies, since RLS alone
-- cannot reach RPCs that run as a bypassrls role):
--
--  1. is_account_active(uuid)   -- boolean, for RLS WITH CHECK clauses
--  2. assert_account_active(uuid) -- raises 'account_banned'/'account_suspended',
--     for use inside SECURITY DEFINER RPC bodies where a boolean can't reject
--     the call on its own.
--  3. conversation_has_inactive_participant(conversation_id, sender_id) --
--     mirrors conversation_has_block's shape, so that a banned/suspended
--     user cannot *receive* new messages either: if any other active
--     participant of a conversation is banned/suspended, no one (including an
--     active sender) can insert a new message into it.
--  4. RLS updates on bounties/bounty_requests/messages/conversation_participants/
--     profiles INSERT|UPDATE policies to call is_account_active().
--  5. SECURITY DEFINER RPC updates (fn_accept_bounty_request,
--     rpc_get_or_create_dm_conversation, rpc_create_conversation) to call
--     assert_account_active() on the caller.
--  6. admin_action_log gains an 'account_status_change' action_type so every
--     admin suspend/ban/reactivate is now audited (previously nothing was
--     logged at all -- lib/services/audit-log-service.ts is 100% mock data).

-- ============================================================================
-- 1. Helper functions
-- ============================================================================

CREATE OR REPLACE FUNCTION public.is_account_active(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT account_status = 'active' FROM public.profiles WHERE id = p_user_id),
    true
  );
$$;

REVOKE ALL ON FUNCTION public.is_account_active(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_account_active(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.assert_account_active(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status TEXT;
BEGIN
  SELECT account_status INTO v_status FROM public.profiles WHERE id = p_user_id;
  IF v_status = 'banned' THEN
    RAISE EXCEPTION 'account_banned' USING ERRCODE = '42501';
  ELSIF v_status = 'suspended' THEN
    RAISE EXCEPTION 'account_suspended' USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_account_active(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assert_account_active(UUID) TO authenticated;

-- True if any OTHER currently-active participant of p_conversation_id is
-- suspended/banned. Mirrors conversation_has_block's shape exactly. Used so
-- a banned/suspended user cannot receive new messages either -- once any
-- OTHER participant of a conversation is inactive, no one can insert a new
-- message into it. The sender's own status is checked separately via
-- is_account_active(sender_id) in the messages RLS policy below.
CREATE OR REPLACE FUNCTION public.conversation_has_inactive_participant(p_conversation_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.conversation_participants cp
    JOIN public.profiles p ON p.id = cp.user_id
    WHERE cp.conversation_id = p_conversation_id
      AND cp.user_id <> p_user_id
      AND cp.deleted_at IS NULL
      AND p.account_status <> 'active'
  );
$$;

REVOKE ALL ON FUNCTION public.conversation_has_inactive_participant(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.conversation_has_inactive_participant(UUID, UUID) TO authenticated;

-- ============================================================================
-- 2. RLS updates -- direct client insert/update paths
-- ============================================================================

-- Posting a bounty
DROP POLICY IF EXISTS "Users can create bounties" ON public.bounties;
CREATE POLICY "Users can create bounties"
  ON public.bounties
  FOR INSERT
  WITH CHECK (auth.uid() = poster_id AND public.is_account_active(auth.uid()));

-- Applying to a bounty
DROP POLICY IF EXISTS "Hunters can create applications" ON public.bounty_requests;
CREATE POLICY "Hunters can create applications"
  ON public.bounty_requests
  FOR INSERT
  WITH CHECK (auth.uid() = hunter_id AND public.is_account_active(auth.uid()));

-- Sending a message: sender must be active, AND no participant of the
-- conversation (including the sender) may be inactive -- this is what makes
-- "cannot receive messages" a real, DB-enforced rule rather than an
-- incidental side effect of the sign-in gate.
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
    AND public.is_account_active(sender_id)
    AND NOT public.conversation_has_block(conversation_id, sender_id)
    AND NOT public.conversation_has_inactive_participant(conversation_id, sender_id)
  );

-- Adding a conversation participant
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
    AND public.is_account_active(auth.uid())
  );

-- Editing a profile: a suspended/banned user may still be READ (USING stays
-- auth.uid() = id) but may not UPDATE their own row. The admin write path
-- (admin-profiles Edge Function) uses service_role, which bypasses RLS
-- entirely, so this does not block admins from changing account_status.
DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id AND public.is_account_active(auth.uid()));

-- ============================================================================
-- 3. SECURITY DEFINER RPC updates -- RLS cannot reach these
-- ============================================================================

-- fn_accept_bounty_request(text): pure CREATE OR REPLACE of the live body
-- (confirmed via 20260719010000_document_fn_accept_bounty_request_authz_guard.sql),
-- adding an account-status check for authenticated callers immediately after
-- the existing poster-ownership guard.
CREATE OR REPLACE FUNCTION public.fn_accept_bounty_request(p_request_id text)
RETURNS TABLE(bounty json, accepted_request json)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  req_row         RECORD;
  bounty_row      RECORD;
  updated_bounty  RECORD;
  updated_request RECORD;
  v_request_id    uuid := p_request_id::uuid;
BEGIN
  -- Lock the request row to prevent concurrent acceptance
  SELECT * INTO req_row FROM public.bounty_requests WHERE id = v_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'request_not_found';
  END IF;

  IF req_row.status IS NULL OR req_row.status::text <> 'pending' THEN
    RAISE EXCEPTION 'request_not_pending';
  END IF;

  -- Lock the bounty row
  SELECT * INTO bounty_row FROM public.bounties WHERE id = req_row.bounty_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bounty_not_found';
  END IF;

  -- ── Authorization guard ────────────────────────────────────────────────
  -- Only the bounty poster may accept a request. Service-role callers (edge
  -- functions, no JWT) are allowed; authenticated end-users must be the poster
  -- AND have an active account.
  -- Mirrors accept_bounty_request(uuid) and the dispute-RPC guard pattern.
  IF auth.role() = 'authenticated' THEN
    IF bounty_row.poster_id IS NULL OR bounty_row.poster_id <> auth.uid() THEN
      RAISE EXCEPTION 'Only the bounty poster can accept a request'
        USING ERRCODE = '42501';
    END IF;
    PERFORM public.assert_account_active(auth.uid());
  END IF;
  -- ── End authorization guard ────────────────────────────────────────────

  IF bounty_row.status IS NULL OR bounty_row.status::text <> 'open' THEN
    RAISE EXCEPTION 'bounty_not_open';
  END IF;

  -- Atomically transition the bounty to in_progress
  UPDATE public.bounties
  SET
    status              = 'in_progress',
    accepted_request_id = v_request_id,
    accepted_by         = req_row.hunter_id,
    updated_at          = now()
  WHERE id = bounty_row.id;

  -- Mark the accepted request
  UPDATE public.bounty_requests
  SET status = 'accepted', updated_at = now()
  WHERE id = v_request_id;

  -- Reject all other pending requests for this bounty
  UPDATE public.bounty_requests
  SET status = 'rejected', updated_at = now()
  WHERE bounty_id = bounty_row.id
    AND id <> v_request_id
    AND status::text = 'pending';

  -- Read back the authoritative updated rows
  SELECT * INTO updated_bounty  FROM public.bounties        WHERE id = bounty_row.id;
  SELECT * INTO updated_request FROM public.bounty_requests WHERE id = v_request_id;

  RETURN QUERY SELECT row_to_json(updated_bounty), row_to_json(updated_request);
EXCEPTION
  WHEN others THEN
    RAISE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_accept_bounty_request(text) TO authenticated;

-- rpc_get_or_create_dm_conversation: pure CREATE OR REPLACE of the live body
-- (confirmed in 20260725150000_trust_safety_hardening.sql), adding an
-- account-status check on the caller right after the unauthenticated/self-DM
-- checks and before the block check.
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

  PERFORM public.assert_account_active(v_caller_id);

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

-- rpc_create_conversation: pure CREATE OR REPLACE of the live body (confirmed
-- in 20260725150000_trust_safety_hardening.sql), adding an account-status
-- check on the caller right after the auth.uid() IS NULL check.
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

  PERFORM public.assert_account_active(auth.uid());

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

-- ============================================================================
-- 4. Audit log -- extend admin_action_log to cover account status changes
-- ============================================================================

ALTER TABLE public.admin_action_log
  DROP CONSTRAINT IF EXISTS admin_action_log_action_type_check;
ALTER TABLE public.admin_action_log
  ADD CONSTRAINT admin_action_log_action_type_check
  CHECK (action_type IN ('force_retry_withdrawal', 'manual_balance_adjustment', 'account_status_change'));

NOTIFY pgrst, 'reload schema';
