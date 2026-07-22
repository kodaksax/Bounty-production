-- Adds `e2e_public_key` to the `public_profiles` view.
--
-- Background: 20260719060100_drop_redundant_permissive_profiles_select_authenticated_policy.sql
-- dropped the last permissive cross-user SELECT policy on `public.profiles`,
-- leaving only the self-only policies (`auth.uid() = id`). That migration's
-- premise -- "cross-user reads for display purposes go through
-- public.public_profiles" -- was only true for the call sites migrated in
-- step 4 of docs/withdrawals/08-profiles-rls-migration-strategy.md. Several
-- others were still querying the base table and silently started returning
-- zero rows (bounty-feed poster enrichment, messenger participant names,
-- user search, bounty-request hunter lists, and this: E2E key lookup).
--
-- Those call sites are now repointed at `public_profiles`. `e2e_public_key` is
-- the one column they need that the view did not already expose. It is public
-- by design -- it is the *public* half of a keypair, published specifically so
-- other users can encrypt messages to its owner (see lib/services/e2e-key-service.ts).
-- The migration-strategy doc already classifies it as a legitimate cross-user
-- read that is "meant to be public for encryption purposes, just not lumped in
-- with truly sensitive fields."
--
-- Column is appended at the end so this is a valid CREATE OR REPLACE VIEW
-- (existing column names/order/types are unchanged).
--
-- As with the original view definition, `security_invoker` is deliberately NOT
-- set: the view must keep bypassing base-table RLS via view-owner privilege,
-- which is its entire purpose. Do not apply the security advisor's generic
-- `security_invoker = true` remediation here.
create or replace view public.public_profiles as
select
  id,
  username,
  display_name,
  avatar,
  location,
  about,
  verification_status,
  created_at,
  e2e_public_key
from public.profiles;

grant select on public.public_profiles to anon, authenticated;
