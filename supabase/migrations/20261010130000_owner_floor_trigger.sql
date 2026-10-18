-- Account deletion failed with bounties_owner_reference_required for any
-- user who had accepted one of the legacy ownerless bounties (poster_id,
-- user_id, former_poster_id all NULL; see 20260913211432). Postgres
-- re-checks a NOT VALID CHECK on every UPDATE, so
-- handle_user_deletion_cleanup()'s `accepted_by = NULL` (and the
-- accepted_by FK's own SET NULL) on those rows raised. The trigger's
-- WHEN OTHERS handler then rolled back its former_poster_id snapshot too,
-- and the delete died on the same check. 20261001160000 had to drop and
-- re-add the constraint just to scrub locations for the same reason.
--
-- The CHECK can't see OLD, so replace it with a trigger enforcing the same
-- intent: no new ownerless bounty, and no UPDATE that strips the last owner
-- reference. Rows that were already ownerless can still be updated.
--
-- Also: the cleanup no longer reopens an ownerless bounty to 'open' when its
-- hunter leaves (it would surface on the board with nobody to manage it, and
-- eccfddee still holds $5 escrow) -- those are archived instead.

ALTER TABLE public.bounties DROP CONSTRAINT IF EXISTS bounties_owner_reference_required;

CREATE OR REPLACE FUNCTION public.enforce_bounty_owner_reference()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.poster_id IS NULL AND NEW.user_id IS NULL AND NEW.former_poster_id IS NULL
     AND (TG_OP = 'INSERT'
          OR OLD.poster_id IS NOT NULL OR OLD.user_id IS NOT NULL OR OLD.former_poster_id IS NOT NULL)
  THEN
    RAISE EXCEPTION 'new row for relation "bounties" violates owner reference floor'
      USING ERRCODE = 'check_violation',
            CONSTRAINT = 'bounties_owner_reference_required';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enforce_bounty_owner_reference() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_bounties_owner_reference_required ON public.bounties;
CREATE TRIGGER trg_bounties_owner_reference_required
  BEFORE INSERT OR UPDATE OF poster_id, user_id, former_poster_id ON public.bounties
  FOR EACH ROW EXECUTE FUNCTION public.enforce_bounty_owner_reference();

-- Redefined from prod's pg_get_functiondef; only the accepted_by step changed.
CREATE OR REPLACE FUNCTION public.handle_user_deletion_cleanup()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
BEGIN
  v_user_id := OLD.id;

  -- Snapshot ownership before either FK's ON DELETE SET NULL cascades.
  -- Matches poster_id OR user_id -- the archival UPDATE just below only ever
  -- checked user_id, which happens to be harmless today only because the two
  -- columns are always dual-written identically; this snapshot doesn't rely
  -- on that staying true.
  UPDATE bounties
  SET former_poster_id = v_user_id
  WHERE (poster_id = v_user_id OR user_id = v_user_id)
    AND former_poster_id IS NULL;

  UPDATE bounties
  SET
    status = 'archived',
    updated_at = NOW()
  WHERE user_id = v_user_id
    AND status IN ('open', 'in_progress');

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

  -- Ownerless legacy bounties are archived rather than reopened: nobody
  -- could manage them on the board.
  UPDATE bounties
  SET
    accepted_by = NULL,
    status = CASE
      WHEN status = 'in_progress'
        AND (poster_id IS NOT NULL OR user_id IS NOT NULL) THEN 'open'
      WHEN status = 'in_progress' THEN 'archived'
      ELSE status
    END,
    updated_at = NOW()
  WHERE accepted_by = v_user_id;

  UPDATE bounty_requests
  SET
    status = 'rejected',
    updated_at = NOW()
  WHERE hunter_id = v_user_id
    AND status = 'pending';

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
$function$;
