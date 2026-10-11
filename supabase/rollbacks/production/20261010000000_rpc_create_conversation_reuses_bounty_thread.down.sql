-- Rollback for 20261010000000_rpc_create_conversation_reuses_bounty_thread.sql
--
-- Restores rpc_create_conversation as of 20260909000100 (always creates a new
-- conversation). Conversations already returned as bounty threads are kept.

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
  FROM (SELECT DISTINCT unnest(participants) AS uid) AS p
  ON CONFLICT (conversation_id, user_id) DO NOTHING;

  RETURN v_conv_id;
END;
$function$;

COMMENT ON FUNCTION public.rpc_create_conversation(uuid[], uuid, text) IS
  'P0-07: raises when a participant has no profiles row instead of silently omitting them and returning a conversation id as if it succeeded.';

COMMIT;
