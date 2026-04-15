-- Migration: Fix dispute hold function permissions
-- Created: 2026-04-18
-- Problem:  fn_open_dispute_hold and fn_close_dispute_hold have EXECUTE revoked from
--           `authenticated`. lib/services/dispute-service.ts calls both functions via
--           the Supabase anon-key client, which PostgREST runs as `authenticated`.
--           This caused all dispute creation/resolution to fail silently.
--
-- Fix strategy:
--   1. fn_open_dispute_hold — GRANT EXECUTE to authenticated. The service calls this
--      explicitly after INSERT and rolls back (deletes) the dispute row if the call
--      fails, so the hold and the dispute record are always kept in sync.
--      The trigger approach was abandoned because it would apply the hold twice if
--      the service also calls the function explicitly.
--   2. fn_close_dispute_hold — add a caller-authorization guard inside the function
--      (JWT app_metadata.role = 'admin') then GRANT EXECUTE to authenticated.
--      Admin-only operations (updateDisputeStatus / resolveDispute) already enforce
--      admin checks at the application layer; this adds a DB-level guard too.

-- ─── 1. Grant fn_open_dispute_hold to authenticated ──────────────────────────
-- Ensure any stale trigger from earlier iterations of this migration is removed
-- so that the hold cannot be applied twice (once by trigger, once by service call).
DROP TRIGGER IF EXISTS trg_after_bounty_dispute_insert ON public.bounty_disputes;
DROP FUNCTION IF EXISTS public.trg_fn_open_dispute_hold();

-- The service (dispute-service.ts › createDispute) calls fn_open_dispute_hold
-- immediately after inserting the dispute row and deletes the row if the call
-- fails.  EXECUTE must therefore be granted to the authenticated role.
GRANT EXECUTE ON FUNCTION public.fn_open_dispute_hold(INTEGER) TO authenticated;

-- ─── 2. Add admin-guard to fn_close_dispute_hold and grant to authenticated ──
-- Replace the function body with an identical copy plus a JWT admin check at the
-- top so arbitrary authenticated users cannot trigger hold releases or balance
-- deductions on disputes they are not authorized to touch.

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

-- Grant authenticated so PostgREST admin panel calls succeed.
-- The function itself rejects non-admin JWTs, so this is safe.
GRANT EXECUTE ON FUNCTION public.fn_close_dispute_hold(INTEGER, TEXT) TO authenticated;
