-- Migration: Column-level SELECT REVOKE on sensitive profiles columns
-- Created: 2026-07-19
--
-- Step 5 of docs/withdrawals/08-profiles-rls-migration-strategy.md, deliberately
-- withheld until now. Steps 1-4 (public_profiles view, admin-profiles edge
-- function, safe-column client-side selects) are done. The remaining blocker
-- documented across two sessions -- self-read paths (fetchAndSyncProfile,
-- fetchFreshProfileInBackground, createMinimalProfile, updateProfile in
-- lib/services/auth-profile-service.ts) needing a REVOKE-proof route --
-- is now fixed: they all go through get_my_profile()
-- (20260719004500_add_get_my_profile_rpc.sql), a SECURITY DEFINER RPC
-- hard-scoped to auth.uid(), which is unaffected by this REVOKE.
--
-- NOTE: this migration MUST be applied together with (after)
-- 20260719020000_restore_fn_close_dispute_hold_security_definer.sql --
-- that migration fixes the one verified consumer (fn_close_dispute_hold)
-- that would otherwise break: it is SECURITY INVOKER on production (despite
-- git tracking SECURITY DEFINER -- untracked drift, see that migration's
-- comment) and does `UPDATE profiles SET balance_on_hold = balance_on_hold - x`
-- / `SET balance = balance - x`, a read-modify-write that needs SELECT on
-- those two columns for whichever role executes it. Under SECURITY INVOKER
-- that's the calling `authenticated` role (it's called directly from
-- lib/services/dispute-service.ts by admins) -- applying this REVOKE first
-- would break admin dispute resolution in production.
--
-- Mechanism: Postgres column-level REVOKE cannot narrow an existing
-- TABLE-level GRANT (a table-wide `GRANT SELECT ON profiles TO authenticated`
-- satisfies the privilege check for every column regardless of any
-- column-level REVOKE run afterward). The only way to truly restrict specific
-- columns is to revoke the table-level grant entirely and re-grant SELECT on
-- an explicit allow-list of the remaining (safe) columns. This is verified
-- against a live query: `authenticated` and `anon` both currently hold
-- unqualified table-level SELECT via information_schema.role_table_grants.
--
-- Columns withheld from the re-grant (10, exactly matching the consumer
-- catalog already researched in 08-profiles-rls-migration-strategy.md --
-- money, Stripe account identifiers, fraud/risk signals, and PII):
--   balance, balance_on_hold, balance_frozen, stripe_connect_account_id,
--   stripe_customer_id, stripe_connect_requirements, risk_level, risk_score,
--   email, phone
--
-- Every other current profiles column is re-granted at the column level so
-- this is NOT a behavior change for any already-verified consumer -- it only
-- closes the specific gap the audit found (any authenticated user could read
-- any other user's balance/email/phone/Stripe IDs/risk score directly).
--
-- `anon` is revoked with no re-grant: RLS already blocks anon from reading
-- profiles at all (profiles_select_authenticated is scoped `TO authenticated`
-- only, and RLS default-denies when enabled with no matching policy for a
-- role), so this is a no-op in practice and pure defense-in-depth.
--
-- ROLLBACK: if a missed consumer surfaces, the immediate fix is
--   GRANT SELECT (<missing column>) ON public.profiles TO authenticated;
-- -- no data changes here, so this migration itself carries no data risk.

REVOKE SELECT ON public.profiles FROM authenticated, anon;

GRANT SELECT (
  id,
  username,
  display_name,
  avatar,
  location,
  about,
  title,
  role,
  primary_role,
  business_category,
  zip_code,
  skills,
  skill_categories,
  e2e_public_key,
  verification_status,
  verified,
  age_verified,
  age_verified_at,
  onboarding_completed,
  onboarding_version,
  profile_completeness,
  reputation_score,
  id_verification_status,
  id_submitted_at,
  id_reviewed_at,
  id_reviewer_id,
  kyc_verified_at,
  selfie_submitted_at,
  phone_verified,
  phone_verified_at,
  account_restricted,
  account_status,
  restriction_reason,
  restricted_at,
  disabled_reason,
  charges_enabled,
  payouts_enabled,
  details_submitted,
  stripe_connect_charges_enabled,
  stripe_connect_payouts_enabled,
  stripe_connect_onboarding_complete,
  stripe_connect_onboarded_at,
  payout_failed_at,
  payout_failure_code,
  withdrawal_count,
  last_withdrawal_at,
  cancellation_count,
  last_seen_at,
  last_session_at,
  deleted_at,
  full_name,
  created_at,
  updated_at
) ON public.profiles TO authenticated;

NOTIFY pgrst, 'reload schema';
