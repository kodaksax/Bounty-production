-- Repair the legacy bounties reported as deadlocked in #876.
--
-- Two shapes of pre-guard data left users with a bounty they could neither
-- finish nor cancel. Both predate the current accept RPCs and the 09-11 / 09-13
-- guards; all targets are $0 for-honor bounties with zero wallet_transactions,
-- so NO money moves.
--
--   1. "Wash my dishes" (81f90076) has TWO `accepted` requests. accepted_by is
--      magrethpeter55; the second accepted row belongs to bounty0j, whose Work
--      tab therefore showed an active job they could never act on. That row is
--      closed. The bounty itself and the real hunter's row are untouched.
--
--   2. "Test to your hearts content" (e2f61aed) and "Use for dispute check"
--      (b6291248) are bounty0j's is_test bounties stuck `in_progress` with
--      accepted_by NULL: the accepted request's hunter_id was nulled by the
--      09-13 owner-loss incident, so there is no hunter to submit, approve or
--      answer a cancellation. They are cancelled.
--
-- Side effects, checked against production triggers on 2026-09-28:
--   * request -> rejected with rejection_source 'system_bounty_closed': writes
--     one `application.closed` bounty_events row; no notification (only
--     pending->accepted notifies). A system_* source keeps it out of the
--     poster-declined outcome metric, which is correct: nobody declined it.
--   * bounty -> cancelled: bounty_events status row; no hunter notification
--     (accepted_by is NULL); no pending applications to auto-close.
--
-- Deliberately NOT touched:
--   * 2a39dbf2 "Move a couch" ($1 escrow, #864) and eccfddee "Take photos"
--     ($5 escrow, no owner): money, needs a human decision.
--   * cf69674f / d906ff87 / eccfddee: poster_id, user_id and former_poster_id
--     are all NULL, so any UPDATE violates bounties_owner_reference_required.
--     Belongs to the owner-loss cleanup.
--   * 15 other null-hunter `accepted` rows on completed/deleted bounties: they
--     block nobody and are the (anonymised) acceptance record.
--
-- Every UPDATE matches on id AND the exact pre-repair state. This is a
-- one-off data repair for specific production rows, not a schema change:
-- `supabase db push` replays every file in this directory against preview
-- and dev databases too, and those rows don't exist there. So instead of
-- raising when the target rows are missing or already drifted (which would
-- abort the whole migration chain on any environment other than the exact
-- production snapshot this was written against), the block below checks
-- for the target bounty first and NOTICEs + skips if it isn't in the
-- expected pre-repair state. On production, where the rows are expected,
-- it still raises if a match count comes back wrong mid-repair, since at
-- that point the money guard has already passed and a short match means
-- something about the target rows changed between the check and the write.
--
-- DRY RUN: execute this file wrapped in BEGIN; ... ROLLBACK; and read the
-- NOTICE lines. The transaction below is the whole change.

BEGIN;

DO $$
DECLARE
  n integer;
  target_ids uuid[] := ARRAY['81f90076-4b94-4ae2-8f2c-e47595cf6f71',
                              'e2f61aed-c9b9-469e-ac40-a9321de41613',
                              'b6291248-e852-441d-a956-916a7b411e5b']::uuid[];
BEGIN
  -- Environment gate: only run where the documented bounties actually
  -- exist. A preview/dev database with none of these rows is a no-op, not
  -- a failure.
  SELECT count(*) INTO n FROM public.bounties WHERE id = ANY(target_ids);
  IF n <> 3 THEN
    RAISE NOTICE '#876 repair skipped: expected 3 target bounties, found % (not the production snapshot this was written for)', n;
    RETURN;
  END IF;

  -- Money guard: none of the targets may have ever touched any funding
  -- ledger -- v1 (wallet_transactions), v2 (bounty_payments), or v3
  -- (bounty_v3_funding).
  SELECT count(*) INTO n
    FROM public.wallet_transactions
   WHERE bounty_id = ANY(target_ids);
  IF n <> 0 THEN
    RAISE EXCEPTION '#876 repair aborted: % wallet_transactions on target bounties', n;
  END IF;

  SELECT count(*) INTO n
    FROM public.bounty_payments
   WHERE bounty_id = ANY(target_ids);
  IF n <> 0 THEN
    RAISE EXCEPTION '#876 repair aborted: % bounty_payments on target bounties', n;
  END IF;

  SELECT count(*) INTO n
    FROM public.bounty_v3_funding
   WHERE bounty_id = ANY(target_ids);
  IF n <> 0 THEN
    RAISE EXCEPTION '#876 repair aborted: % bounty_v3_funding rows on target bounties', n;
  END IF;

  -- 1. bounty0j's duplicate accepted request on "Wash my dishes". The
  -- bounty id is pinned explicitly (not just joined via br.bounty_id) so a
  -- reassigned/corrupted FK on the request can't redirect this repair onto
  -- a different bounty.
  UPDATE public.bounty_requests br
     SET status = 'rejected',
         rejection_source = 'system_bounty_closed',
         rejected_at = now()
    FROM public.bounties b
   WHERE br.id = '49911372-00d1-4dd5-9178-b0a08d23c0ae'
     AND br.status = 'accepted'
     AND br.hunter_id = 'f4bd948b-a0a6-4991-8e5d-d4a3978760e6'
     AND br.bounty_id = '81f90076-4b94-4ae2-8f2c-e47595cf6f71'
     AND b.id = br.bounty_id
     AND b.accepted_by = '4a0b8b2b-7a7c-4247-a0e5-55a80657ae58'
     AND b.amount = 0;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '#876 repair: duplicate accepted requests closed: %', n;
  IF n <> 1 THEN
    RAISE EXCEPTION '#876 repair aborted: expected 1 request, matched %', n;
  END IF;

  -- 2. In-progress bounties with no hunter to finish them.
  UPDATE public.bounties
     SET status = 'cancelled'
   WHERE id IN ('e2f61aed-c9b9-469e-ac40-a9321de41613',
                'b6291248-e852-441d-a956-916a7b411e5b')
     AND status = 'in_progress'
     AND accepted_by IS NULL
     AND amount = 0
     AND is_test = true;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '#876 repair: worker-less in_progress bounties cancelled: %', n;
  IF n <> 2 THEN
    RAISE EXCEPTION '#876 repair aborted: expected 2 bounties, matched %', n;
  END IF;
END
$$;

COMMIT;

-- Verification (expect 0 rows each):
--   SELECT id FROM public.bounties
--    WHERE status = 'in_progress' AND accepted_by IS NULL AND poster_id IS NOT NULL;
--   SELECT bounty_id FROM public.bounty_requests
--    WHERE status = 'accepted' AND hunter_id IS NOT NULL
--    GROUP BY bounty_id HAVING count(*) > 1;
--
-- Rollback restores only the two base-row updates above. The bounty/request
-- event triggers fired on the original UPDATEs (bounty_events audit rows,
-- request outcome rows) are NOT undone by this -- treat it as a base-row
-- rollback only, and reconcile the event/outcome tables separately if used:
--   UPDATE public.bounty_requests
--      SET status = 'accepted', rejection_source = NULL, rejected_at = NULL
--    WHERE id = '49911372-00d1-4dd5-9178-b0a08d23c0ae';
--   UPDATE public.bounties SET status = 'in_progress'
--    WHERE id IN ('e2f61aed-c9b9-469e-ac40-a9321de41613',
--                 'b6291248-e852-441d-a956-916a7b411e5b');
