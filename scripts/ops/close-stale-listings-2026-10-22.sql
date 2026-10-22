-- Close two stale open listings on prod (2026-10-22).
--
-- The brief named three; two are the same row. 2a39dbf2 IS postgod's open
-- "Move a couch" (postgod's other two "Move a couch" are completed and
-- cancelled).
--
--   2a39dbf2  "Move a couch", $1, postgod (internal), open since 09-07.
--             The hunter accepted 09-07 later deleted their account, so
--             accepted_by went NULL and the listing reopened. accepted_request_id
--             still points at that request and postgod's $1 wallet escrow is
--             still held (fn_bounty_unsettled_escrow_reason =
--             'wallet_escrow_held'). It was is_test = false, so it sat in the
--             external feed: 16 external applications, 7 still pending, plus
--             2 internal. The migration skips its legacy check violation; the
--             write script marks it is_test while cancelling it.
--   9f5355f6  "Deliver me food", for honor, tonkagisil_1167 (a family
--             account, internal from 20261022120000), open since 06-17.
--             Poster never had a session; accepted hunter's account deleted;
--             1 pending application. No money.
--
-- Neither can be closed by the existing tools: fn_sweep_absent_posters skips
-- both (accepted_request_id is set) and admin_set_bounty_status refuses
-- 2a39dbf2 while escrow is held.
--
-- This file is read-only. Review the preview before running
-- close-stale-listings-2026-10-22-write.sql.
--
-- The write script refuses to run twice (a refund row already exists). It was
-- checked on PGlite with prod's close trigger, apply_refund_tx and
-- profile-guard behaviour.
--
-- What the WRITE does:
--   * 2a39dbf2: refunds postgod's $1 escrow to postgod's wallet the way
--     /wallet/refund does (pending refund row, then apply_refund_tx), then
--     status -> cancelled. Wallet ledger only, no Stripe call.
--   * 9f5355f6: status -> archived, stale_reason 'poster_absent' (the sweep's
--     label for a poster who is gone).
--   * Each close fires trg_bounties_reject_pending_requests_on_bounty_close:
--     every pending application becomes rejected / system_bounty_closed and
--     its hunter gets one push, "This bounty is no longer available, so your
--     application was closed automatically -- this wasn't a rejection."
--     9 for 2a39dbf2 (7 external, 2 internal), 1 for 9f5355f6.
--   * Both get a bounty_events 'admin.status_changed' row with the reason.

-- ─── PREVIEW (read-only) ───────────────────────────────────────────────────
SELECT b.id, b.title, b.status::text, b.is_test, b.accepted_by, b.accepted_request_id,
       public.fn_bounty_unsettled_escrow_reason(b.id) AS unsettled,
       (SELECT count(*) FROM public.bounty_requests r
         WHERE r.bounty_id = b.id AND r.status = 'pending' AND r.hunter_id IS NOT NULL) AS pending_to_close,
       (SELECT count(*) FROM public.bounty_requests r JOIN public.profiles hp ON hp.id = r.hunter_id
         WHERE r.bounty_id = b.id AND r.status = 'pending' AND NOT hp.is_internal) AS pending_external,
       (SELECT count(*) FROM public.wallet_transactions t
         WHERE t.bounty_id = b.id AND t.type = 'refund') AS refunds_so_far
FROM public.bounties b
WHERE b.id IN ('2a39dbf2-e720-4cff-b95d-bbe8fb84523d', '9f5355f6-faaa-499f-a809-e3dc2955724a');
-- Expected 2026-10-22: 2a39dbf2 open, wallet_escrow_held, 9 to close (7 external), 0 refunds;
--                      9f5355f6 open, no escrow, 1 to close (1 external).
