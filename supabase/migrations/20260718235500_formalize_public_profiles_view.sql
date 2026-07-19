-- Formalizes `public_profiles` as a tracked migration. This view has existed
-- live in production for some time as untracked schema drift (owner
-- `postgres`, never created by a migration file) -- this migration closes
-- that gap without changing its definition or behavior.
--
-- Purpose: a curated, safe-columns escape hatch for reading ANOTHER user's
-- profile (poster/hunter display, search results, profile pages) without
-- exposing the ~62-column `profiles` table (balance, Stripe IDs, risk
-- fields, email, phone) to every authenticated caller via the broad
-- `profiles_select_authenticated USING (true)` RLS policy.
-- See docs/withdrawals/08-profiles-rls-migration-strategy.md for the full
-- migration strategy this is step 1 of.
--
-- Deliberately NOT setting `security_invoker = true` (Supabase's security
-- advisor flags this view as ERROR-level and its generic remediation is to
-- set that option) -- doing so would make the view respect the querying
-- user's own RLS on the base `profiles` table, defeating its entire purpose
-- as a curated safe-columns view that's readable regardless of caller. This
-- is an intentional, documented deviation from the linter's default advice.
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
  'Curated safe-columns view of profiles for cross-user reads (poster/hunter display, profile pages, search). Intentionally bypasses base-table RLS via view-owner privilege (owner postgres, security_invoker NOT set) so it can serve any authenticated caller regardless of the caller''s own row -- do not "fix" this per the security advisor''s generic security_invoker=true suggestion, see docs/withdrawals/08-profiles-rls-migration-strategy.md.';

grant select on public.public_profiles to anon, authenticated;
