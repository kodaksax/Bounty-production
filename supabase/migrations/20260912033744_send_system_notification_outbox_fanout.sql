-- Notification system audit (2026-09-11): send_system_notification() has, since
-- its introduction, only ever inserted into `public.notifications` (the in-app
-- bell). It never touched `notifications_outbox`, so every notification sent
-- through this RPC -- dispute_created, dispute_resolved, dispute_escalated,
-- workflow_dispute_created, account_warning, account_restricted,
-- verification_submitted/verified/rejected/canceled -- has been getting an
-- in-app row and NOTHING ELSE: no push, no email, no quiet-hours/urgent
-- handling, even though the taxonomy in process-notification/index.ts
-- classifies the dispute/account types as `security`, a category meant to
-- force push regardless of preferences or quiet hours. That forcing logic
-- never got a chance to run.
--
-- (Note: identity-webhooks/index.ts already enqueues verification_* through
-- notifications_outbox directly via enqueueVerificationNotification(), so in
-- practice this bug's live impact is limited to dispute-service.ts's callers
-- -- dispute_created/dispute_resolved/dispute_escalated/workflow_dispute_created
-- -- which is exactly where it's a trust-critical gap: users get no push/email
-- when a dispute is opened, resolved, or escalated on their bounty.)
--
-- Fix, mirroring the established `enqueuePushEmailFanout`/
-- `enqueueVerificationNotification` pattern (webhooks/index.ts,
-- identity-webhooks/index.ts): keep the direct `notifications` insert (fast,
-- synchronous in-app bell -- unchanged), and ALSO enqueue a companion
-- notifications_outbox row with `data.skipInApp = true` so
-- drain-notifications-outbox (pg_cron, every minute) hands it to
-- process-notification for push + email + preference + quiet-hours handling,
-- without creating a second, duplicate bell row.
--
-- Best-effort: if the outbox insert fails for any reason, the RPC must not
-- fail the caller -- the in-app notification (this function's original,
-- load-bearing behavior) must still succeed. Wrapped in a nested
-- BEGIN/EXCEPTION block for that reason.

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

  v_category := CASE
    WHEN p_type IN ('dispute_created','dispute_resolved','dispute_escalated',
                     'workflow_dispute_created','account_warning','account_restricted') THEN 'security'
    WHEN p_type IN ('verification_submitted','verification_verified',
                     'verification_rejected','verification_canceled') THEN 'verification'
  END;

  INSERT INTO public.notifications (user_id, type, category, title, body, data, read)
  VALUES (p_user_id, p_type, v_category, p_title, p_body, p_data, false);

  BEGIN
    INSERT INTO public.notifications_outbox (recipients, title, body, data, status)
    VALUES (
      jsonb_build_array(p_user_id),
      p_title,
      p_body,
      COALESCE(p_data, '{}'::jsonb) || jsonb_build_object('type', p_type, 'skipInApp', true),
      'pending'
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'send_system_notification: notifications_outbox enqueue failed (non-fatal) for user %, type %: %',
      p_user_id, p_type, SQLERRM;
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.send_system_notification(UUID, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.send_system_notification(UUID, TEXT, TEXT, TEXT, JSONB) TO authenticated;

COMMIT;
