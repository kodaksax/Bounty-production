-- Ensure the `public_profiles` view exists and is readable across users, so the
-- bounty feed / search / detail can render poster username + avatar.
--
-- CONTEXT: On 2026-07-19 the broad `profiles_select_authenticated USING (true)`
-- RLS policy was dropped from `profiles` (see
-- 20260719060100_drop_redundant_permissive_profiles_select_authenticated_policy.sql).
-- After that, a caller can only read their OWN `profiles` row. The client feed
-- query used `profiles!bounties_poster_id_fkey!inner(...)`, so on production every
-- bounty posted by another user was silently filtered out -> empty feed.
--
-- The sanctioned cross-user read path is the curated `public_profiles` view
-- (see 20260718235500_formalize_public_profiles_view.sql). The client has now been
-- migrated to read poster fields from that view. This migration re-asserts the
-- view definition and its grants idempotently, so the client's dependency is
-- guaranteed in every environment where the RLS lockdown is applied -- NOT by
-- re-opening the base `profiles` table (which would undo the column hardening in
-- 20260719020500_revoke_sensitive_profile_columns_select.sql).
--
-- Deliberately does NOT set security_invoker = true: the view must serve any
-- authenticated/anon caller regardless of their own row-level RLS on profiles.
-- See docs/withdrawals/08-profiles-rls-migration-strategy.md.

create or replace view public.public_profiles as
select
  id,
  username,
  display_name,
  avatar,
  location,
  about,
  verification_status,
  created_at
from public.profiles;

comment on view public.public_profiles is
  'Curated safe-columns view of profiles for cross-user reads (bounty feed/search/detail poster display, profile pages, search). Intentionally bypasses base-table RLS via view-owner privilege (owner postgres, security_invoker NOT set) so it can serve any caller regardless of the caller''s own row -- do not "fix" this per the security advisor''s generic security_invoker=true suggestion, see docs/withdrawals/08-profiles-rls-migration-strategy.md.';

grant select on public.public_profiles to anon, authenticated;
