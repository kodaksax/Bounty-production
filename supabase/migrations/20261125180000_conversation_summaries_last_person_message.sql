-- get_conversation_summaries(): when each side last sent a message themselves
-- (E2E-04, Whole-Job Test 2026-11-24).
--
-- My Jobs features a hired job when the helper has gone quiet: no message
-- from them for FOCUS_POLICY.silenceThresholdHours since the later of the
-- hire and their last message. The conversation list had only the last
-- message of ANY kind, including the server's event cards written in the
-- helper's name ("Applied to this bounty."), and no sender. This adds two
-- columns, so the list knows when each side last spoke:
--
--   my_last_message_at     the caller's own last person message
--   other_last_message_at  the other participant's (or participants')
--
-- "A person's own message" is defined once, in lib/utils/hired-phase.ts
-- (PERSON_MESSAGE_RULE), and matched exactly here:
--   message_type IN ('text', 'image', 'file')                  -- not 'system'
--   AND text !~ '^\s*Welcome! You''ve been selected for: '     -- not the app's hire welcome
-- __tests__/unit/conversation-summaries-person-message.test.ts keeps them equal.
--
-- Everything else is unchanged: the first six columns, their order and
-- meaning, SECURITY INVOKER (the caller's own RLS), STABLE, search_path, and
-- the grants. The return type changes, so the function is dropped and
-- re-created (CREATE OR REPLACE cannot change a RETURNS TABLE). The one
-- caller, lib/services/supabase-messaging.ts, reads columns by name and
-- ignores the new ones until it's updated; it falls back to its per
-- conversation path if the function is missing.
--
-- No new index: both values come from one scan per conversation on
-- idx_messages_conversation_id (conversation_id, created_at DESC), the same
-- index the last-message lookup uses. EXPLAIN ANALYZE on staging for its
-- heaviest user (74 conversations): 1.3 ms before, 2.8 ms after.
--
-- Rollback: supabase/rollbacks/production/20261125180000_conversation_summaries_last_person_message.down.sql

BEGIN;

DROP FUNCTION IF EXISTS public.get_conversation_summaries();

CREATE FUNCTION public.get_conversation_summaries()
RETURNS TABLE (
  conversation_id        uuid,
  last_read_at           timestamptz,
  last_message_text      text,
  last_message_media_url text,
  last_message_at        timestamptz,
  unread_count           bigint,
  my_last_message_at     timestamptz,
  other_last_message_at  timestamptz
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
    END,
    pm.my_last,
    pm.other_last
  FROM mine m
  LEFT JOIN LATERAL (
    SELECT x.text, x.media_url, x.attachment_url, x.created_at
    FROM public.messages x
    WHERE x.conversation_id = m.conversation_id
    ORDER BY x.created_at DESC
    LIMIT 1
  ) lm ON true
  LEFT JOIN LATERAL (
    -- PERSON_MESSAGE_RULE (lib/utils/hired-phase.ts)
    SELECT
      max(x.created_at) FILTER (WHERE x.sender_id = (SELECT auth.uid()))  AS my_last,
      max(x.created_at) FILTER (WHERE x.sender_id <> (SELECT auth.uid())) AS other_last
    FROM public.messages x
    WHERE x.conversation_id = m.conversation_id
      AND x.message_type IN ('text', 'image', 'file')
      AND x.text !~ '^\s*Welcome! You''ve been selected for: '
  ) pm ON true
$$;

-- Supabase's default privileges grant EXECUTE to anon explicitly, which a
-- REVOKE FROM public does not undo.
REVOKE ALL ON FUNCTION public.get_conversation_summaries() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_conversation_summaries() TO authenticated, service_role;

COMMIT;
