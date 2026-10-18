-- Release audit 2026-10-13: two SECURITY DEFINER functions trusted their caller.
--
-- 1. send_system_notification(uuid, text, text, text, jsonb) is EXECUTE-granted
--    to `authenticated` because dispute-service.ts uses it to tell the other
--    party that a dispute was opened. It never checked who was calling, so any
--    signed-in user could write a `security`-category notification -- which
--    process-notification force-pushes past preferences and quiet hours -- to
--    ANY user id, with any title and body (e.g. a fake "account_restricted"
--    push carrying a phishing link). Open on prod since 20260912033744.
--
--    Now:
--    - service_role / postgres (no `authenticated` JWT) and admins
--      (app_metadata.role = 'admin') keep full use of every supported type;
--    - a regular user may only send dispute_created / workflow_dispute_created,
--      for a dispute they initiated, to a party of that dispute's bounty
--      (poster, accepted hunter, respondent, cancellation requester) other than
--      themselves, at most once per (dispute, recipient, type);
--    - for those calls the title, body and data are rebuilt on the server.
--      The text is the same text shipped clients send today, so installed
--      builds keep working unchanged.
--
-- 2. increment_withdrawal_counter(uuid, timestamptz) is anon-executable on prod
--    (proacl has an explicit anon=X from Supabase's default privileges;
--    20260913220000 revoked PUBLIC and authenticated but not anon). Anyone could
--    bump any profile's withdrawal_count / last_withdrawal_at without signing
--    in. Only admin-withdrawals and webhooks call it, both as service_role.
--
-- Verify after apply:
--   SELECT has_function_privilege('anon',
--     'public.increment_withdrawal_counter(uuid,timestamptz)', 'EXECUTE');  -- false
--   node scripts/check-rls-policies.js --env production                    -- passes
-- Rollback: re-run the function body from 20260912033744 and
--   GRANT EXECUTE ON FUNCTION public.increment_withdrawal_counter(uuid, timestamptz) TO anon;
-- (the anon grant should never be restored in practice).

BEGIN;

CREATE OR REPLACE FUNCTION public.send_system_notification(
  p_user_id  UUID,
  p_type     TEXT,
  p_title    TEXT,
  p_body     TEXT,
  p_data     JSONB DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_category TEXT;
  v_title    TEXT := p_title;
  v_body     TEXT := p_body;
  v_data     JSONB := p_data;
  v_caller   UUID := auth.uid();
  v_dispute  RECORD;
  v_bounty   RECORD;
  v_requester UUID;
  v_stage    TEXT;
BEGIN
  IF p_type NOT IN (
    'dispute_created',
    'dispute_resolved',
    'dispute_escalated',
    'workflow_dispute_created',
    'account_warning',
    'account_restricted',
    'verification_submitted',
    'verification_verified',
    'verification_rejected',
    'verification_canceled'
  ) THEN
    RAISE EXCEPTION 'Unsupported notification type: %', p_type;
  END IF;

  -- Server code (service_role / postgres) and admins may send any supported
  -- type. A regular signed-in user may only tell the other party of a dispute
  -- they just opened.
  IF auth.role() = 'authenticated'
     AND COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin' THEN

    IF p_type NOT IN ('dispute_created', 'workflow_dispute_created') THEN
      RAISE EXCEPTION 'Not allowed to send % notifications', p_type
        USING ERRCODE = '42501';
    END IF;

    IF v_caller IS NULL OR p_user_id IS NULL OR p_user_id = v_caller THEN
      RAISE EXCEPTION 'Invalid notification recipient' USING ERRCODE = '42501';
    END IF;

    IF COALESCE(p_data ->> 'disputeId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'A disputeId is required' USING ERRCODE = '42501';
    END IF;

    SELECT d.id, d.bounty_id, d.initiator_id, d.respondent_id, d.cancellation_id
      INTO v_dispute
      FROM public.bounty_disputes d
     WHERE d.id = (p_data ->> 'disputeId')::uuid;

    IF NOT FOUND OR v_dispute.initiator_id IS DISTINCT FROM v_caller
       OR v_dispute.bounty_id IS NULL THEN
      RAISE EXCEPTION 'Not allowed to notify for this dispute' USING ERRCODE = '42501';
    END IF;

    SELECT b.title, b.user_id, b.poster_id, b.accepted_by
      INTO v_bounty
      FROM public.bounties b
     WHERE b.id = v_dispute.bounty_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Not allowed to notify for this dispute' USING ERRCODE = '42501';
    END IF;

    IF v_dispute.cancellation_id IS NOT NULL THEN
      SELECT c.requester_id INTO v_requester
        FROM public.bounty_cancellations c
       WHERE c.id = v_dispute.cancellation_id;
    END IF;

    IF p_user_id IS DISTINCT FROM v_bounty.user_id
       AND p_user_id IS DISTINCT FROM v_bounty.poster_id
       AND p_user_id IS DISTINCT FROM v_bounty.accepted_by
       AND p_user_id IS DISTINCT FROM v_dispute.respondent_id
       AND p_user_id IS DISTINCT FROM v_requester THEN
      RAISE EXCEPTION 'Recipient is not a party to this dispute' USING ERRCODE = '42501';
    END IF;

    -- One notification per dispute, recipient and type; repeats are a no-op.
    PERFORM pg_advisory_xact_lock(
      hashtextextended(format('%s:%s:%s', p_user_id, p_type, v_dispute.id), 0)
    );
    IF EXISTS (
      SELECT 1 FROM public.notifications n
       WHERE n.user_id = p_user_id
         AND n.type = p_type
         AND n.data ->> 'disputeId' = v_dispute.id::text
    ) THEN
      RETURN;
    END IF;

    -- Same wording dispute-service.ts sends, built from server data only.
    IF p_type = 'dispute_created' THEN
      v_title := 'Dispute Created';
      v_body  := 'A dispute has been opened for bounty: ' || COALESCE(v_bounty.title, 'your bounty');
    ELSE
      v_title := 'Dispute Raised';
      v_body  := 'A dispute has been raised for bounty: ' || COALESCE(v_bounty.title, 'your bounty');
    END IF;

    v_stage := p_data ->> 'stage';
    IF v_stage IS NOT NULL AND v_stage !~ '^[a-z_]{1,40}$' THEN
      v_stage := NULL;
    END IF;

    v_data := jsonb_strip_nulls(jsonb_build_object(
      'bountyId', v_dispute.bounty_id::text,
      'disputeId', v_dispute.id,
      'cancellationId', v_dispute.cancellation_id::text,
      'stage', v_stage
    ));
  END IF;

  v_category := CASE
    WHEN p_type IN ('dispute_created','dispute_resolved','dispute_escalated',
                     'workflow_dispute_created','account_warning','account_restricted') THEN 'security'
    WHEN p_type IN ('verification_submitted','verification_verified',
                     'verification_rejected','verification_canceled') THEN 'verification'
  END;

  INSERT INTO public.notifications (user_id, type, category, title, body, data, read)
  VALUES (p_user_id, p_type, v_category, v_title, v_body, v_data, false);

  BEGIN
    INSERT INTO public.notifications_outbox (recipients, title, body, data, status)
    VALUES (
      jsonb_build_array(p_user_id),
      v_title,
      v_body,
      COALESCE(v_data, '{}'::jsonb) || jsonb_build_object('type', p_type, 'skipInApp', true),
      'pending'
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'send_system_notification: notifications_outbox enqueue failed (non-fatal) for user %, type %: %',
      p_user_id, p_type, SQLERRM;
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.send_system_notification(UUID, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.send_system_notification(UUID, TEXT, TEXT, TEXT, JSONB) FROM anon;
GRANT EXECUTE ON FUNCTION public.send_system_notification(UUID, TEXT, TEXT, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.send_system_notification(UUID, TEXT, TEXT, TEXT, JSONB) TO service_role;

REVOKE ALL ON FUNCTION public.increment_withdrawal_counter(UUID, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.increment_withdrawal_counter(UUID, TIMESTAMPTZ) FROM anon;
REVOKE ALL ON FUNCTION public.increment_withdrawal_counter(UUID, TIMESTAMPTZ) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.increment_withdrawal_counter(UUID, TIMESTAMPTZ) TO service_role;

COMMIT;
