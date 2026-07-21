-- Migration: Fix phantom-column bug in handle_user_deletion_cleanup()
-- Created: 2026-07-19
--
-- BACKGROUND: 20251117_safe_user_deletion.sql's handle_user_deletion_cleanup()
-- trigger function (fires BEFORE DELETE ON profiles) contains:
--   UPDATE bounty_requests SET status = 'rejected', updated_at = NOW()
--   WHERE user_id = v_user_id AND status = 'pending';
-- `bounty_requests` has never had a `user_id` column -- confirmed via
-- information_schema.columns and its own creation migration
-- (20251119_add_bounty_requests_table.sql), which defines `hunter_id`
-- ("the canonical applicant reference to profiles.id") and `poster_id`
-- ("for denormalization"), never `user_id`. Same phantom-column bug class
-- already found and removed from this migration's ALTER TABLE blocks in
-- bb2618b5 -- this is the third, previously-undiagnosed instance, inside the
-- function body, which is why it didn't block migration replay (plpgsql
-- function bodies aren't validated against referenced tables until they
-- execute) but has been silently failing at runtime instead.
--
-- IMPACT UNTIL NOW: whenever a profile was actually deleted, this specific
-- cleanup step ("Reject pending bounty requests from this user") threw
-- `42703: column "user_id" does not exist`, caught by the function's own
-- top-level `EXCEPTION WHEN OTHERS` handler (RAISE WARNING + RETURN OLD) --
-- so the deletion itself always succeeded, but a deleted hunter's pending
-- bounty_requests rows were silently left in 'pending' status instead of
-- being rejected. Low severity (fails safe, no data corruption, no blocked
-- deletions) but a real, live bug since 2025-11-17.
--
-- WHY hunter_id and not poster_id: the trigger's own comment says "Reject
-- pending bounty requests FROM this user" -- i.e. requests this user
-- submitted as an applicant, not bounties they posted. `hunter_id` is
-- documented at the table's creation as exactly that: "the canonical
-- applicant reference". `poster_id` denotes the bounty owner, a different
-- relationship already handled separately by this same function's bounties
-- cleanup steps (archiving the user's own posted bounties, clearing
-- accepted_by on bounties they were hired for). Cross-checked against the
-- one other place in the schema that programmatically rejects
-- bounty_requests rows (20260323_add_fn_accept_bounty_request.sql's
-- accept_bounty_request()), which confirms `hunter_id`/`status` is the
-- established column pair for this kind of update, just scoped by
-- `bounty_id` there instead of by applicant.
--
-- This is a pure CREATE OR REPLACE of the existing function -- no signature
-- change, no new columns/tables, every other cleanup step unchanged
-- byte-for-byte from 20251117_safe_user_deletion.sql. Safe to apply live:
-- the function's own exception handler means the previous (buggy) behavior
-- was already "fail safe", so this can only improve correctness, never
-- newly break a deletion that previously succeeded.

CREATE OR REPLACE FUNCTION handle_user_deletion_cleanup()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  v_user_id := OLD.id;

  -- 1. Handle active bounties: Archive them instead of leaving orphaned
  UPDATE bounties
  SET
    status = 'archived',
    updated_at = NOW()
  WHERE user_id = v_user_id
    AND status IN ('open', 'in_progress');

  -- 2. Handle escrowed funds: Release them back (create refund transactions)
  INSERT INTO wallet_transactions (
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
  FROM wallet_transactions wt
  WHERE wt.user_id = v_user_id
    AND wt.type = 'escrow'
    AND wt.status = 'pending';

  UPDATE wallet_transactions
  SET
    status = 'completed',
    updated_at = NOW()
  WHERE user_id = v_user_id
    AND type = 'escrow'
    AND status = 'pending';

  -- 3. Handle bounties where user is accepted hunter: Set accepted_by to NULL
  UPDATE bounties
  SET
    accepted_by = NULL,
    status = CASE
      WHEN status = 'in_progress' THEN 'open'
      ELSE status
    END,
    updated_at = NOW()
  WHERE accepted_by = v_user_id;

  -- 4. Reject pending bounty requests from this user
  -- FIXED 2026-07-19: was `WHERE user_id = v_user_id` (phantom column,
  -- always errored, silently caught below) -- bounty_requests' applicant
  -- reference is `hunter_id`, see this migration's header comment.
  UPDATE bounty_requests
  SET
    status = 'rejected',
    updated_at = NOW()
  WHERE hunter_id = v_user_id
    AND status = 'pending';

  -- 5. Clean up notification-related tables if they exist
  BEGIN
    DELETE FROM notifications WHERE user_id = v_user_id;
  EXCEPTION
    WHEN undefined_table THEN
      NULL;
  END;

  BEGIN
    DELETE FROM push_tokens WHERE user_id = v_user_id;
  EXCEPTION
    WHEN undefined_table THEN
      NULL;
  END;

  BEGIN
    DELETE FROM notification_preferences WHERE user_id = v_user_id;
  EXCEPTION
    WHEN undefined_table THEN
      NULL;
  END;

  RETURN OLD;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'Error in handle_user_deletion_cleanup for user %: %', v_user_id, SQLERRM;
    RETURN OLD;
END;
$$;

COMMENT ON FUNCTION handle_user_deletion_cleanup() IS
  'Handles cleanup of user data before profile deletion. Archives active bounties, refunds escrow, rejects the user''s own pending bounty_requests (by hunter_id, fixed 2026-07-19 -- see this migration), and cleans up references.';
