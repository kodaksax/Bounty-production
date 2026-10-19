-- SBA-10: a poster's cancellation reaches the bounty_events ledger.
--
-- A poster ends an open, unhired bounty by deleting it — the Inbox row's trash
-- icon and, from this release, the bounty screen's "Cancel and refund" (both
-- lib/services/bounty-cancel-refund.ts -> bountyService.delete). That is a
-- hard DELETE, or, when bounty_payments rows reference the bounty (FK 23503),
-- a soft UPDATE status -> 'deleted'.
--
-- Neither looked like a cancellation in the ledger:
--   * bounty_events_from_bounties fires AFTER INSERT OR UPDATE only, so a hard
--     DELETE wrote nothing at all. The listing just vanished, which the
--     2026-10-15 behavioural audit could only read as abandonment.
--   * the soft delete was recorded as a generic 'bounty.status_changed'.
-- In the 60 days to 2026-10-19 prod recorded 20 bounty.cancelled events and 0
-- for any delete.
--
-- Fix (no new event type: 'bounty.cancelled' is the existing concept, and
-- the Command Center already labels and filters it):
--   (1) AFTER DELETE trigger -> 'bounty.cancelled' for a bounty that had not
--       already ended (open / draft / any non-terminal status). A row that was
--       already cancelled / deleted / archived / completed had its ending
--       recorded when it happened, so tidying it away adds nothing.
--   (2) trg_bounty_events_from_bounties: an UPDATE open -> deleted with nobody
--       hired is 'bounty.cancelled' instead of 'bounty.status_changed'. Same
--       event_key as before, so replays stay idempotent. Everything else is
--       the live definition unchanged (identical on staging and prod,
--       md5(prosrc) bce130751bbb5bfdb0f0efdfb7e360e2 on 2026-10-19); the
--       status CASE is rewritten from simple to searched form to add the arm.
-- metadata.via ('delete' | 'soft_delete') and metadata.by_poster tell a
-- poster's own cancellation from an admin or service-role removal.
--
-- bounty_events has no FK to bounties, so a row written for a deleted bounty
-- survives the delete. Like every bounty_events trigger, failures are
-- swallowed with a WARNING: observability must never block the delete.
--
-- Rollback: supabase/rollbacks/production/20261019235500_bounty_events_record_poster_cancellations.down.sql

BEGIN;

-- ── (1) Hard deletes ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_bounty_events_from_bounty_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor  uuid;
  v_poster uuid;
BEGIN
  -- Assigned here, not in DECLARE: an error in a DECLARE initialiser is
  -- raised outside this block's EXCEPTION handler and would abort the delete.
  v_actor  := auth.uid();
  v_poster := COALESCE(OLD.poster_id, OLD.user_id);

  IF OLD.status::text IN ('cancelled', 'deleted', 'archived', 'completed') THEN
    RETURN NULL;
  END IF;

  PERFORM public.record_bounty_event(
    'bounty.deleted:' || OLD.id,
    'bounty.cancelled',
    CASE WHEN v_actor IS NULL THEN 'system' ELSE 'app' END,
    OLD.id,
    COALESCE(v_actor, v_poster),
    now(),
    CASE WHEN COALESCE(OLD.is_for_honor, false) THEN NULL ELSE OLD.amount END,
    NULL,
    jsonb_build_object(
      'from', OLD.status,
      'to', 'deleted',
      'via', 'delete',
      'by_poster', v_actor IS NOT NULL AND v_actor = v_poster,
      'poster_id', v_poster,
      'hunter_id', OLD.accepted_by,
      'funding_mode', OLD.funding_mode,
      'is_for_honor', COALESCE(OLD.is_for_honor, false),
      -- The row is gone after this, so carry what the "genuine" filter needs.
      'is_test', COALESCE(OLD.is_test, false)
    )
  );
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- Observability must never break the marketplace.
  RAISE WARNING 'bounty_events: bounty delete trigger suppressed error: %', SQLERRM;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.trg_bounty_events_from_bounty_delete() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS bounty_events_from_bounty_deletes ON public.bounties;
CREATE TRIGGER bounty_events_from_bounty_deletes
  AFTER DELETE ON public.bounties
  FOR EACH ROW EXECUTE FUNCTION public.trg_bounty_events_from_bounty_delete();

-- ── (2) Soft deletes ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_bounty_events_from_bounties()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_stamp text;
  v_poster_cancel boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.record_bounty_event(
      'bounty.posted:' || NEW.id,
      'bounty.posted',
      'app',
      NEW.id,
      COALESCE(NEW.poster_id, NEW.user_id),
      NEW.created_at,
      CASE WHEN COALESCE(NEW.is_for_honor, false) THEN NULL ELSE NEW.amount END,
      NULL,
      jsonb_build_object(
        'title', NEW.title,
        'category', NEW.category,
        'is_for_honor', COALESCE(NEW.is_for_honor, false),
        'funding_mode', NEW.funding_mode,
        'payment_architecture_version', NEW.payment_architecture_version
      )
    );
    RETURN NULL;
  END IF;

  -- A transition is keyed on the row's own updated_at, so the same UPDATE
  -- replayed produces the same key while a genuine later transition to the
  -- same status (open -> in_progress -> open -> in_progress) does not collide.
  v_stamp := to_char(COALESCE(NEW.updated_at, now()) AT TIME ZONE 'UTC', 'YYYYMMDD"T"HH24MISS.US');

  IF NEW.accepted_by IS DISTINCT FROM OLD.accepted_by AND NEW.accepted_by IS NOT NULL THEN
    PERFORM public.record_bounty_event(
      'bounty.accepted:' || NEW.id || ':' || NEW.accepted_by,
      'bounty.accepted',
      'app',
      NEW.id,
      NEW.accepted_by,
      COALESCE(NEW.updated_at, now()),
      CASE WHEN COALESCE(NEW.is_for_honor, false) THEN NULL ELSE NEW.amount END,
      NULL,
      jsonb_build_object('poster_id', COALESCE(NEW.poster_id, NEW.user_id), 'hunter_id', NEW.accepted_by)
    );
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    -- SBA-10: soft-deleting an open bounty nobody was hired for is the poster
    -- cancelling it (bountyService.delete's FK fallback), not a tidy-up.
    v_poster_cancel := NEW.status::text = 'deleted'
                       AND OLD.status::text = 'open'
                       AND OLD.accepted_by IS NULL;
    PERFORM public.record_bounty_event(
      'bounty.status:' || NEW.id || ':' || NEW.status || ':' || v_stamp,
      CASE
        WHEN NEW.status::text = 'completed' THEN 'bounty.completed'
        WHEN NEW.status::text = 'cancelled' THEN 'bounty.cancelled'
        WHEN NEW.status::text = 'in_progress' THEN 'bounty.in_progress'
        WHEN v_poster_cancel THEN 'bounty.cancelled'
        ELSE 'bounty.status_changed'
      END,
      'app',
      NEW.id,
      COALESCE(NEW.poster_id, NEW.user_id),
      COALESCE(
        CASE WHEN NEW.status::text = 'completed' THEN NEW.completed_at AT TIME ZONE 'UTC' END,
        NEW.updated_at,
        now()
      ),
      CASE WHEN COALESCE(NEW.is_for_honor, false) THEN NULL ELSE NEW.amount END,
      NULL,
      jsonb_build_object('from', OLD.status, 'to', NEW.status, 'hunter_id', NEW.accepted_by)
        || CASE WHEN v_poster_cancel THEN
             jsonb_build_object(
               'via', 'soft_delete',
               'by_poster', auth.uid() IS NOT NULL AND auth.uid() = COALESCE(NEW.poster_id, NEW.user_id)
             )
           ELSE '{}'::jsonb END
    );
  END IF;

  IF COALESCE(NEW.is_stale, false) AND NOT COALESCE(OLD.is_stale, false) THEN
    PERFORM public.record_bounty_event(
      'bounty.stale:' || NEW.id || ':' || v_stamp,
      'bounty.flagged_stale',
      'system',
      NEW.id,
      NULL,
      COALESCE(NEW.stale_detected_at, NEW.updated_at, now()),
      NULL,
      NULL,
      jsonb_build_object('reason', NEW.stale_reason)
    );
  END IF;

  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- Observability must never break the marketplace.
  RAISE WARNING 'bounty_events: bounties trigger suppressed error: %', SQLERRM;
  RETURN NULL;
END;
$function$;

-- CREATE OR REPLACE keeps the existing grants; restate the revoke from
-- 20260919110000 so this file is correct on its own.
REVOKE ALL ON FUNCTION public.trg_bounty_events_from_bounties() FROM PUBLIC, anon, authenticated;

COMMIT;
