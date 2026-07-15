-- Server-side event-driven wiring for the Moments Queue (lib/moments/*).
--
-- Why triggers instead of client-side enqueue() calls for these specific
-- moments: user_activation_moments RLS only allows a user to write their own
-- row (auth.uid() = user_id). Several activation events are learned by ONE
-- user's client but target ANOTHER user's row — e.g. a poster's client
-- approves a bounty, but the resulting "rate_completed_bounty" prompt
-- belongs to the hunter. A client-side write would be silently rejected by
-- RLS. Triggers run SECURITY DEFINER (same pattern already used by
-- handle_bounty_status_notification for notifications_outbox) so they can
-- write on behalf of either party, and they fire regardless of which code
-- path mutated the row, which is what "idempotent, resilient" requires here.
--
-- Two small helper functions centralize the enqueue/complete semantics so
-- every trigger below shares one implementation (mirrors the client-side
-- momentsService.enqueue/markCompleted logic in lib/moments/momentsService.ts)
-- instead of duplicating upsert logic per trigger.

CREATE OR REPLACE FUNCTION public.fn_enqueue_activation_moment(
  p_user_id UUID,
  p_moment_type TEXT,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  existing_status TEXT;
  existing_metadata JSONB;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN;
  END IF;

  SELECT status, metadata INTO existing_status, existing_metadata
  FROM public.user_activation_moments
  WHERE user_id = p_user_id AND moment_type = p_moment_type;

  -- Already queued/visible — merge fresh metadata (e.g. a newer bountyId)
  -- rather than resetting shown_count/timestamps. Mirrors
  -- momentsService.enqueue()'s client-side behavior.
  IF existing_status IN ('shown', 'pending') THEN
    UPDATE public.user_activation_moments
    SET metadata = COALESCE(existing_metadata, '{}'::jsonb) || p_metadata,
        updated_at = now()
    WHERE user_id = p_user_id AND moment_type = p_moment_type;
    RETURN;
  END IF;

  -- Otherwise (no row, or previously dismissed/completed/expired/snoozed):
  -- (re-)arm to pending. Non-recurring moments that are already 'completed'
  -- simply won't be picked up as eligible again by the engine regardless of
  -- this row's status, so it's safe to always write 'pending' here.
  INSERT INTO public.user_activation_moments (user_id, moment_type, status, metadata)
  VALUES (p_user_id, p_moment_type, 'pending', p_metadata)
  ON CONFLICT (user_id, moment_type) DO UPDATE
    SET status = 'pending', metadata = EXCLUDED.metadata, updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_mark_activation_moment_completed(
  p_user_id UUID,
  p_moment_type TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF p_user_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.user_activation_moments (user_id, moment_type, status, completed_at)
  VALUES (p_user_id, p_moment_type, 'completed', now())
  ON CONFLICT (user_id, moment_type) DO UPDATE
    SET status = 'completed', completed_at = now();
END;
$$;

-- ---------------------------------------------------------------------
-- 1. First bounty posted — retires the "post your first bounty" nudge the
--    moment a poster actually posts one (registry.ts: post_first_bounty).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_fn_bounty_posted_activation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.fn_mark_activation_moment_completed(NEW.poster_id, 'post_first_bounty');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bounties_posted_activation ON public.bounties;
CREATE TRIGGER trg_bounties_posted_activation
  AFTER INSERT ON public.bounties
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_fn_bounty_posted_activation();

-- ---------------------------------------------------------------------
-- 2. First bounty accepted — retires the "browse and accept a bounty"
--    nudge for the hunter (registry.ts: accept_first_bounty).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_fn_bounty_accepted_activation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.status = 'in_progress'
     AND OLD.status IS DISTINCT FROM 'in_progress'
     AND NEW.accepted_by IS NOT NULL THEN
    PERFORM public.fn_mark_activation_moment_completed(NEW.accepted_by, 'accept_first_bounty');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bounties_accepted_activation ON public.bounties;
CREATE TRIGGER trg_bounties_accepted_activation
  AFTER UPDATE ON public.bounties
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_fn_bounty_accepted_activation();

-- ---------------------------------------------------------------------
-- 3. Bounty completed — queues a "post another" nudge for the poster and a
--    "rate your experience" nudge for the hunter (registry.ts:
--    bounty_completed_followup, rate_completed_bounty — both `recurring`,
--    so this fires again on every future completion, not just the first).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_fn_bounty_completed_activation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
    PERFORM public.fn_enqueue_activation_moment(
      NEW.poster_id, 'bounty_completed_followup', jsonb_build_object('bountyId', NEW.id::text)
    );
    IF NEW.accepted_by IS NOT NULL THEN
      PERFORM public.fn_enqueue_activation_moment(
        NEW.accepted_by, 'rate_completed_bounty', jsonb_build_object('bountyId', NEW.id::text)
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bounties_completed_activation ON public.bounties;
CREATE TRIGGER trg_bounties_completed_activation
  AFTER UPDATE ON public.bounties
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_fn_bounty_completed_activation();

-- ---------------------------------------------------------------------
-- 4. Large payout eligibility — queues a "withdraw now" nudge the moment a
--    Connect-onboarded user's balance crosses a threshold, regardless of
--    which RPC changed it (escrow release, refund, deposit, etc.)
--    (registry.ts: large_payout_eligible, prerequisite stripe_connect_onboarding).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_fn_large_payout_activation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.balance >= 50
     AND (OLD.balance IS NULL OR OLD.balance < 50)
     AND COALESCE(NEW.stripe_connect_payouts_enabled, false) = true THEN
    PERFORM public.fn_enqueue_activation_moment(
      NEW.id, 'large_payout_eligible', jsonb_build_object('balance', NEW.balance)
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_large_payout_activation ON public.profiles;
CREATE TRIGGER trg_profiles_large_payout_activation
  AFTER UPDATE OF balance ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_fn_large_payout_activation();

COMMENT ON FUNCTION public.fn_enqueue_activation_moment IS
  'Shared upsert used by activation triggers to (re-)arm a user_activation_moments row to pending, mirroring lib/moments/momentsService.ts enqueue() semantics.';
COMMENT ON FUNCTION public.fn_mark_activation_moment_completed IS
  'Shared upsert used by activation triggers to mark a user_activation_moments row completed, mirroring lib/moments/momentsService.ts markCompleted() semantics.';
