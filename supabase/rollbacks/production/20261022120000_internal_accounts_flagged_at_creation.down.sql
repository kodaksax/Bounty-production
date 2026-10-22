-- Rollback for 20261022120000_internal_accounts_flagged_at_creation.sql
--
-- Structural part: drops the list, the three triggers and their functions.
-- New profiles go back to defaulting to is_internal = false, and clients can
-- write the column again.
--
-- Data part: returns the rows the migration changed on prod (2026-10-22) to
-- their previous values. Run it only if those accounts really are external;
-- otherwise leave them flagged.

BEGIN;

DROP TRIGGER IF EXISTS trg_internal_account_emails_flag_profile ON public.internal_account_emails;
DROP TRIGGER IF EXISTS trg_profiles_internal_marks_bounties_test ON public.profiles;
DROP TRIGGER IF EXISTS trg_profiles_guard_is_internal ON public.profiles;
DROP FUNCTION IF EXISTS public.fn_internal_account_emails_flag_profile();
DROP FUNCTION IF EXISTS public.fn_profiles_internal_marks_bounties_test();
DROP FUNCTION IF EXISTS public.fn_profiles_guard_is_internal();
DROP TABLE IF EXISTS public.internal_account_emails;

-- jordanmag11 (97c7692c), hunterbnty158 (11bc0b6e), tonkagisil_1167 (898a3eab),
-- gisellemaglalang (262c2101).
UPDATE public.profiles SET is_internal = false
WHERE id IN ('97c7692c-c67a-4472-b0f2-38c66d4462d9', '11bc0b6e-0e5d-4fc0-818a-cf246f5ad7b6',
             '898a3eab-a78d-4800-bb79-b004eea5fbdb', '262c2101-e155-4f01-8fa7-f485b9373698');

-- 2a39dbf2 (postgod "Move a couch"), 59879908 (jordanmag11 "Work a brand
-- activation"), 9f5355f6 + d4f6c2ad (tonkagisil_1167).
UPDATE public.bounties SET is_test = false
WHERE id IN ('2a39dbf2-e720-4cff-b95d-bbe8fb84523d', '59879908-7fdb-4eb8-a01f-0bc37434723f',
             '9f5355f6-faaa-499f-a809-e3dc2955724a', 'd4f6c2ad-a03a-43d1-8622-94901a45086c');

COMMIT;
