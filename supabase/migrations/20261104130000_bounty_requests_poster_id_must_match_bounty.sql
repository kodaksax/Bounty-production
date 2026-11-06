-- Migration: a bounty application's poster_id must be the bounty's real poster
-- Created: 2026-11-04
--
-- PROBLEM
--   bounty_requests.poster_id is denormalized from the bounty and supplied by
--   the applying hunter's client. "Hunters can create applications" never checked
--   it, and trg_bounty_requests_guard_assignment only freezes it after insert, so
--   a hunter could apply to anyone's open bounty with poster_id set to themselves.
--
--   Readers trust that column. The deployed accept-bounty-request function treated
--   it as proof of ownership and then called fn_accept_bounty_request with the
--   service key, which skips the RPC's own poster check: the hunter could hire
--   themselves, debiting the real poster's wallet into escrow. The new application
--   notification also goes to NEW.poster_id, so the real poster would not be told.
--
--   Production on 2026-11-04: 0 rows where poster_id differs from
--   COALESCE(bounties.poster_id, bounties.user_id). So there is no sign this was
--   used, and this check rejects nothing clients have been sending, all of which
--   send bounty.poster_id || bounty.user_id. Re-run the audit with
--   scripts/ops/bounty-request-forged-poster-audit.sql.
--
-- WHAT THIS DOES
--   Adds that one condition to the policy. Every other clause is as it was in
--   production on 2026-11-04 (20260915053615). The service role bypasses RLS and
--   is unaffected.
--
-- Independent of 20261104120000: it can be applied first.
-- Rollback: supabase/rollbacks/production/20261104130000_bounty_requests_poster_id_must_match_bounty.down.sql

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
         AND bounty_requests.poster_id = COALESCE(b.poster_id, b.user_id)
    )
    AND public.hunter_meets_bounty_id_requirement(bounty_id, hunter_id)
  );

COMMIT;
