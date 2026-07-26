-- Migration: Add Stripe Identity verification columns to profiles
-- Created: 2026-07-25
--
-- BACKGROUND: Bounty's identity verification is being redesigned around
-- Stripe Identity (VerificationSession + native SDK) instead of the fully
-- manual doc-upload + admin-review flow (id_verification_status,
-- id_submitted_at, id_reviewed_at, id_reviewer_id, selfie_submitted_at --
-- see supabase/migrations/20260302_add_id_verification_columns.sql). This
-- migration adds the new Stripe-Identity-backed columns without touching or
-- dropping the legacy ones, which stay live as a dormant rollback path.
--
-- These are written exclusively by the new identity-create-session and
-- identity-webhooks edge functions (service_role). They must be added to
-- prevent_client_writes_to_protected_profile_columns() (below) so no client
-- can self-report a fake verified status, matching the existing pattern for
-- id_verification_status/age_verified/etc.
--
-- CROSS-USER READ PATH: as of 20260719060100_drop_redundant_permissive_profiles_select_authenticated_policy.sql,
-- authenticated users can only read their OWN profiles row directly (table-level
-- SELECT grant is broad, but RLS now restricts rows to auth.uid() = id).
-- Cross-user reads (badges shown on someone else's applicant card, message
-- header, review, etc.) go exclusively through public.public_profiles, a
-- curated safe-columns view that bypasses base-table RLS via view-owner
-- privilege. That view currently exposes `verification_status` (an unrelated
-- column from the risk-management system, 20251010_risk_management_system.sql,
-- NOT the same as id_verification_status and never synced with it) but does
-- NOT expose id_verification_status or anything else that reflects real ID
-- verification -- meaning cross-user verification badges have never actually
-- been able to see real verification state. This migration adds
-- stripe_identity_status and verified_since to that view so badges can finally
-- reflect reality (see lib/utils/normalize-profile.ts for the client-side fix
-- that consumes this).

BEGIN;

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS stripe_identity_session_id TEXT,
  ADD COLUMN IF NOT EXISTS stripe_identity_status TEXT DEFAULT 'unstarted'
    CHECK (stripe_identity_status IN ('unstarted','requires_input','processing','verified','canceled')),
  ADD COLUMN IF NOT EXISTS id_verification_rejection_reason TEXT,
  ADD COLUMN IF NOT EXISTS verified_since TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS stripe_identity_last_event_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_profiles_stripe_identity_status ON profiles(stripe_identity_status);

-- Backfill: users already verified under the legacy flow must not be forced
-- to redo Stripe Identity. verified_since anchors the new "Verified since
-- <date>" trust indicator; stripe_identity_status is set to a synthetic
-- 'verified' so lib/utils/verification-badges.ts's updated idEarned check
-- (stripe_identity_status === 'verified' || id_verification_status === 'verified')
-- awards the badge without a real VerificationSession ever existing for them.
UPDATE profiles
SET
  stripe_identity_status = 'verified',
  verified_since = COALESCE(verified_since, id_reviewed_at, id_submitted_at, now())
WHERE id_verification_status = 'verified'
  AND stripe_identity_status = 'unstarted';

-- Extend the write-protection trigger to cover the 5 new columns.
-- Re-creates the full function body (same pattern as every prior migration
-- that has extended this guard list) rather than a partial ALTER, since
-- Postgres has no "add one more condition to an existing function" primitive.
--
-- IMPORTANT: verified against the LIVE function body before writing this
-- (pg_get_functiondef) rather than trusting the git history alone --
-- 20260719120000_fix_profile_guard_blocks_trusted_writes.sql added an
-- `app.bypass_profile_guard` session-flag bypass in production that isn't
-- reflected by re-reading only the earlier 20260718005037 migration file.
-- Preserved below so this migration doesn't silently regress that fix.
CREATE OR REPLACE FUNCTION public.prevent_client_writes_to_protected_profile_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() = 'service_role'
     OR current_setting('app.bypass_profile_guard', true) = 'on'
  THEN
    RETURN NEW;
  END IF;

  IF NEW.balance IS DISTINCT FROM OLD.balance
     OR NEW.balance_on_hold IS DISTINCT FROM OLD.balance_on_hold
     OR NEW.balance_frozen IS DISTINCT FROM OLD.balance_frozen
     OR NEW.withdrawal_count IS DISTINCT FROM OLD.withdrawal_count
     OR NEW.last_withdrawal_at IS DISTINCT FROM OLD.last_withdrawal_at
     OR NEW.cancellation_count IS DISTINCT FROM OLD.cancellation_count
     OR NEW.payout_failed_at IS DISTINCT FROM OLD.payout_failed_at
     OR NEW.payout_failure_code IS DISTINCT FROM OLD.payout_failure_code
     OR NEW.stripe_connect_account_id IS DISTINCT FROM OLD.stripe_connect_account_id
     OR NEW.stripe_customer_id IS DISTINCT FROM OLD.stripe_customer_id
     OR NEW.stripe_connect_onboarded_at IS DISTINCT FROM OLD.stripe_connect_onboarded_at
     OR NEW.stripe_connect_charges_enabled IS DISTINCT FROM OLD.stripe_connect_charges_enabled
     OR NEW.stripe_connect_payouts_enabled IS DISTINCT FROM OLD.stripe_connect_payouts_enabled
     OR NEW.stripe_connect_requirements IS DISTINCT FROM OLD.stripe_connect_requirements
     OR NEW.stripe_connect_onboarding_complete IS DISTINCT FROM OLD.stripe_connect_onboarding_complete
     OR NEW.charges_enabled IS DISTINCT FROM OLD.charges_enabled
     OR NEW.payouts_enabled IS DISTINCT FROM OLD.payouts_enabled
     OR NEW.details_submitted IS DISTINCT FROM OLD.details_submitted
     OR NEW.disabled_reason IS DISTINCT FROM OLD.disabled_reason
     OR NEW.risk_level IS DISTINCT FROM OLD.risk_level
     OR NEW.risk_score IS DISTINCT FROM OLD.risk_score
     OR NEW.account_restricted IS DISTINCT FROM OLD.account_restricted
     OR NEW.restriction_reason IS DISTINCT FROM OLD.restriction_reason
     OR NEW.restricted_at IS DISTINCT FROM OLD.restricted_at
     OR NEW.verification_status IS DISTINCT FROM OLD.verification_status
     OR NEW.kyc_verified_at IS DISTINCT FROM OLD.kyc_verified_at
     OR NEW.id_verification_status IS DISTINCT FROM OLD.id_verification_status
     OR NEW.id_submitted_at IS DISTINCT FROM OLD.id_submitted_at
     OR NEW.id_reviewed_at IS DISTINCT FROM OLD.id_reviewed_at
     OR NEW.id_reviewer_id IS DISTINCT FROM OLD.id_reviewer_id
     OR NEW.age_verified IS DISTINCT FROM OLD.age_verified
     OR NEW.age_verified_at IS DISTINCT FROM OLD.age_verified_at
     OR NEW.phone_verified IS DISTINCT FROM OLD.phone_verified
     OR NEW.phone_verified_at IS DISTINCT FROM OLD.phone_verified_at
     OR NEW.selfie_submitted_at IS DISTINCT FROM OLD.selfie_submitted_at
     OR NEW.verified IS DISTINCT FROM OLD.verified
     OR NEW.role IS DISTINCT FROM OLD.role
     OR NEW.stripe_identity_session_id IS DISTINCT FROM OLD.stripe_identity_session_id
     OR NEW.stripe_identity_status IS DISTINCT FROM OLD.stripe_identity_status
     OR NEW.id_verification_rejection_reason IS DISTINCT FROM OLD.id_verification_rejection_reason
     OR NEW.verified_since IS DISTINCT FROM OLD.verified_since
     OR NEW.stripe_identity_last_event_at IS DISTINCT FROM OLD.stripe_identity_last_event_at
  THEN
    RAISE EXCEPTION 'Direct client writes to financial, risk, verification, or Stripe Connect profile fields are not permitted. These are managed exclusively by server-side functions.'
      USING ERRCODE = '42501'; -- insufficient_privilege
  END IF;

  RETURN NEW;
END;
$$;

-- Extend the curated cross-user view so verification badges shown on OTHER
-- users' cards/messages/reviews can finally reflect real Stripe-Identity
-- status instead of the unrelated risk-management verification_status column.
-- security_invoker deliberately NOT set -- see 20260718235500_formalize_public_profiles_view.sql.
CREATE OR REPLACE VIEW public.public_profiles AS
SELECT
  id,
  username,
  display_name,
  avatar,
  location,
  about,
  verification_status,
  created_at,
  e2e_public_key,
  stripe_identity_status,
  verified_since
FROM public.profiles;

GRANT SELECT ON public.public_profiles TO anon, authenticated;

COMMIT;
