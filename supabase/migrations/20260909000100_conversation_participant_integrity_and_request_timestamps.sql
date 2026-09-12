-- P0-07 — conversation creation must not silently drop participants.
-- B-06  — bounty_requests.accepted_at / rejected_at are never written.
--
-- Two independent fixes, shipped together because both are one-statement
-- corrections to write paths that currently lose information without
-- complaining.

-- ===========================================================================
-- P0-07: rpc_create_conversation
-- ===========================================================================
-- The participant insert was:
--
--   INSERT INTO conversation_participants (conversation_id, user_id)
--   SELECT v_conv_id, p.uid FROM (...) p
--   WHERE EXISTS (SELECT 1 FROM public.profiles WHERE id = p.uid)
--   ON CONFLICT DO NOTHING;
--
-- ...and then RETURN v_conv_id. A participant with no `profiles` row is
-- skipped by the WHERE EXISTS and the function still reports success, so the
-- caller gets a conversation id for a thread the other party is not in. The
-- dropped party then fails the `messages` INSERT policy (which requires
-- membership) with a raw 42501, which is what the 21 Aug cascade in
-- client_logs is — five errors in one second ending in "all insert variants
-- failed", with no user-facing explanation.
--
-- The two RPCs also disagreed: rpc_get_or_create_dm_conversation inserts both
-- participants unconditionally. That one is right. This one is now consistent
-- with it, and refuses rather than half-succeeding.
--
-- Two auth users currently have no profile (checked at time of writing; both
-- inert — zero conversations, bounties and messages between them, so neither
-- is the cause of the August cascade). They are backfilled at the end of this
-- migration so the stricter check cannot fail on existing data.

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
  'P0-07: raises when a participant has no profiles row instead of silently omitting them and returning a conversation id as if it succeeded.';

-- Backfill the orphaned auth users so the stricter check cannot trip on
-- existing data. Mirrors handle_new_user''s username derivation, including its
-- collision suffix, and is a no-op for anyone who already has a profile.
INSERT INTO public.profiles (id, username, balance)
SELECT
  u.id,
  COALESCE(
    NULLIF(btrim(u.raw_user_meta_data->>'username'), ''),
    NULLIF(btrim(split_part(COALESCE(u.email, ''), '@', 1)), ''),
    'user_' || substring(u.id::text from 1 for 8)
  ) || '_' || substring(replace(u.id::text, '-', '') from 1 for 6),
  0
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE p.id IS NULL
ON CONFLICT (id) DO NOTHING;

-- ===========================================================================
-- B-06: bounty_requests.accepted_at / rejected_at
-- ===========================================================================
-- Both columns exist and are NULL on every one of the 323 rows, including all
-- 83 accepted and 92 rejected ones, because nothing ever writes them:
-- fn_accept_bounty_request sets `status` and `updated_at` and stops, and so do
-- the edge function, the API route and the admin client.
--
-- A trigger rather than a fix to fn_accept_bounty_request on purpose: there
-- are four writers of this column and a trigger catches all of them, including
-- any future one. Time-to-accept is the metric the pricing experiment turns
-- on, and it is currently uncomputable.

CREATE OR REPLACE FUNCTION public.fn_bounty_requests_stamp_decision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog', 'pg_temp'
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status::text = 'accepted' AND NEW.accepted_at IS NULL THEN
      NEW.accepted_at := now();
    ELSIF NEW.status::text = 'rejected' AND NEW.rejected_at IS NULL THEN
      NEW.rejected_at := now();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_bounty_requests_stamp_decision() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_bounty_requests_stamp_decision() FROM anon;

DROP TRIGGER IF EXISTS trg_bounty_requests_stamp_decision ON public.bounty_requests;
CREATE TRIGGER trg_bounty_requests_stamp_decision
  BEFORE UPDATE ON public.bounty_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_bounty_requests_stamp_decision();

COMMENT ON TRIGGER trg_bounty_requests_stamp_decision ON public.bounty_requests IS
  'B-06: stamps accepted_at/rejected_at on status transition, for every writer. Historical rows are backfilled from updated_at and are approximate.';

-- Backfill. updated_at is the best available proxy: the accept/reject UPDATE
-- also sets updated_at, so for rows that have not been touched since the
-- decision this IS the decision time. Rows edited afterwards will read late.
-- Approximate history is worth having — the alternative is no history at all —
-- but do not treat pre-migration rows as exact when computing time-to-accept.
UPDATE public.bounty_requests
SET accepted_at = updated_at
WHERE status::text = 'accepted' AND accepted_at IS NULL;

UPDATE public.bounty_requests
SET rejected_at = updated_at
WHERE status::text = 'rejected' AND rejected_at IS NULL;
