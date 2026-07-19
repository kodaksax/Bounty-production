-- Migration: EMERGENCY STOP-GAP — restore table-level SELECT on profiles
-- Created: 2026-07-19
--
-- INCIDENT: 20260719051832_revoke_sensitive_profile_columns_select.sql revoked
-- table-level SELECT on public.profiles for authenticated/anon, replacing it
-- with a column-level grant (excludes balance/stripe_*/risk_*/email/phone).
-- This was only safe once every client's self-read path used get_my_profile()
-- (a SECURITY DEFINER RPC unaffected by the REVOKE) instead of a direct
-- `.select('*').eq('id', <self>)`. The client-side migration to that RPC
-- (commit bc91e6ae, lib/services/auth-profile-service.ts) was committed to
-- git on 2026-07-18 but was NEVER SHIPPED as an EAS Update/app-store build —
-- confirmed via live API logs showing currently-installed clients still
-- issuing `GET /rest/v1/profiles?select=*&id=eq.<self>` and getting 403.
--
-- Effect on real users: every installed app instance that hasn't received
-- the OTA update gets a 403 on its own profile read. auth-profile-service.ts's
-- error handling treats that failure the same as "no profile row exists yet",
-- which (a) resets already-onboarded users back into the username step
-- (app/onboarding/index.tsx's skip-if-username-set guard never fires because
-- profile comes back null) and (b) makes app/profile/[userId].tsx render
-- "Profile not found" for the user's own profile.
--
-- This migration restores the pre-REVOKE table-level SELECT grant so old
-- clients work again immediately. It does NOT drop the column-level grant
-- added by 20260719051832 (harmless to leave — a table-level grant already
-- satisfies the privilege check for every column, per that migration's own
-- comment on how column-level REVOKE interacts with table-level GRANT).
--
-- THIS IS TEMPORARY. Once the EAS Update carrying bc91e6ae is confirmed
-- rolled out to (effectively) all active clients, re-run the equivalent of
-- 20260719051832 (`REVOKE SELECT ON public.profiles FROM authenticated, anon;`)
-- to re-close the cross-user balance/email/phone/Stripe-ID read gap that
-- migration existed to fix. Do not consider this migration a resolution of
-- that finding — only a rollback of its premature production rollout.

GRANT SELECT ON public.profiles TO authenticated, anon;

NOTIFY pgrst, 'reload schema';
