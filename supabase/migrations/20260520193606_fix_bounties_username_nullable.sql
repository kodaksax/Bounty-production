-- Backfilled from live production history during the 2026-07 migration
-- drift audit — this file did not previously exist in the repo even though
-- it was applied live (version 20260520193606). Reconstructed verbatim from
-- supabase_migrations.schema_migrations.statements so the repo matches
-- production exactly. Do not edit; if further changes are needed, add a new
-- migration instead.
ALTER TABLE public.bounties
  ALTER COLUMN username DROP NOT NULL;

CREATE OR REPLACE FUNCTION public.handle_user_deletion_cleanup()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id  uuid;
  v_username text;
BEGIN
  v_user_id  := OLD.id;
  v_username := OLD.username;

  -- 1. Handle active bounties: Archive them instead of leaving orphaned
  UPDATE bounties
  SET
    status     = 'archived',
    updated_at = NOW()
  WHERE user_id = v_user_id
    AND status IN ('open', 'in_progress');

  -- 1b. Null out the denormalised username column to anonymise deleted-user data.
  IF v_username IS NOT NULL THEN
    BEGIN
      UPDATE bounties
      SET    username   = NULL,
             updated_at = NOW()
      WHERE  username = v_username;
    EXCEPTION
      WHEN undefined_column    THEN NULL; -- column absent in this deployment
      WHEN not_null_violation  THEN NULL; -- column still NOT NULL (pre-migration state)
    END;
  END IF;

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
    AND wt.type    = 'escrow'
    AND wt.status  = 'pending';

  -- Mark original escrow transactions as completed
  UPDATE wallet_transactions
  SET
    status     = 'completed',
    updated_at = NOW()
  WHERE user_id = v_user_id
    AND type    = 'escrow'
    AND status  = 'pending';

  -- 3. Handle bounties where user is accepted hunter: reset to open
  UPDATE bounties
  SET
    accepted_by = NULL,
    status      = CASE
                    WHEN status = 'in_progress' THEN 'open'
                    ELSE status
                  END,
    updated_at  = NOW()
  WHERE accepted_by = v_user_id;

  -- 4. Reject pending bounty requests from this user
  UPDATE bounty_requests
  SET
    status     = 'rejected',
    updated_at = NOW()
  WHERE user_id = v_user_id
    AND status  = 'pending';

  -- 5. Clean up notification-related tables (may not exist in all deployments)
  BEGIN
    DELETE FROM notifications WHERE user_id = v_user_id;
  EXCEPTION
    WHEN undefined_table THEN NULL;
  END;

  BEGIN
    DELETE FROM push_tokens WHERE user_id = v_user_id;
  EXCEPTION
    WHEN undefined_table THEN NULL;
  END;

  BEGIN
    DELETE FROM notification_preferences WHERE user_id = v_user_id;
  EXCEPTION
    WHEN undefined_table THEN NULL;
  END;

  RETURN OLD;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'Error in handle_user_deletion_cleanup for user %: %', v_user_id, SQLERRM;
    RETURN OLD;
END;
$$;
