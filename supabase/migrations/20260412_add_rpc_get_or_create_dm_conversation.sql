-- Migration: add_rpc_get_or_create_dm_conversation
-- Date: 2026-04-12
-- Purpose: Enforce a single conversation thread per user pair for DMs.
--
-- Problem the previous client-side approach had:
--   getOrCreateConversation() in supabase-messaging.ts performed a
--   read-then-insert sequence in two separate network round-trips. Two
--   concurrent callers (e.g. both users tapping "Message" at the same time)
--   could both pass the "no existing conversation" check and each INSERT a
--   new row, yielding duplicate DM threads for the same user pair.
--
-- Solution:
--   A SECURITY DEFINER PostgreSQL function that:
--     1. Acquires a transaction-scoped advisory lock keyed on the canonical
--        (sorted) user pair so that concurrent calls for the same pair are
--        serialized at the DB level.
--     2. Searches for an existing 1:1 (is_group = false) conversation that
--        has both users as active participants — in a single JOIN query.
--     3. Returns the existing conversation ID if found (reactivating a
--        soft-deleted participant record if needed).
--     4. Otherwise inserts a new conversation row + two participant rows and
--        returns the new ID.
--
-- The client (supabase-messaging.ts) now calls this RPC instead of doing
-- two separate Supabase queries.

CREATE OR REPLACE FUNCTION public.rpc_get_or_create_dm_conversation(
  p_user_id       uuid,
  p_other_user_id uuid,
  p_bounty_id     text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conversation_id uuid;
  v_caller_id       uuid := auth.uid();
  v_safe_bounty_id  uuid;
  v_lock_key        bigint;
BEGIN
  -- Require an authenticated caller
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  -- Caller must be one of the two participants to prevent creating DMs on
  -- behalf of other users.
  IF v_caller_id != p_user_id AND v_caller_id != p_other_user_id THEN
    RAISE EXCEPTION 'unauthorized: caller must be one of the participants';
  END IF;

  -- Prevent self-DMs
  IF p_user_id = p_other_user_id THEN
    RAISE EXCEPTION 'cannot create a DM conversation with yourself';
  END IF;

  -- Safely cast the bounty ID; treat 'undefined' / empty / invalid values as NULL.
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

  -- Derive a deterministic lock key from the sorted pair so concurrent
  -- callers for the same two users always contend on the same lock slot.
  -- hashtext() is stable within a PostgreSQL major version.
  v_lock_key := hashtext(
    LEAST(p_user_id::text, p_other_user_id::text)
    || ':'
    || GREATEST(p_user_id::text, p_other_user_id::text)
  );

  -- Serialize all concurrent DM creation attempts for this user pair.
  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- Look for an existing 1:1 conversation that both users actively participate
  -- in (deleted_at IS NULL on both sides).
  SELECT cp1.conversation_id INTO v_conversation_id
  FROM   conversation_participants cp1
  JOIN   conversation_participants cp2
         ON  cp2.conversation_id = cp1.conversation_id
         AND cp2.user_id         = p_other_user_id
         AND cp2.deleted_at IS NULL
  JOIN   conversations c
         ON  c.id       = cp1.conversation_id
         AND c.is_group = false
  WHERE  cp1.user_id    = p_user_id
    AND  cp1.deleted_at IS NULL
  LIMIT  1;

  -- ── Existing conversation found ──────────────────────────────────────────
  IF v_conversation_id IS NOT NULL THEN
    -- If the other user had previously soft-deleted their view of this
    -- conversation, reactivate it so they can see new messages.
    UPDATE conversation_participants
    SET    deleted_at = NULL
    WHERE  conversation_id = v_conversation_id
      AND  user_id         = p_other_user_id
      AND  deleted_at IS NOT NULL;

    RETURN v_conversation_id;
  END IF;

  -- ── No existing conversation — create a new one ──────────────────────────
  INSERT INTO conversations (bounty_id, name, is_group, created_by)
  VALUES (v_safe_bounty_id, '', false, v_caller_id)
  RETURNING id INTO v_conversation_id;

  -- Add both participants (ON CONFLICT is a safety net; should never fire here
  -- because we hold the advisory lock, but guards against logic changes).
  INSERT INTO conversation_participants (conversation_id, user_id)
  VALUES
    (v_conversation_id, p_user_id),
    (v_conversation_id, p_other_user_id)
  ON CONFLICT (conversation_id, user_id) DO NOTHING;

  RETURN v_conversation_id;
END;
$$;

-- Grant execution to authenticated users only
GRANT EXECUTE ON FUNCTION public.rpc_get_or_create_dm_conversation(uuid, uuid, text) TO authenticated;

-- Signal PostgREST to reload its schema cache
NOTIFY pgrst, 'reload schema';
