-- Notification delivery: name the failure, and reach posters when push can't.
--
-- Context (2026-09-25): poster-facing notifications failed 58-61% of the time.
-- Every Android push was rejected by Expo (no FCM credentials on the Expo
-- project) and some posters had no token at all, but notification_failed only
-- said `push_send_error` / `no_deliverable_token` and the outbox row said
-- nothing. process-notification now:
--   * writes each recipient's provider error (Expo/APNs/FCM code + message)
--     to notifications_outbox.delivery_errors, and
--   * sends at most ONE fallback email per application (bounty_request) when
--     an `application` / `application_pending_reminder` push can't reach the
--     poster. notification_email_fallbacks is the dedupe ledger: the edge
--     function claims a row before sending and deletes it if the send fails.
--
-- Additive only (one nullable column, one new table); no backfill, no rewrite
-- of existing rows.
--
-- DONE MEANS OBSERVED:
--   * notifications_outbox.delivery_errors non-null on failing rows, and
--   * rows in notification_email_fallbacks, and
--   * PostHog notification_sent with notification_delivered_via = 'email'.
--
-- Rollback:
--   DROP TABLE IF EXISTS public.notification_email_fallbacks;
--   ALTER TABLE public.notifications_outbox DROP COLUMN IF EXISTS delivery_errors;
-- (Roll back the edge function first; the deployed function writes both.)

ALTER TABLE public.notifications_outbox
  ADD COLUMN IF NOT EXISTS delivery_errors jsonb;

COMMENT ON COLUMN public.notifications_outbox.delivery_errors IS
  'Per-recipient delivery failures from process-notification: [{user_id, channel, reason, code, message}]. code/message are the provider''s (Expo ticket details.error / message, http_<status>, or exception). NULL = no failures.';

CREATE TABLE IF NOT EXISTS public.notification_email_fallbacks (
  -- 'request:<bounty_request id>' (one email per application), or
  -- 'outbox:<outbox id>' when the payload carries no request id.
  dedupe_key          text PRIMARY KEY,
  user_id             uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  notification_type   text NOT NULL,
  outbox_id           uuid,
  bounty_id           uuid,
  -- Why push didn't reach them: push_send_error | no_deliverable_token |
  -- invalid_token_format | push_disabled.
  push_failure_reason text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.notification_email_fallbacks IS
  'One row per poster fallback email actually sent by process-notification (claimed before send, deleted if the send fails). Service-role only.';

CREATE INDEX IF NOT EXISTS notification_email_fallbacks_user_created_idx
  ON public.notification_email_fallbacks (user_id, created_at DESC);

-- Service-role only: RLS on with no policies, and explicit revokes (anon gets
-- auto-granted privileges on new tables; REVOKE FROM PUBLIC does not cover it).
ALTER TABLE public.notification_email_fallbacks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_email_fallbacks FROM PUBLIC;
REVOKE ALL ON public.notification_email_fallbacks FROM anon;
REVOKE ALL ON public.notification_email_fallbacks FROM authenticated;
