-- Fix the poster's response to a hunter cancellation request (adjacent to
-- trust-spine audit 2026-09-30 T4; found while verifying the escrow gate).
--
-- bounty_cancellations_update_responder (from
-- 20260715i_sync_rls_policies_across_environments.sql) had
--   WITH CHECK (requester_id = (SELECT bc1.requester_id FROM bounty_cancellations bc1
--                               WHERE bc1.id = bc1.id) AND auth.uid() = responder_id)
-- The subquery references the table itself (Postgres rejects it with
-- "infinite recursion detected in policy"), and bc1.id = bc1.id is a
-- tautology anyway. Every client UPDATE by the responding poster fails, on
-- prod and staging alike. In cancellation-service.acceptCancellation() the
-- wallet refund runs first, so a poster who accepted a hunter's cancellation
-- got the money back while the request stayed 'pending' and the bounty stayed
-- 'cancellation_requested'. Reproduced on staging 2026-10-01.
--
-- The intent (requester fields are immutable, only the other party responds)
-- is now expressed without self-reference:
--   * the policy checks the responder is the caller (or not yet set) and is
--     not the requester, and that the caller is a party to the bounty;
--   * column-level UPDATE grants make requester_id / requester_type /
--     bounty_id / refund_percentage immutable from the client.
-- The client updates only status, responder_id, response_message,
-- refund_amount and resolved_at (cancellation-service.ts, dispute-service.ts).
--
-- Rollback (generated from each environment's live pre-migration state):
--   supabase/rollbacks/production/20261001120400_bounty_cancellations_responder_policy_fix.down.sql
--   supabase/rollbacks/staging/20261001120400_bounty_cancellations_responder_policy_fix.down.sql

BEGIN;

DROP POLICY IF EXISTS bounty_cancellations_update_responder ON public.bounty_cancellations;

CREATE POLICY bounty_cancellations_update_responder
  ON public.bounty_cancellations FOR UPDATE TO authenticated
  USING (
    (SELECT auth.uid()) IS NOT NULL
    AND (SELECT auth.uid()) <> requester_id
    AND EXISTS (
      SELECT 1 FROM public.bounties b
       WHERE b.id = bounty_cancellations.bounty_id
         AND (SELECT auth.uid()) IN (b.poster_id, b.accepted_by)
    )
  )
  WITH CHECK (
    (SELECT auth.uid()) <> requester_id
    AND (responder_id IS NULL OR responder_id = (SELECT auth.uid()))
    AND EXISTS (
      SELECT 1 FROM public.bounties b
       WHERE b.id = bounty_cancellations.bounty_id
         AND (SELECT auth.uid()) IN (b.poster_id, b.accepted_by)
    )
  );

REVOKE UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON public.bounty_cancellations FROM authenticated;
REVOKE ALL ON public.bounty_cancellations FROM anon;
GRANT UPDATE (status, responder_id, response_message, refund_amount, resolved_at, updated_at)
  ON public.bounty_cancellations TO authenticated;

COMMIT;
