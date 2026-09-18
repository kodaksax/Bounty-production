-- Migration: messaging RLS performance
-- Created: 2026-09-16
--
-- Problem
-- -------
-- Opening a DM or the inbox was slow even though `messages` holds a few
-- hundred rows. pg_stat_statements showed a plain
--   SELECT * FROM messages WHERE conversation_id = $1
-- averaging 45-85 ms, and EXPLAIN ANALYZE as an authenticated user showed why:
--
--   * The `messages` SELECT policy is
--       conversation_id IN (SELECT conversation_id FROM conversation_participants
--                           WHERE user_id = auth.uid() AND deleted_at IS NULL)
--     That subquery runs under conversation_participants' OWN RLS, whose
--     policy calls the plpgsql function is_user_participant(...) -- which
--     runs another query -- for EVERY row of conversation_participants.
--   * auth.uid() was not wrapped in (select ...), so the JWT was re-parsed
--     (current_setting + jsonb) three times per row instead of once.
--
-- Net effect: every message read seq-scans the whole participants table and
-- pays a function call per row. Cost grows with the number of participants
-- rows in the system, not with the thread being opened. The inbox then
-- multiplies this by issuing two such queries per conversation.
--
-- Fix
-- ---
-- 1. my_conversation_ids(): a SECURITY DEFINER SQL function that returns the
--    caller's active conversation ids by reading conversation_participants
--    directly (bypassing its RLS, so no recursion and no per-row function).
--    It is STABLE, so the planner evaluates it once per statement as a
--    hashed InitPlan and probes it per row.
-- 2. Rewrite the messaging SELECT/UPDATE policies (and the messages INSERT
--    membership check) in terms of that function. Visible rows are identical
--    to before: "conversations the caller is an active participant of".
-- 3. Drop "Users can view their conversations", an exact duplicate of
--    conversations_select_if_participant (Postgres ORs permissive policies,
--    so it only added work).
-- 4. get_conversation_summaries(): one RPC returning last message + unread
--    count for every conversation of the caller, replacing 2 requests per
--    conversation from the inbox.

-- ---------------------------------------------------------------------------
-- 1. Caller's active conversation ids, evaluated once per statement
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.my_conversation_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT cp.conversation_id
  FROM public.conversation_participants cp
  WHERE cp.user_id = (SELECT auth.uid())
    AND cp.deleted_at IS NULL
$$;

-- Supabase's default privileges grant EXECUTE to anon explicitly, which a
-- REVOKE FROM public does not undo.
REVOKE ALL ON FUNCTION public.my_conversation_ids() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.my_conversation_ids() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. conversation_participants
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view conversation participants" ON public.conversation_participants;
CREATE POLICY "Users can view conversation participants"
  ON public.conversation_participants FOR SELECT
  USING (conversation_id IN (SELECT public.my_conversation_ids()));

-- Own rows, including soft-deleted ones (so a deleted conversation can be
-- detected / restored). Was `user_id = auth.uid()`; same predicate, evaluated
-- once per statement.
DROP POLICY IF EXISTS "conv_participants_select_self" ON public.conversation_participants;
CREATE POLICY "conv_participants_select_self"
  ON public.conversation_participants FOR SELECT
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users can update their own participant record" ON public.conversation_participants;
CREATE POLICY "Users can update their own participant record"
  ON public.conversation_participants FOR UPDATE
  USING (user_id = (SELECT auth.uid()));

-- ---------------------------------------------------------------------------
-- 3. conversations
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view their conversations" ON public.conversations;
DROP POLICY IF EXISTS "conversations_select_if_participant" ON public.conversations;
CREATE POLICY "conversations_select_if_participant"
  ON public.conversations FOR SELECT
  USING (id IN (SELECT public.my_conversation_ids()));

DROP POLICY IF EXISTS "Participants can update conversations" ON public.conversations;
CREATE POLICY "Participants can update conversations"
  ON public.conversations FOR UPDATE
  USING (id IN (SELECT public.my_conversation_ids()));

-- ---------------------------------------------------------------------------
-- 4. messages
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view messages in their conversations" ON public.messages;
CREATE POLICY "Users can view messages in their conversations"
  ON public.messages FOR SELECT
  USING (conversation_id IN (SELECT public.my_conversation_ids()));

-- Same checks as before (membership, sender, account active, no block, no
-- inactive participant); only the membership subquery changed.
DROP POLICY IF EXISTS "Users can send messages in their conversations" ON public.messages;
CREATE POLICY "Users can send messages in their conversations"
  ON public.messages FOR INSERT
  WITH CHECK (
    conversation_id IN (SELECT public.my_conversation_ids())
    AND sender_id = (SELECT auth.uid())
    AND public.is_account_active(sender_id)
    AND NOT public.conversation_has_block(conversation_id, sender_id)
    AND NOT public.conversation_has_inactive_participant(conversation_id, sender_id)
  );

DROP POLICY IF EXISTS "Users can update their own messages" ON public.messages;
CREATE POLICY "Users can update their own messages"
  ON public.messages FOR UPDATE
  USING (sender_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users can delete their own messages" ON public.messages;
CREATE POLICY "Users can delete their own messages"
  ON public.messages FOR DELETE
  USING (sender_id = (SELECT auth.uid()));

-- ---------------------------------------------------------------------------
-- 5. Inbox summaries in one round trip
-- ---------------------------------------------------------------------------
-- SECURITY INVOKER: runs under the caller's (now cheap) RLS, so it can only
-- ever see the caller's own conversations and messages.
CREATE OR REPLACE FUNCTION public.get_conversation_summaries()
RETURNS TABLE (
  conversation_id        uuid,
  last_read_at           timestamptz,
  last_message_text      text,
  last_message_media_url text,
  last_message_at        timestamptz,
  unread_count           bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH mine AS (
    SELECT cp.conversation_id, cp.last_read_at
    FROM public.conversation_participants cp
    WHERE cp.user_id = (SELECT auth.uid())
      AND cp.deleted_at IS NULL
  )
  SELECT
    m.conversation_id,
    m.last_read_at,
    lm.text,
    COALESCE(lm.media_url, lm.attachment_url),
    lm.created_at,
    CASE
      WHEN m.last_read_at IS NULL THEN 0
      ELSE (
        SELECT count(*)
        FROM public.messages x
        WHERE x.conversation_id = m.conversation_id
          AND x.created_at > m.last_read_at
          AND x.sender_id <> (SELECT auth.uid())
      )
    END
  FROM mine m
  LEFT JOIN LATERAL (
    SELECT x.text, x.media_url, x.attachment_url, x.created_at
    FROM public.messages x
    WHERE x.conversation_id = m.conversation_id
    ORDER BY x.created_at DESC
    LIMIT 1
  ) lm ON true
$$;

REVOKE ALL ON FUNCTION public.get_conversation_summaries() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_conversation_summaries() TO authenticated, service_role;
