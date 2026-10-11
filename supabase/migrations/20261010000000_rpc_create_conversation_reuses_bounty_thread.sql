-- rpc_create_conversation reuses the bounty thread instead of opening a second one.
--
-- 20261009000000_bounty_thread_event_cards creates one conversation per
-- (bounty, hunter) when the hunter applies, and writes event cards into it.
-- The app's accept flow (hooks/useAcceptRequest.ts) then calls
-- rpc_create_conversation([poster, hunter], bounty_id), which always INSERTs a
-- new conversation. Poster and hunter would end up with two conversations for
-- the same bounty: the app's (with its "Welcome!" message and their chat) and
-- the thread (with the cards, and the only one the website shows).
--
-- Fixed here rather than in the app so every installed build gets it: for a
-- 1:1 conversation tagged with a bounty, where one side is the bounty's poster
-- and the other has applied to it or been accepted on it, return
-- fn_bounty_thread_id(bounty, hunter). Every other call is unchanged.
--
-- All existing checks (signed in, active account, blocks, missing profiles)
-- still run first. The hunter condition keeps an unrelated user from being
-- filed as a bounty's hunter just by opening a chat tagged with it; they get a
-- plain new conversation as before.
--
-- fn_bounty_thread_id is looked up at call time, so rolling back
-- 20261009000000 (which drops it) leaves this function on its old path rather
-- than broken.
--
-- Rollback: supabase/rollbacks/production/20261010000000_rpc_create_conversation_reuses_bounty_thread.down.sql

BEGIN;

CREATE OR REPLACE FUNCTION public.rpc_create_conversation(
  p_participant_ids uuid[],
  p_bounty_id uuid DEFAULT NULL::uuid,
  p_name text DEFAULT NULL::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v_conv_id UUID;
  v_is_group BOOLEAN;
  has_name_col BOOLEAN := false;
  has_created_by_col BOOLEAN := false;
  participants UUID[];
  missing_profiles UUID[];
  v_poster_id UUID;
  v_hunter_id UUID;
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

  -- Refuse up front rather than creating a conversation the caller believes is
  -- complete. Checked BEFORE the conversations INSERT so a rejected call
  -- leaves no orphan conversation row behind.
  missing_profiles := ARRAY(
    SELECT u FROM unnest(participants) AS u
    WHERE NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = u)
  );

  IF array_length(missing_profiles, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'cannot start a conversation: % participant account(s) are not set up',
                    array_length(missing_profiles, 1)
      USING ERRCODE = 'foreign_key_violation',
            DETAIL  = 'participant ids without a profile: ' || array_to_string(missing_profiles, ', '),
            HINT    = 'The other person has not finished setting up their account yet.';
  END IF;

  -- Poster + hunter on a bounty: use the bounty thread, so the app, the cards
  -- and the website all share one conversation.
  IF p_bounty_id IS NOT NULL
     AND array_length(participants, 1) = 2
     AND to_regprocedure('public.fn_bounty_thread_id(uuid, uuid)') IS NOT NULL THEN
    SELECT b.poster_id INTO v_poster_id FROM public.bounties b WHERE b.id = p_bounty_id;
    IF v_poster_id IS NOT NULL AND v_poster_id = ANY(participants) THEN
      SELECT u INTO v_hunter_id FROM unnest(participants) AS u WHERE u <> v_poster_id;
      IF EXISTS (SELECT 1 FROM public.bounties b WHERE b.id = p_bounty_id AND b.accepted_by = v_hunter_id)
         OR EXISTS (SELECT 1 FROM public.bounty_requests r WHERE r.bounty_id = p_bounty_id AND r.hunter_id = v_hunter_id) THEN
        RETURN public.fn_bounty_thread_id(p_bounty_id, v_hunter_id);
      END IF;
    END IF;
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

  -- Unconditional now: every participant is known to have a profile.
  INSERT INTO public.conversation_participants (conversation_id, user_id)
  SELECT v_conv_id, p.uid
  FROM (SELECT DISTINCT unnest(participants) AS uid) AS p
  ON CONFLICT (conversation_id, user_id) DO NOTHING;

  RETURN v_conv_id;
END;
$function$;

COMMENT ON FUNCTION public.rpc_create_conversation(uuid[], uuid, text) IS
  'Raises when a participant has no profiles row (P0-07). A 1:1 call for a bounty''s poster and one of its hunters returns the bounty thread (fn_bounty_thread_id) instead of creating a second conversation.';

COMMIT;
