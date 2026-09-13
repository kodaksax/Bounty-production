-- Problem (found 2026-09-13 while investigating a bad internal-vs-external
-- bounty split): 30 of 152 live bounties have BOTH poster_id and user_id
-- NULL, 16 of them status='completed'. Root cause: both columns carry an
-- independent `ON DELETE SET NULL` FK to profiles, and nothing else in the
-- schema retains an unconstrained trace of who posted a bounty. Deleting a
-- poster's profile (the documented account-deletion path,
-- supabase/functions/auth/index.ts -> admin.deleteUser) silently strips
-- ownership from every bounty they ever posted, completed ones included, and
-- also hard-deletes every bounty_requests row where they're the poster
-- (that FK is NOT NULL + ON DELETE CASCADE, not SET NULL) -- so the
-- application history for an orphaned bounty is gone too, not just nulled.
--
-- Recovery dry run against all 30 orphaned rows, checked before writing
-- anything:
--   * bounty_requests.poster_id : 0/30 recoverable (rows CASCADE-deleted
--     alongside the same profile, confirmed 0 request rows remain for any
--     of the 30)
--   * wallet_transactions escrow : 0/30 recoverable (user_id/sender_id/
--     receiver_id carry the same SET NULL FK, nulled in the same cascade)
--   * completion_submissions     : 0/30 -- table has no poster column at all
--   * bounty_payments.poster_id  : 1/30 -- the only one of the four with NO
--     FK to profiles. Only 1 of the 30 orphans even has a bounty_payments
--     row: "Clean my yard" (bdaa3028-a805-4599-8c0b-ecc34efac6a9) ->
--     313c5064-c9a4-47ad-9127-935e384eb6d4, confirmed still a live profile.
-- Recovery rate: 1/30 (3.3%). The other 29 are permanently unrecoverable --
-- no table anywhere in this schema retains a reference to those posters;
-- report 29, not 0, as the count that keeps falling out of internal/external
-- splits.
--
-- Fix, in order:
--   1. Backfill the one recoverable row.
--   2. Add bounties.former_poster_id (deliberately NOT FK-constrained) and
--      have handle_user_deletion_cleanup() snapshot it for every bounty the
--      departing user owns -- matched on (poster_id OR user_id), same
--      predicate as the archival step below (both were updated together:
--      the archival UPDATE previously checked only user_id, a latent bug
--      dormant only because poster_id and user_id are always dual-written
--      identically today -- 122/152 bounties have both set, 0 have only
--      one). Snapshotting happens inside this BEFORE DELETE trigger, i.e.
--      before Postgres processes either column's ON DELETE SET NULL
--      cascade, so it captures the real owner every time regardless of
--      which column the caller happens to populate.
--   3. Add the ownership floor as CHECK (...) NOT VALID against all three
--      columns (poster_id, user_id, former_poster_id), not just the live
--      pair. NOT VALID exempts the 29 legacy orphans from the initial scan
--      (no fabricated data needed for rows nobody can identify) while still
--      rejecting every future insert/update that would leave a bounty with
--      no owner trace at all. A bare CHECK on just poster_id/user_id was
--      considered and rejected: since both columns are always dual-written
--      today, that version would be violated by the FK cascade's own UPDATE
--      the next time ANY user who has ever posted a bounty deletes their
--      account (122/152 of them), turning routine account deletion into a
--      hard failure. Snapshotting into a column the FK can't touch avoids
--      that regression entirely.

BEGIN;

-- ─── 1. Backfill the one verified-recoverable row ──────────────────────────
UPDATE public.bounties
SET poster_id = '313c5064-c9a4-47ad-9127-935e384eb6d4',
    user_id   = '313c5064-c9a4-47ad-9127-935e384eb6d4'
WHERE id = 'bdaa3028-a805-4599-8c0b-ecc34efac6a9'
  AND poster_id IS NULL
  AND user_id IS NULL;

-- ─── 2. Durable, unconstrained ownership snapshot ──────────────────────────
ALTER TABLE public.bounties
  ADD COLUMN IF NOT EXISTS former_poster_id uuid;

COMMENT ON COLUMN public.bounties.former_poster_id IS
  'Snapshot of poster_id/user_id captured by handle_user_deletion_cleanup() the moment the poster''s profile is deleted -- deliberately NOT a foreign key, so it survives the profile row being gone. Exists purely so every bounty keeps at least one trace of who created it even after account deletion nulls the live owner columns; never written by app code, never updated once set.';

CREATE OR REPLACE FUNCTION public.handle_user_deletion_cleanup()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  v_user_id := OLD.id;

  -- Snapshot ownership before either FK's ON DELETE SET NULL cascades.
  -- Matches poster_id OR user_id, same predicate as the archival UPDATE
  -- just below, so both steps agree on ownership regardless of which
  -- column a given bounty happens to have populated.
  UPDATE bounties
  SET former_poster_id = v_user_id
  WHERE (poster_id = v_user_id OR user_id = v_user_id)
    AND former_poster_id IS NULL;

  UPDATE bounties
  SET
    status = 'archived',
    updated_at = NOW()
  WHERE (poster_id = v_user_id OR user_id = v_user_id)
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

  UPDATE bounties
  SET
    accepted_by = NULL,
    status = CASE
      WHEN status = 'in_progress' THEN 'open'
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
$$;

-- ─── 3. Ownership floor, enforced only going forward ───────────────────────
ALTER TABLE public.bounties
  ADD CONSTRAINT bounties_owner_reference_required
  CHECK (poster_id IS NOT NULL OR user_id IS NOT NULL OR former_poster_id IS NOT NULL)
  NOT VALID;

COMMIT;
