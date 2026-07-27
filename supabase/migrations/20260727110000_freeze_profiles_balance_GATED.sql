-- Phase 7 Stage A: freeze profiles.balance (read-only).
--
-- ===========================================================================
-- !! DO NOT APPLY THIS MIGRATION UNTIL THE v2 CUTOVER IS COMPLETE !!
-- ===========================================================================
--
-- Applying this while production runs on payment_architecture_version = 1
-- takes down ALL payments immediately. The live v1 flow mutates
-- profiles.balance through six SECURITY DEFINER RPCs — apply_deposit,
-- apply_escrow, apply_release_tx, apply_refund_tx, withdraw_balance and
-- update_balance — so every deposit, bounty posting, release, refund and
-- withdrawal would begin failing for real users the moment this runs.
--
-- This project has already had precisely this incident: an untracked profile
-- guard trigger blocked all paid bounty, withdrawal and dispute writes in
-- July 2026. This file exists so the freeze is reviewed, versioned and
-- deliberate rather than improvised later.
--
-- Preconditions, ALL of which must hold before applying:
--   1. EXPO_PUBLIC_PAYMENT_ARCHITECTURE_VERSION = 2 in every environment, and
--      the shipped build actually carries it (verify the bundle, not the EAS
--      variable — they diverged once already).
--   2. CONNECT_NATIVE_PAYOUTS = true and exercised in production.
--   3. reconciliation migration_report returns retirementReady = true —
--      zero Mismatch and zero Needs Review accounts.
--   4. The 15-minute reconciliation job has reported GREEN continuously for
--      several days.
--   5. No wallet_transactions rows of type deposit/escrow/release/refund
--      created in the preceding 48 hours (i.e. v1 is genuinely idle).
--
-- The freeze is intentionally a hard failure rather than a silent no-op: the
-- entire point of Stage A is to make forgotten write paths announce
-- themselves. A no-op would let them keep running and hide the problem.
--
-- Rollback: DROP TRIGGER trg_freeze_profiles_balance ON public.profiles;

-- Escape hatch for deliberate administrative correction (e.g. settling the
-- last legacy balances). Set within a transaction, checked by the trigger,
-- and never left on.
--   BEGIN;
--   SELECT set_config('app.allow_balance_mutation', 'on', true);
--   UPDATE public.profiles SET balance = 0 WHERE id = '...';
--   COMMIT;

CREATE OR REPLACE FUNCTION public.freeze_profiles_balance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Only care about actual changes to the frozen columns. An UPDATE that
  -- touches other profile fields must still work normally — most profile
  -- writes have nothing to do with money.
  IF NEW.balance IS NOT DISTINCT FROM OLD.balance
     AND NEW.balance_on_hold IS NOT DISTINCT FROM OLD.balance_on_hold THEN
    RETURN NEW;
  END IF;

  IF current_setting('app.allow_balance_mutation', true) = 'on' THEN
    RAISE WARNING 'profiles.balance mutated under explicit override for user %: % -> %',
      NEW.id, OLD.balance, NEW.balance;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'profiles.balance is frozen (Phase 7 Stage A). Stripe Connect is the source of truth for withdrawable funds. Attempted % -> % for user %.',
    OLD.balance, NEW.balance, NEW.id
    USING ERRCODE = 'check_violation',
          HINT = 'This code path still writes the legacy ledger and must be migrated. For deliberate admin correction, set app.allow_balance_mutation=on within the transaction.';
END;
$$;

COMMENT ON FUNCTION public.freeze_profiles_balance() IS
  'Phase 7 Stage A guard. Fails loudly on any profiles.balance mutation so forgotten legacy write paths surface. Do not enable before the v2 cutover.';

-- ---------------------------------------------------------------------------
-- The trigger is created DISABLED. Applying this migration is therefore safe
-- on its own; arming it is a separate, explicit act:
--
--   ALTER TABLE public.profiles ENABLE TRIGGER trg_freeze_profiles_balance;
--
-- Disarm with:
--   ALTER TABLE public.profiles DISABLE TRIGGER trg_freeze_profiles_balance;
-- ---------------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_freeze_profiles_balance ON public.profiles;

CREATE TRIGGER trg_freeze_profiles_balance
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.freeze_profiles_balance();

ALTER TABLE public.profiles DISABLE TRIGGER trg_freeze_profiles_balance;
