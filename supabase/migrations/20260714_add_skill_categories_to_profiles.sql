-- Migration: add_skill_categories_to_profiles
-- Created: 2026-07-14
--
-- Adds a column to store the preset skill-category tags a user selects on
-- their profile (subset of the fixed bounty category list: tech, design,
-- writing, labor, delivery, other — see lib/constants/bounty-categories.ts
-- on the client). Distinct from the existing free-text `skills` column.
--
-- Not consumed by any feature yet — intended for a future recommended-bounty
-- notification feature that matches a hunter's selected categories against
-- newly posted bounties.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS skill_categories TEXT[];

COMMENT ON COLUMN public.profiles.skill_categories IS
  'Preset skill category tags selected by the user (subset of tech/design/writing/labor/delivery/other). Powers future recommended-bounty notifications.';

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
