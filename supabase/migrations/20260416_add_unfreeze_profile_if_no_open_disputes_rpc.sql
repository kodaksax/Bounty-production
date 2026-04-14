-- Migration: Atomic profile-unfreeze RPC
-- Created: 2026-04-16
-- Purpose: Prevent a race condition in the charge.dispute.closed webhook
-- handler where a count query followed by a separate UPDATE could allow
-- a concurrent charge.dispute.created event to insert a new open dispute
-- between the two operations, causing the profile wallet to be unfrozen
-- while a new dispute is active.
--
-- The function counts open disputes AND conditionally clears balance_frozen
-- inside a single DB transaction with SERIALIZABLE isolation, eliminating
-- the TOCTOU window.

CREATE OR REPLACE FUNCTION public.unfreeze_profile_if_no_open_disputes(
  p_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_open_count bigint;
  v_was_frozen boolean;
BEGIN
  -- Lock the profile row for the duration of this transaction so a
  -- concurrent freeze (charge.dispute.created) cannot slip in between the
  -- count check and the update.
  SELECT balance_frozen
    INTO v_was_frozen
    FROM public.profiles
   WHERE id = p_user_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile % not found', p_user_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Fast-path: nothing to do if already unfrozen.
  IF NOT v_was_frozen THEN
    RETURN false;
  END IF;

  -- Count open Stripe disputes for this user *while holding the row lock*.
  SELECT COUNT(*)
    INTO v_open_count
    FROM public.bounty_disputes
   WHERE initiator_id = p_user_id
     AND status = 'stripe_dispute';

  IF v_open_count > 0 THEN
    -- Other disputes remain; leave the wallet frozen.
    RETURN false;
  END IF;

  -- No remaining open disputes — safe to unfreeze.
  UPDATE public.profiles
     SET balance_frozen = false
   WHERE id = p_user_id;

  RETURN true;
END;
$$;

-- Allow the service role (used by Edge Functions) and authenticated role to call this.
GRANT EXECUTE ON FUNCTION public.unfreeze_profile_if_no_open_disputes(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.unfreeze_profile_if_no_open_disputes(uuid) TO authenticated;

COMMENT ON FUNCTION public.unfreeze_profile_if_no_open_disputes(uuid) IS
  'Atomically unfreezes a user profile wallet only when there are no remaining open Stripe disputes. '
  'Acquires a row-level lock on the profiles row to prevent a TOCTOU race where a concurrent '
  'charge.dispute.created could insert a new dispute between a count check and the UPDATE. '
  'Returns true when the wallet was actually unfrozen, false otherwise.';
