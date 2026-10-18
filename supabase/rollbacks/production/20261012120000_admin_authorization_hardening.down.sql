-- Rollback for 20261012120000_admin_authorization_hardening.sql
-- Restores the production definitions captured on 2026-10-12.
--
-- Deliberately NOT restored: EXECUTE on record_reconciliation_finding for
-- authenticated and on increment_withdrawal_counter for anon. Nothing on the
-- client calls either (verified by grep), so re-granting would only reopen
-- the holes without restoring any functionality.

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_assert_role()
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin' THEN
    RAISE EXCEPTION 'admin role required' USING ERRCODE = '42501';
  END IF;
END;
$$;

DROP POLICY IF EXISTS "Admins can view all comments" ON public.dispute_comments;
CREATE POLICY "Admins can view all comments" ON public.dispute_comments
  FOR SELECT USING ((auth.jwt() ->> 'role') = 'admin');
DROP POLICY IF EXISTS "Admins can add any comments" ON public.dispute_comments;
CREATE POLICY "Admins can add any comments" ON public.dispute_comments
  FOR INSERT WITH CHECK ((user_id = auth.uid()) AND ((auth.jwt() ->> 'role') = 'admin'));
DROP POLICY IF EXISTS "Only admins can create resolutions" ON public.dispute_resolutions;
CREATE POLICY "Only admins can create resolutions" ON public.dispute_resolutions
  FOR INSERT WITH CHECK ((auth.jwt() ->> 'role') = 'admin');
DROP POLICY IF EXISTS "Admins can view all appeals" ON public.dispute_appeals;
CREATE POLICY "Admins can view all appeals" ON public.dispute_appeals
  FOR SELECT USING ((auth.jwt() ->> 'role') = 'admin');
DROP POLICY IF EXISTS "Admins can update appeals" ON public.dispute_appeals;
CREATE POLICY "Admins can update appeals" ON public.dispute_appeals
  FOR UPDATE USING ((auth.jwt() ->> 'role') = 'admin');

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'wallet_transactions', 'admin_action_log', 'payout_audit_log', 'bounty_requests',
    'completion_submissions', 'dispute_evidence', 'bounty_cancellations'
  ] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select_admin', t);
    END IF;
  END LOOP;
END;
$$;

DROP TRIGGER IF EXISTS trg_admin_action_log_append_only ON public.admin_action_log;
DROP TRIGGER IF EXISTS trg_admin_action_log_no_truncate ON public.admin_action_log;
DROP FUNCTION IF EXISTS public.fn_admin_action_log_append_only();

-- Fails if id_verification_review rows exist; delete-free by design, so in
-- that case leave the widened constraint in place.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_action_log WHERE action_type = 'id_verification_review') THEN
    ALTER TABLE public.admin_action_log DROP CONSTRAINT IF EXISTS admin_action_log_action_type_check;
    ALTER TABLE public.admin_action_log
      ADD CONSTRAINT admin_action_log_action_type_check CHECK (action_type = ANY (ARRAY[
        'force_retry_withdrawal', 'manual_balance_adjustment', 'mark_externally_settled_withdrawal',
        'reverse_stripe_transfer', 'run_stripe_balance_sync', 'acknowledge_reconciliation_finding',
        'account_status_change', 'role_change'
      ]::text[]));
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.send_system_notification(p_user_id uuid, p_type text, p_title text, p_body text, p_data jsonb DEFAULT NULL::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

DROP FUNCTION IF EXISTS public.is_admin();

COMMIT;
