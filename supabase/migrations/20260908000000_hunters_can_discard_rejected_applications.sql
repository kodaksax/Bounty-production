-- Migration: allow hunters to discard their own rejected applications
-- Date: 2026-09-08
--
-- ISSUE (kodaksax/Bounty-production#767):
--   Once a poster rejects a hunter's application, the request row lingers in
--   the hunter's "My Bounties" work tab forever with no way to remove it. The
--   client already renders a "Discard" action for rejected requests (see
--   components/bounty-card.tsx), but tapping it always failed with
--   "This application has already been rejected and can no longer be
--   withdrawn." because:
--     1. lib/services/application-withdrawal.ts only ever deleted `pending`
--        rows (fixed in the same change to add `discardApplication`).
--     2. The "Hunters can delete their own pending applications" RLS policy
--        only allowed deleting rows with status = 'pending', so even a
--        corrected client call would have been silently no-op'd by RLS
--        (0 rows deleted, reported as success/failure mismatch).
--
-- FIX: widen the hunter DELETE policy to also allow deleting the hunter's own
-- `rejected` rows. Accepted applications remain undeletable by the hunter —
-- only pending (withdraw) and rejected (discard) are hunter-deletable.

BEGIN;

DROP POLICY IF EXISTS "Hunters can delete their own pending applications" ON public.bounty_requests;
CREATE POLICY "Hunters can delete their own pending applications"
  ON public.bounty_requests
  FOR DELETE
  TO public
  USING (
    auth.uid() = hunter_id
    AND status IN ('pending'::request_status_enum, 'rejected'::request_status_enum)
  );

COMMIT;

-- Verification:
--   -- as the hunter who owns a rejected request row:
--   DELETE FROM public.bounty_requests WHERE id = '<rejected-request-id>';
--   -- succeeds (1 row deleted) instead of 0 rows / RLS no-op.
--   -- as the hunter who owns an accepted request row:
--   DELETE FROM public.bounty_requests WHERE id = '<accepted-request-id>';
--   -- still 0 rows deleted (unchanged behaviour).
