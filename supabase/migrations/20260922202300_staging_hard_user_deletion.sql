-- STAGING ONLY. Do not apply to production (xwlwqzzphmmhghiqvkeu).
--
-- Repoints the existing trigger_user_deletion_cleanup (BEFORE DELETE ON
-- profiles) from handle_user_deletion_cleanup() -- which archives bounties
-- and SET NULLs most references so rows survive account deletion -- to a
-- new handle_user_deletion_cleanup_hard() that actually deletes them. Same
-- trigger name, so the existing Delete Account flow (account-deletion-
-- service.ts -> DELETE /auth/delete-account -> admin.deleteUser -> cascades
-- to profiles -> this trigger) needs zero app-code changes.
--
-- Unlike the production version, this does NOT swallow exceptions: a
-- silently-partial "hard delete" that still leaves orphaned rows defeats
-- the point, so a real failure here aborts the whole deletion and surfaces
-- an error instead of hiding it.
--
-- Schema-derived from live information_schema.table_constraints /
-- key_column_usage / referential_constraints on gwumwpoomwvkjyibdmpj as of
-- 2026-09-22 -- every FK referencing profiles(id) or bounties(id), plus a
-- handful of user_id columns with no enforced FK at all (user_activation_moments,
-- user_devices, reconciliation_findings, stripe_balance_snapshots).
--
-- Deliberately left untouched (their SET NULL / no-FK behavior is correct,
-- not an oversight):
--   - platform_ledger: comment on the table says it's designed to never
--     reference user identity ("never polluted by fake/ghost user IDs").
--   - activation_moment_repair_snapshot: its own comment says retain until
--     a specific production fix is confirmed stable.
--   - "acted as staff on someone else's record" audit columns (admin_warnings
--     .admin_id, dispute_audit_log.actor_id, dispute_appeals.reviewed_by):
--     deleting the deleted user's own rows already removes their identity;
--     nulling these instead of deleting the other party's dispute/warning
--     record preserves that record's integrity.
--
-- Also fixes a latent bug this surfaced: bounty_cancellations.responder_id,
-- bounty_cancellations.bounty_id, bounty_disputes.bounty_id, and
-- bounty_payments.bounty_id are all ON DELETE NO ACTION with nothing in the
-- existing trigger clearing them first -- so deleting a user with a live
-- cancellation/dispute/payment row today already fails with a raw FK
-- violation, on staging AND production. That's a separate, pre-existing
-- issue -- flagging it here since this migration incidentally fixes it for
-- staging by clearing those rows before the bounty delete, but it still
-- needs its own fix on production.
--
-- Applied to staging in two passes: the first version compared
-- completion_ready.bounty_id (text on this schema -- unlike every other
-- bounty_id column, which is uuid) against a uuid[] array and failed with
-- "operator does not exist: text = uuid" on the first real delete attempt.
-- This file is the corrected, single final version (casts the array side
-- for that one column) -- see the CREATE OR REPLACE below.

BEGIN;

CREATE OR REPLACE FUNCTION handle_user_deletion_cleanup_hard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := OLD.id;
  v_bounty_ids uuid[];
BEGIN
  SELECT array_agg(id) INTO v_bounty_ids
  FROM bounties
  WHERE poster_id = v_user_id OR hunter_id = v_user_id OR accepted_by = v_user_id;

  -- NO ACTION blockers on bounties/profiles -- must go before the rows they
  -- reference are deleted, or the deletion aborts with a FK violation.
  DELETE FROM bounty_cancellations
    WHERE bounty_id = ANY(v_bounty_ids) OR requester_id = v_user_id OR responder_id = v_user_id;
  DELETE FROM bounty_disputes
    WHERE bounty_id = ANY(v_bounty_ids) OR initiator_id = v_user_id OR respondent_id = v_user_id;
  DELETE FROM bounty_payments WHERE bounty_id = ANY(v_bounty_ids);
  DELETE FROM reconciliation_known_exceptions WHERE user_id = v_user_id;

  -- Conversations: delete outright (not SET NULL) so messages/participants,
  -- which CASCADE from conversations, truly disappear rather than orphan.
  DELETE FROM conversations WHERE created_by = v_user_id OR bounty_id = ANY(v_bounty_ids);
  DELETE FROM conversation_participants WHERE user_id = v_user_id;

  -- Everything else currently SET NULL on profiles(id) or bounties(id):
  -- hard-delete instead of orphaning.
  DELETE FROM wallet_transactions
    WHERE user_id = v_user_id OR sender_id = v_user_id OR receiver_id = v_user_id OR bounty_id = ANY(v_bounty_ids);
  DELETE FROM ratings WHERE from_user_id = v_user_id OR to_user_id = v_user_id OR bounty_id = ANY(v_bounty_ids);
  DELETE FROM reports WHERE reporter_id = v_user_id;
  -- bounty_id is `text` here, not uuid -- cast the array side.
  DELETE FROM completion_ready WHERE hunter_id = v_user_id OR bounty_id = ANY(v_bounty_ids::text[]);
  DELETE FROM bounty_requests WHERE hunter_id = v_user_id OR bounty_id = ANY(v_bounty_ids);
  DELETE FROM checkout_processing_failures WHERE resolved_bounty_id = ANY(v_bounty_ids);
  DELETE FROM pending_bounties WHERE resulting_bounty_id = ANY(v_bounty_ids);
  DELETE FROM admin_warnings WHERE user_id = v_user_id OR bounty_id = ANY(v_bounty_ids);
  DELETE FROM payout_audit_log WHERE user_id = v_user_id;

  -- The bounties themselves, now that their NO ACTION blockers are clear.
  -- Everything CASCADE-linked to bounties(id) (bounty_requests, bounty_hunter_notifications,
  -- bounty_moderation, bounty_v3_funding, completion_submissions, moderation_signals)
  -- is removed automatically by this delete.
  DELETE FROM bounties WHERE id = ANY(v_bounty_ids);

  -- No enforced FK at all (informal user_id columns) -- still real user data.
  DELETE FROM user_activation_moments WHERE user_id = v_user_id;
  DELETE FROM user_devices WHERE user_id = v_user_id;
  DELETE FROM reconciliation_findings WHERE user_id = v_user_id;
  DELETE FROM stripe_balance_snapshots WHERE user_id = v_user_id;

  -- Already real FK CASCADE on profiles(id) as of this writing (notifications,
  -- push_tokens, notification_preferences, skills, payment_methods, blocked_users,
  -- user_follows, hunter_service_areas, saved_locations, portfolio_items, risk_*,
  -- analytics_*, dispute_comments/evidence/resolutions/appeals via bounty_disputes,
  -- connect_balance_cache) -- no action needed, listed here for the next person
  -- auditing this function so they don't wonder why it's not handled above.

  RETURN OLD;
END;
$$;

COMMENT ON FUNCTION handle_user_deletion_cleanup_hard() IS
  'STAGING ONLY. Hard-delete version of handle_user_deletion_cleanup() -- '
  'deletes rows instead of archiving/orphaning them, and does not swallow '
  'exceptions. Never apply the trigger swap below to production.';

DROP TRIGGER IF EXISTS trigger_user_deletion_cleanup ON profiles;
CREATE TRIGGER trigger_user_deletion_cleanup
  BEFORE DELETE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION handle_user_deletion_cleanup_hard();

COMMENT ON TRIGGER trigger_user_deletion_cleanup ON profiles IS
  'STAGING ONLY: hard-deletes all rows tied to the account instead of '
  'archiving/orphaning them. Production must keep pointing this trigger at '
  'handle_user_deletion_cleanup() (the archive-and-refund version).';

COMMIT;
