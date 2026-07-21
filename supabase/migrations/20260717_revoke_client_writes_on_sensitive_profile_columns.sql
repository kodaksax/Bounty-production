-- Migration: Block client writes to sensitive profiles columns
-- Created: 2026-07-17
-- Purpose:
--   The RLS UPDATE policies on public.profiles (`Users can update own profile`,
--   `allow_profiles_update_self`, `profiles_update_own`) only check
--   `auth.uid() = id` with no column-level restriction. Postgres checks
--   table/column privileges BEFORE evaluating RLS, and this table has a
--   pre-existing table-wide `GRANT UPDATE ON profiles TO anon, authenticated`,
--   so any authenticated user could previously call
--   `supabase.from('profiles').update({ balance: 999999 }).eq('id', self)`
--   directly from the client SDK, completely bypassing withdraw_balance()'s
--   validation. That inflated balance would then authorize a genuine Stripe
--   transfer via the legitimate /connect/transfer route — a live
--   money-creation bug, not merely a data-integrity one.
--
--   A column-level REVOKE UPDATE was tried first and confirmed ineffective:
--   the table-wide GRANT UPDATE (all columns, is_grantable=NO, presumably
--   from Supabase's default `GRANT ALL ON ALL TABLES IN SCHEMA public`)
--   still permits the write regardless of a narrower column-level REVOKE.
--   Revoking the table-wide grant and re-granting only safe columns was
--   considered but rejected as higher-risk: it requires enumerating every
--   column the mobile client is allowed to write, and any column missed
--   silently breaks a legitimate profile-edit feature instead of failing
--   loudly. A BEFORE UPDATE trigger is safer: it fails closed only for the
--   explicitly listed sensitive columns and leaves every other column (and
--   the table-wide grant) untouched, so nothing else can regress.
--
--   Verified before writing this migration: grepped the mobile client for
--   every direct `supabase.from('profiles').update(...)` call and every
--   `updateProfile(...)` call site — none write any of the columns guarded
--   below. Only display/profile fields (username, avatar, about, phone,
--   title, skills, display_name, onboarding_completed) are client-written.
--   All legitimate writes to the guarded columns already go through
--   service-role edge functions or SECURITY DEFINER RPCs (withdraw_balance,
--   update_balance, syncConnectAccountToProfile, etc.), which connect as
--   the `service_role` Postgres role and are exempted below.

CREATE OR REPLACE FUNCTION public.prevent_client_writes_to_protected_profile_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- service_role is used exclusively by edge functions and SECURITY DEFINER
  -- RPCs; auth.role() reflects the JWT/key used for the current request.
  IF auth.role() = 'service_role' THEN
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
  THEN
    RAISE EXCEPTION 'Direct client writes to financial, risk, verification, or Stripe Connect profile fields are not permitted. These are managed exclusively by server-side functions.'
      USING ERRCODE = '42501'; -- insufficient_privilege
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.prevent_client_writes_to_protected_profile_columns() IS
  'Blocks anon/authenticated writes to financial, risk, verification, and Stripe Connect columns on profiles, regardless of RLS or table-level grants. service_role (edge functions, SECURITY DEFINER RPCs) is exempt.';

DROP TRIGGER IF EXISTS trg_prevent_client_writes_to_protected_profile_columns ON public.profiles;
CREATE TRIGGER trg_prevent_client_writes_to_protected_profile_columns
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_client_writes_to_protected_profile_columns();
