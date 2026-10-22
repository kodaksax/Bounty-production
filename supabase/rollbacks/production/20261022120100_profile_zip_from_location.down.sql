-- Rollback for 20261022120100_profile_zip_from_location.sql
--
-- Clears every ZIP the backfill wrote that is still unchanged, then drops the
-- trigger, the backfill function and its log. ZIPs the trigger derived for
-- new or edited profiles after the apply are kept: they are correct, and no
-- record separates them from ZIPs entered by hand.

BEGIN;

UPDATE public.profiles p
SET zip_code = NULL
FROM public.profile_zip_backfill_log l
WHERE l.user_id = p.id
  AND p.zip_code = l.zip_code;

DROP TRIGGER IF EXISTS trg_profiles_zip_from_location ON public.profiles;
DROP FUNCTION IF EXISTS public.fn_profiles_zip_from_location();
DROP FUNCTION IF EXISTS public.fn_backfill_profile_zip_from_location(boolean);
DROP TABLE IF EXISTS public.profile_zip_backfill_log;

COMMIT;
