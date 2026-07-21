-- Migration: add_zip_code_to_bounties_and_profiles
-- Created: 2026-07-14
--
-- Adds an optional ZIP code column to both `bounties` (set by the poster in
-- the Location & Visibility step) and `profiles` (set by a hunter, e.g. on
-- the onboarding "Browse by ZIP" step, if they choose to enter one).
--
-- Not consumed by any feature yet — intended for a future notification
-- feature that matches newly posted bounties to users whose profile ZIP
-- matches the bounty's ZIP.

ALTER TABLE public.bounties
  ADD COLUMN IF NOT EXISTS zip_code TEXT;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS zip_code TEXT;

COMMENT ON COLUMN public.bounties.zip_code IS
  'Optional ZIP code entered by the poster. Powers future ZIP-matched bounty notifications.';

COMMENT ON COLUMN public.profiles.zip_code IS
  'Optional ZIP code entered by the user (e.g. onboarding "Browse by ZIP"). Powers future ZIP-matched bounty notifications.';

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
