-- Account deletion failed with bounty_requests_hunter_id_present for any user
-- who had ever applied to a bounty: bounty_requests_hunter_id_fkey is
-- ON DELETE SET NULL, and the NOT VALID CHECK (hunter_id IS NOT NULL) from
-- 20260911000000 rejects exactly that update -- the same FK-vs-CHECK conflict
-- 20261010130000 fixed for bounties_owner_reference_required.
--
-- The constraint's stated risk is an applicant-less application a poster can
-- still accept, i.e. a *pending* one. handle_user_deletion_cleanup() (BEFORE
-- DELETE on profiles) rejects the leaver's pending requests before the FK
-- nulls hunter_id, so scoping the check to pending rows keeps that guarantee
-- and lets accepted/rejected history survive as anonymised rows.

ALTER TABLE public.bounty_requests
  DROP CONSTRAINT IF EXISTS bounty_requests_hunter_id_present;

ALTER TABLE public.bounty_requests
  ADD CONSTRAINT bounty_requests_hunter_id_present
  CHECK (hunter_id IS NOT NULL OR status <> 'pending'::request_status_enum)
  NOT VALID;

COMMENT ON CONSTRAINT bounty_requests_hunter_id_present ON public.bounty_requests IS
  'A pending application must name its applicant. Decided rows may lose hunter_id when the applicant deletes their account (FK ON DELETE SET NULL). NOT VALID: 50 legacy rows predate 2026-09-11.';
