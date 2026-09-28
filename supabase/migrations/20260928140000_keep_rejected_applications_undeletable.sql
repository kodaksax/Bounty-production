-- Keep rejected applications undeletable by hunters (#876).
--
-- 20260908000000_hunters_can_discard_rejected_applications.sql widened the
-- hunter DELETE policy to `status IN ('pending','rejected')` so "Discard" could
-- delete a rejected row. It was never applied to production (checked
-- 2026-09-28: not in schema_migrations; live policy is pending-only), so every
-- Discard failed with "Failed to discard application".
--
-- Since then, rejected rows became the source of the request-outcome metrics
-- (request_outcomes / poster responsiveness, 20260925220000): poster_declined,
-- expired_no_response, closed_poster_absent, closed_bounty_gone. Letting hunters
-- delete them would erase exactly those outcomes. Discard is now a per-hunter
-- hide on the client (lib/services/application-withdrawal.ts) and deletes
-- nothing.
--
-- This migration pins the policy back to pending-only so that a future
-- `supabase db push` that picks up 20260908000000 ends in the right state.
-- On production today it re-creates the identical policy (no-op).

BEGIN;

DROP POLICY IF EXISTS "Hunters can delete their own pending applications" ON public.bounty_requests;
CREATE POLICY "Hunters can delete their own pending applications"
  ON public.bounty_requests
  FOR DELETE
  TO public
  USING (
    auth.uid() = hunter_id
    AND status = 'pending'::request_status_enum
  );

COMMIT;

-- Verification:
--   SELECT qual FROM pg_policies
--    WHERE tablename = 'bounty_requests'
--      AND policyname = 'Hunters can delete their own pending applications';
--   -- ((auth.uid() = hunter_id) AND (status = 'pending'::request_status_enum))
