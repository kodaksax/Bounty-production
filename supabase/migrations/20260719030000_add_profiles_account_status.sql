-- Migration: Add profiles.account_status for admin suspend/ban
-- Created: 2026-07-19
--
-- BACKGROUND: adminDataClient.updateUserStatus() has been calling
-- `.update({ status }).eq('id', id)` under the admin's own anon-key JWT --
-- but `profiles` has never had a `status` column (verified via a full
-- information_schema.columns dump), and every UPDATE policy on profiles is
-- `auth.uid() = id` (no admin bypass), so this call fails for two independent
-- reasons every time an admin tries to suspend/ban/restore another user's
-- account. The `admin-profiles` edge function's `list` action also filters
-- on the same nonexistent `status` column when a status filter chip is
-- selected in the admin panel UI.
--
-- Product decision (confirmed with the user): add a dedicated three-state
-- enum column matching the admin UI exactly (active/suspended/banned),
-- rather than overloading the existing (currently unused anywhere)
-- account_restricted/restriction_reason/restricted_at columns. This pass is
-- plumbing only -- no RLS policy, login check, bounty-posting check, or
-- withdrawal check reads this column yet. A suspended/banned user can still
-- fully use the app; only the admin panel's own read of this field changes
-- behavior. Enforcement is explicitly out of scope for this pass and is a
-- recommended follow-up.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS account_status TEXT NOT NULL DEFAULT 'active';

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_account_status_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_account_status_check
  CHECK (account_status IN ('active', 'suspended', 'banned'));

CREATE INDEX IF NOT EXISTS idx_profiles_account_status
  ON public.profiles (account_status)
  WHERE account_status <> 'active';

COMMENT ON COLUMN public.profiles.account_status IS
  'Admin moderation status: active, suspended, or banned. Written only via the '
  'admin-profiles edge function''s updateStatus action (service_role). Not yet '
  'enforced anywhere (no RLS/login/withdrawal check reads it) -- plumbing only '
  'as of 2026-07-19; see docs/withdrawals/09-security-audit-findings-2026-07-19.md finding #3.';

NOTIFY pgrst, 'reload schema';
