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
--             2 internal. 20261022120000 marks it is_test.
--   9f5355f6  "Deliver me food", for honor, tonkagisil_1167 (a family
--             account, internal from 20261022120000), open since 06-17.
--             Poster never had a session; accepted hunter's account deleted;
--             1 pending application. No money.
--
-- Neither can be closed by the existing tools: fn_sweep_absent_posters skips
-- both (accepted_request_id is set) and admin_set_bounty_status refuses
-- 2a39dbf2 while escrow is held.
--
-- Run PREVIEW first. The WRITE is one DO block so it is atomic even through
-- an execute_sql call (a multi-statement BEGIN/COMMIT there is not reliable).
-- It refuses to run twice (a refund row already exists). Checked on PGlite
-- with prod's close trigger, apply_refund_tx and profile-guard behaviour.
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

-- ─── WRITE ─────────────────────────────────────────────────────────────────
DO $$
DECLARE
  c_couch  constant uuid := '2a39dbf2-e720-4cff-b95d-bbe8fb84523d';
  c_food   constant uuid := '9f5355f6-faaa-499f-a809-e3dc2955724a';
  c_escrow constant uuid := '315c117a-4854-40d9-9eaf-b102c8a5f800';
  c_reason constant text := 'stale listing closed by ops 2026-10-22: accepted hunter deleted their account, listing reopened';
  v_escrow  record;
  v_refund  uuid;
  v_applied boolean;
  v_rows    integer;
BEGIN
  -- apply_refund_tx credits profiles.balance; this transaction has no
  -- service-role JWT, so open the profile guard for it alone.
  PERFORM set_config('app.bypass_profile_guard', 'on', true);

  -- 2a39dbf2: refund the held escrow to whoever funded it.
  SELECT * INTO v_escrow FROM public.wallet_transactions
  WHERE id = c_escrow AND bounty_id = c_couch AND type = 'escrow' AND status = 'completed'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'escrow % not found as completed escrow on %', c_escrow, c_couch;
  END IF;
  IF EXISTS (SELECT 1 FROM public.wallet_transactions WHERE bounty_id = c_couch AND type = 'refund') THEN
    RAISE EXCEPTION 'bounty % already has a refund row', c_couch;
  END IF;

  INSERT INTO public.wallet_transactions (user_id, bounty_id, type, amount, description, status, metadata)
  VALUES (
    v_escrow.user_id, c_couch, 'refund', abs(v_escrow.amount),
    'Refund for bounty ' || c_couch || ': ' || c_reason, 'pending',
    jsonb_build_object(
      'bounty_id', c_couch, 'escrow_transaction_id', c_escrow, 'reason', 'stale_listing_close_20261022',
      'refund_percentage', 100, 'original_escrow_amount', abs(v_escrow.amount), 'refunded_at', now()))
  RETURNING id INTO v_refund;

  SELECT applied INTO v_applied FROM public.apply_refund_tx(v_refund, v_escrow.user_id, abs(v_escrow.amount));
  IF v_applied IS NOT TRUE THEN
    RAISE EXCEPTION 'apply_refund_tx did not apply refund %', v_refund;
  END IF;
  IF public.fn_bounty_unsettled_escrow_reason(c_couch) IS NOT NULL THEN
    RAISE EXCEPTION 'escrow on % still unsettled after refund: %', c_couch, public.fn_bounty_unsettled_escrow_reason(c_couch);
  END IF;

  UPDATE public.bounties SET status = 'cancelled' WHERE id = c_couch AND status = 'open';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '2a39dbf2: expected 1 open row, updated %', v_rows; END IF;

  -- 9f5355f6: nothing held, archive it.
  IF public.fn_bounty_unsettled_escrow_reason(c_food) IS NOT NULL THEN
    RAISE EXCEPTION '9f5355f6 unexpectedly holds money: %', public.fn_bounty_unsettled_escrow_reason(c_food);
  END IF;
  UPDATE public.bounties
  SET status = 'archived', is_stale = true, stale_reason = 'poster_absent', stale_detected_at = now()
  WHERE id = c_food AND status = 'open';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '9f5355f6: expected 1 open row, updated %', v_rows; END IF;

  PERFORM public.record_bounty_event(
    'admin.status_changed:' || id::text || ':' || to_char(now() AT TIME ZONE 'UTC', 'YYYYMMDD"T"HH24MISS.US'),
    'admin.status_changed', 'system', id, NULL, now(), NULL, NULL,
    jsonb_build_object('from', 'open', 'to', to_status, 'reason', c_reason))
  FROM (VALUES (c_couch, 'cancelled'), (c_food, 'archived')) AS v(id, to_status);
END $$;

-- ─── VERIFY ────────────────────────────────────────────────────────────────
SELECT b.id, b.status::text, b.is_test,
       public.fn_bounty_unsettled_escrow_reason(b.id) AS unsettled,
       (SELECT count(*) FROM public.bounty_requests r WHERE r.bounty_id = b.id AND r.status = 'pending') AS still_pending,
       (SELECT count(*) FROM public.bounty_requests r WHERE r.bounty_id = b.id AND r.rejection_source = 'system_bounty_closed') AS closed_by_trigger,
       (SELECT count(*) FROM public.notifications_outbox o
         WHERE o.bounty_id = b.id::text AND o.data->>'type' = 'application_bounty_closed') AS hunter_notices,
       (SELECT count(*) FROM public.wallet_transactions t WHERE t.bounty_id = b.id AND t.type = 'refund' AND t.status = 'completed') AS refunds
FROM public.bounties b
WHERE b.id IN ('2a39dbf2-e720-4cff-b95d-bbe8fb84523d', '9f5355f6-faaa-499f-a809-e3dc2955724a');
-- Expected: cancelled / archived, unsettled NULL, still_pending 0,
-- closed_by_trigger 9 / 1, hunter_notices 9 / 1, refunds 1 / 0.
