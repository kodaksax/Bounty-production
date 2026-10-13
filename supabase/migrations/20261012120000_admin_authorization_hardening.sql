-- Admin authorization hardening (admin panel audit, 2026-10-12)
--
-- Every finding below was confirmed against production (xwlwqzzphmmhghiqvkeu)
-- with read-only queries before this file was written. See
-- docs/security/admin-panel-audit-2026-10-12.md for the evidence.
--
-- 1. Revocation lag. admin_assert_role() trusted the JWT claim alone, so an
--    admin whose role was revoked kept every admin_* RPC (including the
--    money-moving admin_approve_bounty_cancellation) until their access token
--    expired. public.is_admin() now requires the claim AND the live
--    auth.users record to agree, so a revocation takes effect on the next call.
--
-- 2. Dead admin policies. dispute_comments, dispute_resolutions and
--    dispute_appeals checked `auth.jwt() ->> 'role' = 'admin'`. The top-level
--    `role` claim is the Postgres role ('authenticated'), never 'admin', so
--    no admin could read internal dispute notes, post an admin comment, record
--    a resolution or see an appeal.
--
-- 3. Invisible records. The admin console reads these tables with the
--    end-user client, but none had an admin SELECT policy, so RLS returned
--    zero rows with no error and the screens rendered as empty:
--      wallet_transactions  (the only SELECT policy keys on sender_id /
--                            receiver_id, which are NULL on all 332 prod rows)
--      admin_action_log, payout_audit_log   (Audit Logs screen: always empty)
--      bounty_requests, completion_submissions, dispute_evidence,
--      bounty_cancellations                 (bounty + dispute investigation)
--    All policies added here are SELECT-only and admin-only.
--
-- 4. admin_action_log becomes append-only for everyone, service_role included.
--    No code path updates or deletes it (verified by grep), and it has no
--    foreign keys, so nothing cascades into it.
--
-- 5. Client-callable SECURITY DEFINER functions with no caller check:
--      send_system_notification  -- any signed-in user could push an arbitrary
--        "security" notification (e.g. type account_restricted, free-text
--        title/body) to any user id: a phishing channel that looks like Bounty
--        Trust & Safety. Signed-in non-admin callers are now limited to the
--        dispute notifications the app actually sends, only between parties
--        of a disputed bounty, with server-composed text.
--      record_reconciliation_finding -- any signed-in user could insert or
--        overwrite (details = EXCLUDED.details) open financial findings.
--        Only service_role and SECURITY DEFINER functions call it.
--      increment_withdrawal_counter  -- EXECUTE still granted to anon (REVOKE
--        FROM PUBLIC does not cover Supabase's explicit anon grant).
--
-- Rollback: supabase/rollbacks/production/20261012120000_admin_authorization_hardening.down.sql

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. is_admin() / admin_assert_role()
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin'
     AND EXISTS (
           SELECT 1
             FROM auth.users u
            WHERE u.id = auth.uid()
              AND COALESCE(u.raw_app_meta_data ->> 'role', '') = 'admin'
         );
$$;

COMMENT ON FUNCTION public.is_admin() IS
  'True only when the caller''s JWT carries app_metadata.role=admin AND the live auth.users row still does. Use in admin RLS policies as (SELECT public.is_admin()).';

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_admin() FROM anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_assert_role()
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'admin role required' USING ERRCODE = '42501';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Dispute admin policies that could never match
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Admins can view all comments" ON public.dispute_comments;
CREATE POLICY "Admins can view all comments" ON public.dispute_comments
  FOR SELECT TO authenticated
  USING ((SELECT public.is_admin()));

DROP POLICY IF EXISTS "Admins can add any comments" ON public.dispute_comments;
CREATE POLICY "Admins can add any comments" ON public.dispute_comments
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()) AND (SELECT public.is_admin()));

DROP POLICY IF EXISTS "Only admins can create resolutions" ON public.dispute_resolutions;
CREATE POLICY "Only admins can create resolutions" ON public.dispute_resolutions
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_admin()));

DROP POLICY IF EXISTS "Admins can view all appeals" ON public.dispute_appeals;
CREATE POLICY "Admins can view all appeals" ON public.dispute_appeals
  FOR SELECT TO authenticated
  USING ((SELECT public.is_admin()));

DROP POLICY IF EXISTS "Admins can update appeals" ON public.dispute_appeals;
CREATE POLICY "Admins can update appeals" ON public.dispute_appeals
  FOR UPDATE TO authenticated
  USING ((SELECT public.is_admin()))
  WITH CHECK ((SELECT public.is_admin()));

-- ---------------------------------------------------------------------------
-- 3. Admin read access to the records the console already queries
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'wallet_transactions',
    'admin_action_log',
    'payout_audit_log',
    'bounty_requests',
    'completion_submissions',
    'dispute_evidence',
    'bounty_cancellations'
  ] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'admin hardening: table public.% not present, skipping admin SELECT policy', t;
      CONTINUE;
    END IF;
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select_admin', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING ((SELECT public.is_admin()))',
      t || '_select_admin', t
    );
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. admin_action_log: append-only, and allow the ID-review audit type
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_admin_action_log_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  RAISE EXCEPTION 'admin_action_log is append-only (% blocked)', TG_OP
    USING ERRCODE = '42501';
END;
$$;

REVOKE ALL ON FUNCTION public.fn_admin_action_log_append_only() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_admin_action_log_append_only() FROM anon, authenticated;

DROP TRIGGER IF EXISTS trg_admin_action_log_append_only ON public.admin_action_log;
CREATE TRIGGER trg_admin_action_log_append_only
  BEFORE UPDATE OR DELETE ON public.admin_action_log
  FOR EACH ROW EXECUTE FUNCTION public.fn_admin_action_log_append_only();

DROP TRIGGER IF EXISTS trg_admin_action_log_no_truncate ON public.admin_action_log;
CREATE TRIGGER trg_admin_action_log_no_truncate
  BEFORE TRUNCATE ON public.admin_action_log
  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_admin_action_log_append_only();

-- Union of every value production already allows, plus id_verification_review
-- (admin-review-id now records each decision). Staging's copy of this
-- constraint is older and lacks role_change; re-adding the union fixes both.
ALTER TABLE public.admin_action_log
  DROP CONSTRAINT IF EXISTS admin_action_log_action_type_check;
ALTER TABLE public.admin_action_log
  ADD CONSTRAINT admin_action_log_action_type_check CHECK (action_type = ANY (ARRAY[
    'force_retry_withdrawal',
    'manual_balance_adjustment',
    'mark_externally_settled_withdrawal',
    'reverse_stripe_transfer',
    'run_stripe_balance_sync',
    'acknowledge_reconciliation_finding',
    'account_status_change',
    'role_change',
    'id_verification_review'
  ]::text[]));

-- ---------------------------------------------------------------------------
-- 5a. send_system_notification: caller-aware
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.send_system_notification(
  p_user_id uuid,
  p_type    text,
  p_title   text,
  p_body    text,
  p_data    jsonb DEFAULT NULL::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_category     text;
  v_uid          uuid := auth.uid();
  v_role         text := COALESCE(auth.role(), '');
  v_title        text := p_title;
  v_body         text := p_body;
  v_data         jsonb := p_data;
  v_bounty_id    uuid;
  v_bounty_title text;
  v_parties      uuid[];
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

  -- service_role, cron and other backend contexts (no end-user JWT) and
  -- verified admins keep the original behaviour. Everyone else is a
  -- signed-in end user calling over PostgREST.
  IF v_role IN ('authenticated', 'anon') AND NOT public.is_admin() THEN
    IF v_uid IS NULL THEN
      RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
    END IF;

    IF p_type NOT IN ('dispute_created', 'workflow_dispute_created', 'dispute_resolved') THEN
      RAISE EXCEPTION 'notification type % is reserved for Bounty staff', p_type
        USING ERRCODE = '42501';
    END IF;

    BEGIN
      v_bounty_id := NULLIF(p_data ->> 'bountyId', '')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      v_bounty_id := NULL;
    END;
    IF v_bounty_id IS NULL THEN
      RAISE EXCEPTION 'bountyId is required' USING ERRCODE = '42501';
    END IF;

    -- Both the sender and the recipient must be parties to a bounty that
    -- actually has a dispute: poster, accepted hunter, a dispute initiator or
    -- a cancellation requester.
    SELECT b.title,
           array_remove(
             ARRAY[b.poster_id, b.user_id, b.accepted_by]
             || COALESCE((SELECT array_agg(d.initiator_id) FROM public.bounty_disputes d WHERE d.bounty_id = b.id), '{}')
             || COALESCE((SELECT array_agg(c.requester_id) FROM public.bounty_cancellations c WHERE c.bounty_id = b.id), '{}'),
             NULL)
      INTO v_bounty_title, v_parties
      FROM public.bounties b
     WHERE b.id = v_bounty_id
       AND EXISTS (SELECT 1 FROM public.bounty_disputes d WHERE d.bounty_id = b.id);

    IF v_parties IS NULL OR NOT (v_uid = ANY (v_parties)) OR NOT (p_user_id = ANY (v_parties)) THEN
      RAISE EXCEPTION 'not a party to a disputed bounty' USING ERRCODE = '42501';
    END IF;

    -- Server-composed copy: a party can trigger the notification, never
    -- author it.
    v_bounty_title := left(COALESCE(v_bounty_title, 'your bounty'), 80);
    IF p_type = 'dispute_resolved' THEN
      v_title := 'Dispute closed';
      v_body  := format('A dispute on "%s" was closed.', v_bounty_title);
    ELSE
      v_title := 'Dispute opened';
      v_body  := format('A dispute was opened on "%s".', v_bounty_title);
    END IF;
    v_data := jsonb_strip_nulls(jsonb_build_object(
      'bountyId',       v_bounty_id,
      'disputeId',      p_data -> 'disputeId',
      'cancellationId', p_data -> 'cancellationId'
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

REVOKE ALL ON FUNCTION public.send_system_notification(uuid, text, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.send_system_notification(uuid, text, text, text, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.send_system_notification(uuid, text, text, text, jsonb) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5b. Backend-only functions that were still client-executable
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.record_reconciliation_finding(text, text, uuid, jsonb, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_reconciliation_finding(text, text, uuid, jsonb, boolean) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_reconciliation_finding(text, text, uuid, jsonb, boolean) TO service_role;

REVOKE ALL ON FUNCTION public.increment_withdrawal_counter(uuid, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.increment_withdrawal_counter(uuid, timestamptz) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_withdrawal_counter(uuid, timestamptz) TO service_role;

COMMIT;
