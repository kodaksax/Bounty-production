-- Reverts 20261125180000_conversation_summaries_last_person_message.sql.
--
-- Restores get_conversation_summaries() exactly as 20260916120000_messaging_
-- rls_performance.sql defined it: six columns, the same body (byte-for-byte;
-- md5(prosrc) 8e269bb9b779e50d98e54374ba7be2f3 on staging, 2026-11-25),
-- SECURITY INVOKER, STABLE, search_path = public, and the same grants. The
-- app reads the two removed columns only when present, so it keeps working.

BEGIN;

DROP FUNCTION IF EXISTS public.get_conversation_summaries();

CREATE FUNCTION public.get_conversation_summaries()
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

COMMIT;
