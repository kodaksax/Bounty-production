-- Migration: Fix account deletion failing on bounties.username NOT NULL
-- Date: 2026-05-20
--
-- Issue:
--   Deleting a user's account fails with:
--     null value in column "username" of relation "bounties"
--     violates not-null constraint
--
--   Production has a denormalized `username` column on `bounties` that was
--   declared NOT NULL. When a user is deleted, the trigger
--   `handle_user_deletion_cleanup` (migration 20251117_safe_user_deletion.sql)
--   archives that user's bounties, and the foreign key on `poster_id` is
--   declared `ON DELETE SET NULL`. The denormalized `username` field has no
--   valid value once the source profile is gone, so any UPDATE/cascade path
--   that recomputes it from `profiles` ends up writing NULL, which violates
--   the NOT NULL constraint and aborts the entire account deletion.
--
-- Fix:
--   1) Make `bounties.username` nullable. The username is a denormalized cache
--      of `profiles.username` for display; it can legitimately be unknown when
--      the source profile no longer exists (archived/orphaned bounties).
--   2) Update `handle_user_deletion_cleanup` to also null out the denormalized
--      `username` column when archiving the deleted user's bounties, so the
--      column reflects reality and we do not depend on any implicit
--      denormalization trigger to do the right thing.
--
-- This migration is idempotent and safe to re-run.

BEGIN;

-- Step 1: Drop NOT NULL on bounties.username (denormalized field).
-- Guarded so the migration is safe if the column is missing (older schemas).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'bounties'
      AND column_name  = 'username'
  ) THEN
    BEGIN
      ALTER TABLE public.bounties ALTER COLUMN username DROP NOT NULL;
    EXCEPTION
      WHEN others THEN
        -- Already nullable or cannot be altered; safe to ignore.
        RAISE NOTICE 'bounties.username DROP NOT NULL skipped: %', SQLERRM;
    END;
  END IF;
END$$;

-- Step 2: Update the cleanup trigger so it explicitly nulls the denormalized
-- username on the deleted user's archived bounties. This mirrors the
-- behavior of the ON DELETE SET NULL on poster_id/user_id and prevents any
-- denormalization trigger from later trying to recompute username from a
-- profile that is about to be removed.
CREATE OR REPLACE FUNCTION handle_user_deletion_cleanup()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid;
  v_has_username      boolean;
  v_has_user_id       boolean;
  v_has_poster_id     boolean;
  v_has_accepted_by   boolean;
  v_has_hunter_id     boolean;
BEGIN
  v_user_id := OLD.id;

  -- Detect which columns exist on bounties so this function works against
  -- both the original baseline schema (user_id/accepted_by) and the
  -- production schema (poster_id/hunter_id, plus denormalized username).
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'bounties' AND column_name = 'username'
  ) INTO v_has_username;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'bounties' AND column_name = 'user_id'
  ) INTO v_has_user_id;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'bounties' AND column_name = 'poster_id'
  ) INTO v_has_poster_id;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'bounties' AND column_name = 'accepted_by'
  ) INTO v_has_accepted_by;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'bounties' AND column_name = 'hunter_id'
  ) INTO v_has_hunter_id;

  -- 1. Handle active bounties: archive them and null out the denormalized
  -- username (and poster_id/user_id) so any denormalization trigger does not
  -- try to recompute username from the soon-to-be-deleted profile.
  IF v_has_user_id THEN
    EXECUTE format(
      'UPDATE public.bounties
         SET status = ''archived'',
             updated_at = NOW()%s
       WHERE user_id = $1
         AND status IN (''open'', ''in_progress'')',
      CASE WHEN v_has_username THEN ', username = NULL' ELSE '' END
    ) USING v_user_id;
  END IF;

  IF v_has_poster_id THEN
    EXECUTE format(
      'UPDATE public.bounties
         SET status = ''archived'',
             updated_at = NOW()%s
       WHERE poster_id = $1
         AND status IN (''open'', ''in_progress'')',
      CASE WHEN v_has_username THEN ', username = NULL' ELSE '' END
    ) USING v_user_id;
  END IF;

  -- 2. Handle escrowed funds: refund them by inserting an offsetting
  -- transaction and marking the original escrow rows completed.
  BEGIN
    INSERT INTO public.wallet_transactions (
      user_id,
      type,
      amount,
      bounty_id,
      description,
      status,
      created_at
    )
    SELECT
      NULL,
      'refund'::wallet_tx_type_enum,
      wt.amount,
      wt.bounty_id,
      'Auto-refund due to user account deletion',
      'completed'::wallet_tx_status_enum,
      NOW()
    FROM public.wallet_transactions wt
    WHERE wt.user_id = v_user_id
      AND wt.type = 'escrow'
      AND wt.status = 'pending';

    UPDATE public.wallet_transactions
       SET status = 'completed',
           updated_at = NOW()
     WHERE user_id = v_user_id
       AND type = 'escrow'
       AND status = 'pending';
  EXCEPTION
    WHEN undefined_table OR undefined_column OR undefined_object THEN
      NULL; -- wallet schema may differ; skip
  END;

  -- 3. Handle bounties where this user is the assigned hunter: release them
  -- so the bounty becomes available again (or stays in its terminal state).
  IF v_has_accepted_by THEN
    EXECUTE 'UPDATE public.bounties
                SET accepted_by = NULL,
                    status = CASE WHEN status = ''in_progress'' THEN ''open'' ELSE status END,
                    updated_at = NOW()
              WHERE accepted_by = $1'
      USING v_user_id;
  END IF;

  IF v_has_hunter_id THEN
    EXECUTE 'UPDATE public.bounties
                SET hunter_id = NULL,
                    status = CASE WHEN status = ''in_progress'' THEN ''open'' ELSE status END,
                    updated_at = NOW()
              WHERE hunter_id = $1'
      USING v_user_id;
  END IF;

  -- 4. Reject pending bounty requests from this user
  BEGIN
    UPDATE public.bounty_requests
       SET status = 'rejected',
           updated_at = NOW()
     WHERE user_id = v_user_id
       AND status = 'pending';
  EXCEPTION
    WHEN undefined_table OR undefined_column THEN
      NULL;
  END;

  -- 5. Clean up optional notification-related tables if they exist
  BEGIN
    DELETE FROM public.notifications WHERE user_id = v_user_id;
  EXCEPTION
    WHEN undefined_table THEN NULL;
  END;

  BEGIN
    DELETE FROM public.push_tokens WHERE user_id = v_user_id;
  EXCEPTION
    WHEN undefined_table THEN NULL;
  END;

  BEGIN
    DELETE FROM public.notification_preferences WHERE user_id = v_user_id;
  EXCEPTION
    WHEN undefined_table THEN NULL;
  END;

  RETURN OLD;
EXCEPTION
  WHEN OTHERS THEN
    -- Log but do not block the deletion.
    RAISE WARNING 'Error in handle_user_deletion_cleanup for user %: %', v_user_id, SQLERRM;
    RETURN OLD;
END;
$$;

-- Re-bind the trigger to be safe (function definition was replaced above).
DROP TRIGGER IF EXISTS trigger_user_deletion_cleanup ON public.profiles;
CREATE TRIGGER trigger_user_deletion_cleanup
  BEFORE DELETE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION handle_user_deletion_cleanup();

COMMENT ON FUNCTION handle_user_deletion_cleanup() IS
  'Handles cleanup of user data before profile deletion. Archives active bounties (nulling the denormalized username), refunds escrow, releases hunter assignments, rejects pending requests, and cleans up notifications. Supports both baseline (user_id/accepted_by) and production (poster_id/hunter_id, with denormalized username) bounty schemas.';

COMMIT;
