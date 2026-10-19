-- Rollback for 20261019235500_bounty_events_record_poster_cancellations.sql (SBA-10).
-- Drops the AFTER DELETE ledger trigger and restores trg_bounty_events_from_bounties
-- to its pre-migration definition (pg_get_functiondef on staging and prod,
-- 2026-10-19; md5(prosrc) bce130751bbb5bfdb0f0efdfb7e360e2). bounty.cancelled
-- rows already written stay: the ledger is append-only and they are true.

BEGIN;

DROP TRIGGER IF EXISTS bounty_events_from_bounty_deletes ON public.bounties;
DROP FUNCTION IF EXISTS public.trg_bounty_events_from_bounty_delete();

CREATE OR REPLACE FUNCTION public.trg_bounty_events_from_bounties()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_stamp text;
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
    PERFORM public.record_bounty_event(
      'bounty.status:' || NEW.id || ':' || NEW.status || ':' || v_stamp,
      CASE NEW.status::text
        WHEN 'completed' THEN 'bounty.completed'
        WHEN 'cancelled' THEN 'bounty.cancelled'
        WHEN 'in_progress' THEN 'bounty.in_progress'
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

REVOKE ALL ON FUNCTION public.trg_bounty_events_from_bounties() FROM PUBLIC, anon, authenticated;

COMMIT;
