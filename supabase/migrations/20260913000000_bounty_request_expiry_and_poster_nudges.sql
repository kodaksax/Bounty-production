-- =====================================================================
-- Bounty request expiry + poster nudges.
--
-- Problem (measured 2026-09-12): of 104 external hunter requests in the last
-- 30 days, 85.6% were never answered at all (both accepted_at and rejected_at
-- NULL). The goal here is not to raise the acceptance rate -- it's to stop
-- producing silence. A poster who never decides now gets nudged twice, and if
-- they still never decide, the request auto-closes as a "closed loop", not a
-- rejection.
--
-- Safety property: `posting_policy_config.request_lifecycle_enabled_at`
-- defaults to now() at apply time. Both jobs below filter
-- `created_at >= request_lifecycle_enabled_at`, so every bounty_request that
-- already exists at migration time is permanently excluded from both nudges
-- and expiry. This is what makes it safe to schedule the cron jobs in this
-- same migration -- there is nothing for them to touch yet, and the 89
-- historically-ignored requests stay untouched as the pre-period baseline.
-- =====================================================================

BEGIN;

-- ─── posting_policy_config: expiry window + enablement watermark ──────────
ALTER TABLE public.posting_policy_config
  ADD COLUMN IF NOT EXISTS request_expiry_hours integer NOT NULL DEFAULT 72,
  ADD COLUMN IF NOT EXISTS request_lifecycle_enabled_at timestamptz NOT NULL DEFAULT now();

COMMENT ON COLUMN public.posting_policy_config.request_expiry_hours IS
  'Hours a bounty_requests row can sit at status=pending with no poster decision and no poster_interacted_at before fn_expire_bounty_requests auto-closes it. Default 72h -- median time-to-accept when a poster does decide is ~10 minutes, so this only catches genuine silence.';

COMMENT ON COLUMN public.posting_policy_config.request_lifecycle_enabled_at IS
  'Watermark set once, at the migration that introduced request expiry/nudges. fn_remind_posters_of_pending_requests and fn_expire_bounty_requests both filter bounty_requests.created_at >= this value, so pre-existing pending requests are never retroactively nudged or expired -- they remain the pre-period baseline for measuring this change.';

-- ─── bounty_requests: new columns ──────────────────────────────────────────
ALTER TABLE public.bounty_requests
  ADD COLUMN IF NOT EXISTS rejection_source text,
  ADD COLUMN IF NOT EXISTS poster_interacted_at timestamptz,
  ADD COLUMN IF NOT EXISTS reminder_stage smallint NOT NULL DEFAULT 0;

ALTER TABLE public.bounty_requests
  DROP CONSTRAINT IF EXISTS bounty_requests_rejection_source_check;
ALTER TABLE public.bounty_requests
  ADD CONSTRAINT bounty_requests_rejection_source_check
  CHECK (rejection_source IS NULL OR rejection_source IN ('poster', 'system_expiry'));

COMMENT ON COLUMN public.bounty_requests.rejection_source IS
  'Who/what moved this row to rejected. ''poster'' = a human decision (default, stamped by trg_bounty_requests_stamp_decision for any writer that does not set it explicitly). ''system_expiry'' = fn_expire_bounty_requests auto-closed it after request_expiry_hours of silence. NULL on rows rejected before this column existed.';

COMMENT ON COLUMN public.bounty_requests.poster_interacted_at IS
  'Set the first time the poster does anything with this specific application before deciding on it: opens/asks a question (useAskApplicant -> applicant_question_opened) or sends the hunter a message. Once set, fn_expire_bounty_requests will never auto-close this row -- an engaged poster is never treated as silent.';

COMMENT ON COLUMN public.bounty_requests.reminder_stage IS
  '0 = no pending-application nudge sent to poster yet. 1 = 1h nudge sent. 2 = 24h nudge sent. Caps at 2; set by fn_remind_posters_of_pending_requests.';

-- ─── Extend the existing decision-stamp trigger for rejection_source ───────
-- Same trigger as B-06 (20260909000100_conversation_participant_integrity_
-- and_request_timestamps.sql), extended rather than duplicated so every
-- existing writer of status='rejected' (client, admin client, edge function)
-- gets rejection_source defaulted to 'poster' with no code changes on their
-- part. Only fn_expire_bounty_requests sets rejection_source explicitly
-- ('system_expiry') as part of the same UPDATE, so this default never
-- overwrites it.
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
    ELSIF NEW.status::text = 'rejected' THEN
      IF NEW.rejected_at IS NULL THEN
        NEW.rejected_at := now();
      END IF;
      IF NEW.rejection_source IS NULL THEN
        NEW.rejection_source := 'poster';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ─── New trigger: stamp poster_interacted_at when poster messages hunter ──
-- Covers the "messaged" half of the do-not-expire guard (the "opened" /
-- "asked a question" half is stamped client-side from useAskApplicant, which
-- already has the exact requestId). Scoped via conversations.bounty_id +
-- conversation_participants rather than trusting message content. Wrapped in
-- its own exception handler so a lookup failure can never block sending a
-- message.
CREATE OR REPLACE FUNCTION public.fn_stamp_poster_interaction_on_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog', 'pg_temp'
AS $$
DECLARE
  v_bounty_id uuid;
BEGIN
  SELECT bounty_id INTO v_bounty_id FROM public.conversations WHERE id = NEW.conversation_id;
  IF v_bounty_id IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE public.bounty_requests br
  SET poster_interacted_at = now()
  WHERE br.bounty_id = v_bounty_id
    AND br.poster_id = NEW.sender_id
    AND br.status = 'pending'
    AND br.poster_interacted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM public.conversation_participants cp
      WHERE cp.conversation_id = NEW.conversation_id AND cp.user_id = br.hunter_id
    );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'fn_stamp_poster_interaction_on_message failed for message %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_stamp_poster_interaction_on_message() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_stamp_poster_interaction_on_message() FROM anon;

DROP TRIGGER IF EXISTS trg_messages_stamp_poster_interaction ON public.messages;
CREATE TRIGGER trg_messages_stamp_poster_interaction
  AFTER INSERT ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_stamp_poster_interaction_on_message();

-- ─── RPC: stamp poster_interacted_at for the "opened / asked a question" half
-- ────────────────────────────────────────────────────────────────────────────
-- Counterpart to the message trigger above, called from useAskApplicant. Uses
-- the database's now() rather than a client-supplied timestamp so a skewed
-- device clock can never move the expiry watermark -- either by dodging
-- fn_expire_bounty_requests's do-not-expire guard early (clock set ahead) or
-- by failing to register the interaction in time (clock set behind).
-- SECURITY INVOKER + the poster_id = auth.uid() check means a poster can only
-- stamp their own pending requests; RLS on bounty_requests still applies.
CREATE OR REPLACE FUNCTION public.fn_mark_poster_interacted(p_request_id uuid)
RETURNS void
LANGUAGE sql
SECURITY INVOKER
SET search_path TO 'public', 'pg_catalog', 'pg_temp'
AS $$
  UPDATE public.bounty_requests
  SET poster_interacted_at = now()
  WHERE id = p_request_id
    AND poster_id = auth.uid()
    AND poster_interacted_at IS NULL;
$$;

REVOKE ALL ON FUNCTION public.fn_mark_poster_interacted(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_mark_poster_interacted(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_mark_poster_interacted(uuid) TO authenticated;

-- ─── notifications type check: two new poster/hunter-facing types ─────────
ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check CHECK (
    type = ANY (ARRAY[
      'application', 'acceptance', 'completion', 'payment', 'message', 'follow',
      'cancellation_request', 'cancellation_accepted', 'cancellation_rejected',
      'dispute_created', 'dispute_resolved', 'workflow_dispute_created',
      'stale_bounty', 'stale_bounty_cancelled', 'stale_bounty_reposted',
      'update', 'review_needed', 'balance_update', 'bounty_nearby',
      'bounty_expiry', 'dispute_escalated', 'account_warning',
      'account_restricted', 'payout_paid', 'payout_failed', 'payout_canceled',
      'withdrawal_reversed', 'bank_disconnected', 'payout_method_changed',
      'verification_submitted', 'verification_verified', 'verification_rejected',
      'verification_canceled', 'marketing_promo',
      'reconciliation_alert', 'reconciliation_digest',
      'bounty_quality_nudge',
      -- Request expiry + poster nudges (this migration).
      'application_pending_reminder', 'application_expired'
    ]::text[])
  );

-- ─── Poster nudges at 1h / 24h ─────────────────────────────────────────────
-- One notification type, two stages (data.stage), mirroring
-- fn_bounty_quality_score_and_nudge's stage convention. Includes requestId in
-- the outbox payload so the notification renders with Accept/Decline actions
-- in NotificationActionSheet (category 'marketplace' + data.requestId already
-- triggers that UI) -- a nudge that lets the poster resolve it in one tap.
CREATE OR REPLACE FUNCTION public.fn_remind_posters_of_pending_requests()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_enabled_at timestamptz;
  r record;
BEGIN
  -- posting_policy_config is a singleton enforced by its id boolean PK
  -- (id = true, see 20260909000000_gate_honor_posts_and_minimum_amount.sql);
  -- select by that known key rather than LIMIT 1 so the row choice can never
  -- become ambiguous if the singleton invariant is ever violated.
  SELECT request_lifecycle_enabled_at INTO v_enabled_at FROM public.posting_policy_config WHERE id = true;
  v_enabled_at := COALESCE(v_enabled_at, now());

  FOR r IN
    SELECT br.id AS request_id, br.bounty_id, br.hunter_id, br.poster_id, br.reminder_stage,
           b.title AS bounty_title, p.username AS hunter_username
    FROM public.bounty_requests br
    JOIN public.bounties b ON b.id = br.bounty_id
    LEFT JOIN public.profiles p ON p.id = br.hunter_id
    WHERE br.status = 'pending'
      AND br.accepted_at IS NULL
      AND br.rejected_at IS NULL
      AND b.status = 'open'
      AND br.created_at >= v_enabled_at
      AND (
        (br.reminder_stage = 0 AND br.created_at < now() - interval '1 hour')
        OR
        (br.reminder_stage = 1 AND br.created_at < now() - interval '24 hours')
      )
  LOOP
    BEGIN
      IF r.reminder_stage = 0 THEN
        INSERT INTO public.notifications_outbox (recipients, title, body, data, bounty_id)
        VALUES (
          jsonb_build_array(r.poster_id),
          'You have an application waiting',
          COALESCE(r.hunter_username, 'A hunter') || ' applied to "' || r.bounty_title || '" an hour ago. Take a look before they move on to another job.',
          jsonb_build_object('type', 'application_pending_reminder', 'bountyId', r.bounty_id, 'requestId', r.request_id, 'hunterId', r.hunter_id, 'stage', 1),
          r.bounty_id::text
        );
        UPDATE public.bounty_requests SET reminder_stage = 1 WHERE id = r.request_id;
      ELSE
        INSERT INTO public.notifications_outbox (recipients, title, body, data, bounty_id)
        VALUES (
          jsonb_build_array(r.poster_id),
          'Still waiting on your response',
          '"' || r.bounty_title || '" has had an open application for a day. Accept or decline soon -- unanswered requests close automatically.',
          jsonb_build_object('type', 'application_pending_reminder', 'bountyId', r.bounty_id, 'requestId', r.request_id, 'hunterId', r.hunter_id, 'stage', 2),
          r.bounty_id::text
        );
        UPDATE public.bounty_requests SET reminder_stage = 2 WHERE id = r.request_id;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'fn_remind_posters_of_pending_requests: skipping request % after error: %', r.request_id, SQLERRM;
    END;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_remind_posters_of_pending_requests() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_remind_posters_of_pending_requests() FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_remind_posters_of_pending_requests() TO service_role;

-- ─── Expiry ────────────────────────────────────────────────────────────────
-- Does the state transition AND the hunter-facing "closed loop" notification
-- in one transaction (both are pure SQL writes). Returns the expired rows so
-- the caller (the expire-bounty-requests edge function) can fire the
-- `application_expired` PostHog event per row -- that's the one thing this
-- function can't do itself without an HTTP call. p_dry_run lets the impact be
-- checked with no writes before the cron schedule below is trusted.
CREATE OR REPLACE FUNCTION public.fn_expire_bounty_requests(p_dry_run boolean DEFAULT false)
RETURNS TABLE(request_id uuid, bounty_id uuid, hunter_id uuid, poster_id uuid, hours_open numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expiry_hours integer;
  v_enabled_at timestamptz;
BEGIN
  -- Singleton row selected by its known key (id = true), not LIMIT 1 --
  -- see the matching comment in fn_remind_posters_of_pending_requests.
  SELECT request_expiry_hours, request_lifecycle_enabled_at
    INTO v_expiry_hours, v_enabled_at
  FROM public.posting_policy_config WHERE id = true;

  v_expiry_hours := COALESCE(v_expiry_hours, 72);
  v_enabled_at := COALESCE(v_enabled_at, now());

  IF p_dry_run THEN
    RETURN QUERY
    SELECT br.id, br.bounty_id, br.hunter_id, br.poster_id,
           round(EXTRACT(epoch FROM (now() - br.created_at)) / 3600.0, 1)
    FROM public.bounty_requests br
    JOIN public.bounties b ON b.id = br.bounty_id
    WHERE br.status = 'pending'
      AND br.accepted_at IS NULL
      AND br.rejected_at IS NULL
      AND br.poster_interacted_at IS NULL
      AND b.status = 'open'
      AND br.created_at >= v_enabled_at
      AND br.created_at < now() - (v_expiry_hours || ' hours')::interval;
    RETURN;
  END IF;

  RETURN QUERY
  WITH expired AS (
    UPDATE public.bounty_requests br
    SET status = 'rejected', rejection_source = 'system_expiry'
    FROM public.bounties b
    WHERE br.bounty_id = b.id
      AND br.status = 'pending'
      AND br.accepted_at IS NULL
      AND br.rejected_at IS NULL
      AND br.poster_interacted_at IS NULL
      AND b.status = 'open'
      AND br.created_at >= v_enabled_at
      AND br.created_at < now() - (v_expiry_hours || ' hours')::interval
    RETURNING br.id, br.bounty_id, br.hunter_id, br.poster_id, br.created_at
  ),
  notified AS (
    INSERT INTO public.notifications_outbox (recipients, title, body, data, bounty_id)
    SELECT
      jsonb_build_array(e.hunter_id),
      'Application closed',
      'The poster didn''t respond in time, so this application closed automatically -- this wasn''t a rejection. Feel free to apply to other bounties nearby.',
      jsonb_build_object('type', 'application_expired', 'bountyId', e.bounty_id, 'applicationId', e.id),
      e.bounty_id::text
    FROM expired e
    WHERE e.hunter_id IS NOT NULL
    RETURNING 1
  )
  SELECT e.id, e.bounty_id, e.hunter_id, e.poster_id,
         round(EXTRACT(epoch FROM (now() - e.created_at)) / 3600.0, 1)
  FROM expired e;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_expire_bounty_requests(boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_expire_bounty_requests(boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_expire_bounty_requests(boolean) TO service_role;

-- ─── Schedule ───────────────────────────────────────────────────────────────
-- Safe to schedule immediately: request_lifecycle_enabled_at defaults to
-- now() (set above, same statement batch) so no bounty_request that exists
-- before this migration is eligible for either job -- see file header.
--
-- Explicitly unscheduled by name first: pg_cron's cron.schedule() is not
-- guaranteed idempotent across versions when a job with the same name
-- already exists (reapplying this migration in dev/staging, or restoring
-- from a dump, could otherwise error or double-schedule). Deleting first
-- makes re-running this block always land on exactly one job per name.
DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'remind-posters-of-pending-requests';
EXCEPTION WHEN OTHERS THEN
  NULL; -- cron schema not present (e.g. local/dev without pg_cron) -- fall through to schedule below, which will then also no-op safely.
END $$;

SELECT cron.schedule(
  'remind-posters-of-pending-requests',
  '*/15 * * * *',
  $$SELECT public.fn_remind_posters_of_pending_requests();$$
);

DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'expire-stale-bounty-requests';
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- Dedicated secret (expire_bounty_requests_cron_secret), not
-- reconciliation_cron_secret: this authorizes only this one function, so
-- rotating or revoking it can never also affect the unrelated reconciliation
-- cron job. Must be set in Vault (supabase secrets set / dashboard) before
-- this job's first real run; until then the edge function returns 401 and
-- expires nothing, which is a safe no-op, not a silent failure mode.
SELECT cron.schedule(
  'expire-stale-bounty-requests',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'edge_function_base_url') || '/expire-bounty-requests',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || COALESCE((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'expire_bounty_requests_cron_secret'), '')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $$
);

COMMIT;
