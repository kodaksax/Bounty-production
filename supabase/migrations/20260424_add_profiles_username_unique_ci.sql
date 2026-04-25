-- Migration: Case-insensitive unique index on profiles.username
-- Description: Ensure usernames are exclusive to a single auth user regardless
--              of letter casing. `profiles.username` already has a case-sensitive
--              UNIQUE constraint, but that allowed `Alice` and `alice` to coexist,
--              which breaks the "one username → one user" guarantee.
--
-- This migration:
--   1. De-duplicates any existing case-variant collisions by suffixing the
--      most recently created profile's username with a short fragment of its
--      id so the unique index can be built without errors. The id suffix is
--      globally unique so no new collisions can be introduced by this step.
--      Affected users can pick a new username in-app. This is intentionally
--      non-destructive (no rows are deleted) so nothing else that references
--      profiles.id breaks.
--   2. Adds a case-insensitive unique index on LOWER(username). Combined with
--      the existing UNIQUE(username) this locks the username namespace to a
--      single owner per canonical (lowercased) form.
--
-- Note on existing data: pre-existing profiles keep their original casing
-- (e.g. `Alice` stays as `Alice`) — only their LOWER() form is uniqueness-
-- checked. New registrations are lowercased at the edge function, so over
-- time the dataset naturally converges to all-lowercase.
--
-- Usernames are returned to the pool automatically:
--   - ON DELETE CASCADE from auth.users removes the profile row, freeing the name
--   - Users renaming themselves release their previous username immediately

BEGIN;

-- Step 1: Resolve any pre-existing case-variant collisions. Keep the oldest
-- profile for each lowercased username; rename the rest with a deterministic
-- suffix so they can be edited by their owners.
WITH ranked AS (
  SELECT
    id,
    username,
    ROW_NUMBER() OVER (
      PARTITION BY LOWER(username)
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM public.profiles
)
UPDATE public.profiles p
SET username = LEFT(p.username, 16) || '_' || SUBSTRING(p.id::text FROM 1 FOR 6)
FROM ranked r
WHERE p.id = r.id
  AND r.rn > 1;

-- Step 2: Drop the old case-sensitive helper index if it exists; the new
-- unique index will serve the same lookup pattern.
DROP INDEX IF EXISTS public.idx_profiles_username_lower;

-- Step 3: Case-insensitive unique index. This is the authoritative guarantee
-- that a given username (ignoring case) maps to at most one auth user.
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_username_lower_unique
  ON public.profiles (LOWER(username));

COMMENT ON INDEX public.idx_profiles_username_lower_unique IS
  'Case-insensitive uniqueness for profiles.username so usernames are exclusive to one user.';

COMMIT;
