-- Rollback for 20261104130000_bounty_requests_poster_id_must_match_bounty.sql.
--
-- This reopens the forged poster_id insert. It is only safe once the deployed
-- accept-bounty-request runs fn_accept_bounty_request as the caller.

BEGIN;

DROP POLICY IF EXISTS "Hunters can create applications" ON public.bounty_requests;
CREATE POLICY "Hunters can create applications"
  ON public.bounty_requests
  FOR INSERT
  TO public
  WITH CHECK (
    auth.uid() = hunter_id
    AND public.is_account_active(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.bounties b
       WHERE b.id = bounty_requests.bounty_id
         AND b.status::text = 'open'
    )
    AND public.hunter_meets_bounty_id_requirement(bounty_id, hunter_id)
  );

COMMIT;
