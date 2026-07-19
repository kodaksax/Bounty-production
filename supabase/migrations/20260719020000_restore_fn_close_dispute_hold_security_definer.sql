-- Migration: Restore SECURITY DEFINER on fn_close_dispute_hold(integer, text)
-- Created: 2026-07-19
--
-- BACKGROUND: While preparing the profiles column-level SELECT REVOKE
-- (docs/withdrawals/08-profiles-rls-migration-strategy.md step 5), a fresh
-- check of every function referencing profiles.balance/balance_on_hold/
-- email/phone/stripe_*/risk_* found that the LIVE production
-- fn_close_dispute_hold(integer, text) is SECURITY INVOKER
-- (pg_proc.prosecdef = false) -- despite BOTH tracked migrations that define
-- this function (20260417_add_balance_on_hold_dispute_freeze.sql for the
-- original uuid/text signature, and 20260418_fix_dispute_hold_permissions.sql
-- for the current integer/text signature) explicitly declaring
-- `SECURITY DEFINER`. This is the same class of untracked-drift bug found
-- repeatedly this project (git says X, production silently has not-X) --
-- someone/something recreated this function directly against production at
-- some point without SECURITY DEFINER, and that change was never captured
-- in any migration file.
--
-- WHY THIS MATTERS NOW: lib/services/dispute-service.ts calls this RPC
-- directly from the authenticated (admin) client
-- (supabase.rpc('fn_close_dispute_hold', ...)) to resolve disputes. The
-- function body does `UPDATE profiles SET balance_on_hold = GREATEST(0,
-- balance_on_hold - x)` and `SET balance = GREATEST(0, balance - x)` --
-- both read-modify-write expressions that require SELECT privilege on
-- balance_on_hold/balance for whichever role actually executes the UPDATE.
-- Under SECURITY INVOKER that's the calling `authenticated` role. The
-- planned profiles column REVOKE (see the migration immediately following
-- this one) would have silently broken admin dispute resolution in
-- production the next time it ran, since `authenticated` would no longer be
-- able to read those two columns at all.
--
-- FIX: restore SECURITY DEFINER, matching the tracked migration history
-- exactly (this is byte-for-byte identical to the body already committed in
-- 20260418_fix_dispute_hold_permissions.sql -- transcribed from that file,
-- not reconstructed from memory). The function's own internal authorization
-- guard (auth.role() = 'authenticated' requires admin app_metadata.role) is
-- unchanged -- this only restores the intended execution context so the
-- function's own writes no longer depend on the calling role's column
-- grants, the same defense-in-depth pattern already used by every sibling
-- financial function in this schema (fn_open_dispute_hold, apply_deposit,
-- apply_escrow, apply_refund, withdraw_balance, etc. are all already
-- SECURITY DEFINER).

CREATE OR REPLACE FUNCTION public.fn_close_dispute_hold(
  p_dispute_id INTEGER,
  p_new_status TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bounty_id      UUID;
  v_hold_amount    NUMERIC;
  v_poster_id      UUID;
  v_current_status TEXT;
BEGIN
  -- ── Authorization guard ──────────────────────────────────────────────────
  -- Allow calls from service_role (no JWT) or authenticated admins only.
  -- auth.role() returns 'service_role' for direct DB / server-side calls and
  -- 'authenticated' for PostgREST calls from the mobile/web client.
  IF auth.role() = 'authenticated' THEN
    IF COALESCE((auth.jwt() -> 'app_metadata' ->> 'role'), '') <> 'admin' THEN
      RAISE EXCEPTION 'Admin role required to release a dispute hold'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  -- ── End authorization guard ──────────────────────────────────────────────

  IF p_new_status NOT IN (
    'resolved_hunter_wins',
    'resolved_poster_wins',
    'cancelled',
    'resolved',
    'closed'
  ) THEN
    RAISE EXCEPTION 'Invalid resolution status for fn_close_dispute_hold: %', p_new_status
      USING ERRCODE = 'P0001';
  END IF;

  -- Lock dispute row.
  SELECT bounty_id, hold_amount, status
    INTO v_bounty_id, v_hold_amount, v_current_status
    FROM public.bounty_disputes
   WHERE id = p_dispute_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dispute % not found', p_dispute_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Update the dispute status.
  UPDATE public.bounty_disputes
     SET status      = p_new_status,
         hold_amount = 0
   WHERE id = p_dispute_id;

  -- If no hold was placed, nothing else to do.
  IF v_hold_amount IS NULL OR v_hold_amount <= 0 THEN
    RETURN;
  END IF;

  IF v_bounty_id IS NULL THEN
    RETURN;
  END IF;

  -- Identify the poster.
  SELECT user_id
    INTO v_poster_id
    FROM public.bounties
   WHERE id = v_bounty_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Release the hold unconditionally.
  UPDATE public.profiles
     SET balance_on_hold = GREATEST(0, balance_on_hold - v_hold_amount)
   WHERE id = v_poster_id;

  -- For hunter wins, also deduct the held amount from the poster's balance.
  -- GREATEST(0, ...) guards against double-deduction in escrow flows where the
  -- balance has already been reduced when the bounty was accepted.
  IF p_new_status = 'resolved_hunter_wins' THEN
    UPDATE public.profiles
       SET balance = GREATEST(0, balance - v_hold_amount)
     WHERE id = v_poster_id;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.fn_close_dispute_hold(INTEGER, TEXT) IS
  'Releases the wallet hold placed by fn_open_dispute_hold and updates the dispute status '
  'atomically. On resolved_hunter_wins the hold amount is also deducted from the poster''s '
  'balance. Callable by service_role (direct DB) or by authenticated users with '
  'app_metadata.role = admin.';

GRANT EXECUTE ON FUNCTION public.fn_close_dispute_hold(INTEGER, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
