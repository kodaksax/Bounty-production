-- Identity webhooks: write the status and queue its notification in one
-- profile-locked transaction, and supersede notifications that no longer match.
--
-- Why (review of PR #1026): identity-webhooks did the guarded status UPDATE and
-- the notifications_outbox INSERT as two separate PostgREST calls. If the
-- processing UPDATE committed but its response was slow, the verified handler
-- could run in between and queue "Identity Verified"; the processing handler
-- then resumed (its UPDATE had written one row) and queued a stale
-- "Verification Submitted" after it. Same for requires_input and canceled.
--
-- apply_identity_webhook_event() does, in one transaction:
--   1. SELECT ... FOR UPDATE on the profile, so every identity event for one
--      user runs one at a time.
--   2. The rule from supabase/functions/identity-webhooks/logic.ts: once a
--      profile is verified, no non-verified event moves it off verified. Such
--      an event writes nothing and queues nothing.
--   3. The status write (under the profile guard's trusted-write switch).
--   4. Marks status = 'superseded' on this user's still-undelivered
--      (pending, or failed and retryable) verification notifications whose type
--      doesn't match the new status. fn_claim_notification_outbox only claims
--      pending/failed rows, so a superseded row is never delivered, even when
--      the drain has already posted its id to process-notification.
--   5. Queues the new notification, when the caller passes one.
--
-- A row already claimed (status 'processing') is mid-delivery and can't be
-- recalled. It was queued while its status was current; the newer one follows.

CREATE OR REPLACE FUNCTION public.apply_identity_webhook_event(
  p_user_id          uuid,
  p_status           text,
  p_rejection_reason text  DEFAULT NULL,
  p_notification     jsonb DEFAULT NULL  -- {"type","title","body"}, or NULL for none
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current     text;
  v_type        text;
  v_superseded  integer := 0;
  v_notified    boolean := false;
BEGIN
  -- The notification type each status sends. Mirrors
  -- NOTIFICATION_TYPE_BY_STATUS in identity-webhooks/logic.ts.
  v_type := CASE p_status
    WHEN 'verified'       THEN 'verification_verified'
    WHEN 'processing'     THEN 'verification_submitted'
    WHEN 'requires_input' THEN 'verification_rejected'
    WHEN 'canceled'       THEN 'verification_canceled'
  END;
  IF v_type IS NULL THEN
    RAISE EXCEPTION 'apply_identity_webhook_event: unknown status %', p_status
      USING ERRCODE = '22023';
  END IF;
  IF p_notification IS NOT NULL AND p_notification ->> 'type' IS DISTINCT FROM v_type THEN
    RAISE EXCEPTION 'apply_identity_webhook_event: notification type % does not match status %',
      p_notification ->> 'type', p_status USING ERRCODE = '22023';
  END IF;

  SELECT stripe_identity_status INTO v_current
    FROM public.profiles
   WHERE id = p_user_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'no_profile');
  END IF;

  IF p_status <> 'verified' AND v_current = 'verified' THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'already_verified');
  END IF;

  PERFORM set_config('app.bypass_profile_guard', 'on', true);
  IF p_status = 'verified' THEN
    UPDATE public.profiles
       SET stripe_identity_status          = 'verified',
           id_verification_rejection_reason = NULL,
           -- Set once, never moved.
           verified_since                  = COALESCE(verified_since, now()),
           stripe_identity_last_event_at   = now(),
           -- Legacy mirrors read by getVerificationBadges and admin views.
           id_verification_status          = 'verified',
           age_verified                    = true,
           age_verified_at                 = now()
     WHERE id = p_user_id;
  ELSIF p_status = 'requires_input' THEN
    UPDATE public.profiles
       SET stripe_identity_status          = 'requires_input',
           id_verification_rejection_reason = p_rejection_reason,
           stripe_identity_last_event_at   = now()
     WHERE id = p_user_id;
  ELSE
    UPDATE public.profiles
       SET stripe_identity_status        = p_status,
           stripe_identity_last_event_at = now()
     WHERE id = p_user_id;
  END IF;
  PERFORM set_config('app.bypass_profile_guard', 'off', true);

  UPDATE public.notifications_outbox
     SET status     = 'superseded',
         last_error = 'superseded: identity status is now ' || p_status
   WHERE recipients = jsonb_build_array(p_user_id::text)
     AND data ->> 'type' IN ('verification_verified', 'verification_submitted',
                             'verification_rejected', 'verification_canceled')
     AND data ->> 'type' <> v_type
     AND (status = 'pending' OR (status = 'failed' AND attempts < 5));
  GET DIAGNOSTICS v_superseded = ROW_COUNT;

  IF p_notification IS NOT NULL THEN
    INSERT INTO public.notifications_outbox (recipients, title, body, data, status)
    VALUES (jsonb_build_array(p_user_id::text),
            p_notification ->> 'title',
            p_notification ->> 'body',
            jsonb_build_object('type', v_type),
            'pending');
    v_notified := true;
  END IF;

  RETURN jsonb_build_object('applied', true, 'superseded', v_superseded, 'notified', v_notified);
END;
$$;

-- Service role only (identity-webhooks). Supabase grants EXECUTE on new public
-- functions directly to anon and authenticated, so revoke from them by name.
REVOKE ALL ON FUNCTION public.apply_identity_webhook_event(uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_identity_webhook_event(uuid, text, text, jsonb) TO service_role;

-- 'superseded' is a finished state, like 'sent'. Without this the outbox
-- health probe would read a superseded row as an undelivered backlog and page
-- after 15 minutes.
UPDATE public.job_health_expectations
   SET probe_sql = replace(probe_sql, $q$status <> 'sent'$q$, $q$status NOT IN ('sent', 'superseded')$q$)
 WHERE job_name = 'drain-notifications-outbox'
   AND probe_sql LIKE $q$%status <> 'sent'%$q$;
