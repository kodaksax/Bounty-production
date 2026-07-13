-- Migration: Add bounty expiry notification support
-- Adds expiry_notified_at tracking column and a helper function that the
-- expire-bounties edge function calls on a schedule to enqueue expiry alerts.

-- ── 1. Tracking column ───────────────────────────────────────────────────────
-- Prevents duplicate notifications: once a bounty's expiry notification has
-- been sent, expiry_notified_at is stamped and the row is skipped thereafter.
ALTER TABLE public.bounties
  ADD COLUMN IF NOT EXISTS expiry_notified_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_bounties_expiry_notified
  ON public.bounties (end_date)
  WHERE end_date IS NOT NULL AND expiry_notified_at IS NULL;

COMMENT ON COLUMN public.bounties.expiry_notified_at IS
  'Timestamp when the poster was notified that this bounty expired. NULL means the notification has not yet been sent.';

-- ── 2. Enqueue function ──────────────────────────────────────────────────────
-- Finds all bounties whose end_date has passed, whose status is still active
-- (open or in_progress), and whose expiry notification has not yet been sent.
-- For each matching bounty it:
--   a) Inserts a row in notifications_outbox (poster as recipient).
--   b) Stamps expiry_notified_at so the bounty is never double-notified.
-- Returns the UUIDs of the newly created outbox rows so the caller can trigger
-- process-notification for each one immediately.
CREATE OR REPLACE FUNCTION public.enqueue_bounty_expiry_notifications()
RETURNS TABLE (outbox_id UUID, bounty_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec RECORD;
  new_outbox_id UUID;
BEGIN
  FOR rec IN
    SELECT
      b.id            AS bounty_id,
      b.user_id       AS poster_id,
      b.title         AS bounty_title
    FROM public.bounties b
    WHERE b.end_date IS NOT NULL
      AND b.end_date < now()
      AND b.status IN ('open', 'in_progress')
      AND b.expiry_notified_at IS NULL
    FOR UPDATE SKIP LOCKED
  LOOP
    -- Enqueue the outbox notification.
    INSERT INTO public.notifications_outbox (
      recipients,
      title,
      body,
      data,
      bounty_id
    ) VALUES (
      jsonb_build_array(rec.poster_id),
      'Bounty Expired',
      'Your bounty "' || rec.bounty_title || '" has reached its end time and is no longer active.',
      jsonb_build_object(
        'type',      'bounty_expiry',
        'bounty_id', rec.bounty_id
      ),
      rec.bounty_id::text
    )
    RETURNING id INTO new_outbox_id;

    -- Stamp the bounty so we never notify twice.
    UPDATE public.bounties
    SET expiry_notified_at = now()
    WHERE id = rec.bounty_id;

    outbox_id := new_outbox_id;
    bounty_id := rec.bounty_id;
    RETURN NEXT;
  END LOOP;
END;
$$;

-- Only service-role callers (edge functions running as service role) should
-- invoke this function; revoke from public and authenticated users.
REVOKE ALL ON FUNCTION public.enqueue_bounty_expiry_notifications() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enqueue_bounty_expiry_notifications() FROM authenticated;

NOTIFY pgrst, 'reload schema';
