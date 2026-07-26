-- Notification redesign, migration 1/6: category taxonomy + type CHECK extension.
--
-- Pre-flight (run manually against prod before applying, already done once during
-- planning): SELECT DISTINCT type FROM notifications; SELECT DISTINCT data->>'type'
-- FROM notifications_outbox; — confirms every value below is either already live
-- or net-new, so nothing currently in the table gets rejected by the new CHECK.
--
-- This migration also fixes a real production bug: process-notification/index.ts
-- inserts into `notifications` using the outbox row's `data.type` (e.g. 'update',
-- 'review_needed', 'balance_update', 'bounty_nearby'), but those values were never
-- in the CHECK constraint, so the insert has been silently failing (caught and
-- logged as "non-fatal") for every one of those types while the push notification
-- still sends. Extending the CHECK stops the silent data loss.

BEGIN;

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
  CHECK (type = ANY (ARRAY[
    -- existing values (unchanged)
    'application', 'acceptance', 'completion', 'payment', 'message', 'follow',
    'cancellation_request', 'cancellation_accepted', 'cancellation_rejected',
    'dispute_created', 'dispute_resolved', 'workflow_dispute_created',
    'stale_bounty', 'stale_bounty_cancelled', 'stale_bounty_reposted',
    -- already live in notifications_outbox.data->>'type' but missing from the
    -- old CHECK (root cause of the silent-drop bug described above)
    'update', 'review_needed', 'balance_update', 'bounty_nearby', 'bounty_expiry',
    -- already whitelisted in send_system_notification() but missing here
    'dispute_escalated',
    -- new: security
    'account_warning', 'account_restricted',
    -- new: payments (split out of the generic 'payment' type)
    'payout_paid', 'payout_failed', 'payout_canceled', 'withdrawal_reversed',
    'bank_disconnected', 'payout_method_changed',
    -- new: verification (Stripe Identity)
    'verification_submitted', 'verification_verified', 'verification_rejected',
    'verification_canceled',
    -- new: marketing
    'marketing_promo'
  ]::text[]));

-- Redundant category column so every reader (Notification Center filters/search,
-- edge function preference lookups) can do a plain indexed `WHERE category = $1`
-- instead of re-deriving category from type via a big CASE/IN list every time.
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS category text;

UPDATE public.notifications SET category = CASE
  WHEN type IN ('application','acceptance','completion','cancellation_request',
                'cancellation_accepted','cancellation_rejected','stale_bounty',
                'stale_bounty_cancelled','stale_bounty_reposted','update',
                'bounty_nearby','bounty_expiry','review_needed') THEN 'marketplace'
  WHEN type = 'message' THEN 'messages'
  WHEN type IN ('payment','payout_paid','payout_failed','payout_canceled',
                'withdrawal_reversed','bank_disconnected','payout_method_changed',
                'balance_update') THEN 'payments'
  WHEN type IN ('dispute_created','dispute_resolved','workflow_dispute_created',
                'dispute_escalated','account_warning','account_restricted') THEN 'security'
  WHEN type IN ('verification_submitted','verification_verified',
                'verification_rejected','verification_canceled') THEN 'verification'
  WHEN type = 'follow' THEN 'followers'
  WHEN type = 'marketing_promo' THEN 'marketing'
  ELSE 'marketplace' -- safe default for any unforeseen legacy value
END
WHERE category IS NULL;

ALTER TABLE public.notifications ADD CONSTRAINT notifications_category_check
  CHECK (category IN ('marketplace','messages','payments','security','verification','followers','marketing'));

CREATE INDEX IF NOT EXISTS idx_notifications_user_category
  ON public.notifications (user_id, category, created_at DESC);

-- Extend the client-callable cross-user insert RPC's whitelist to match the new
-- CHECK constraint (dispute_escalated was already allowed here but rejected by
-- the old CHECK — that mismatch is fixed by this migration too).
CREATE OR REPLACE FUNCTION public.send_system_notification(
  p_user_id  UUID,
  p_type     TEXT,
  p_title    TEXT,
  p_body     TEXT,
  p_data     JSONB DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_type NOT IN (
    'dispute_created',
    'dispute_resolved',
    'dispute_escalated',
    'workflow_dispute_created',
    'account_warning',
    'account_restricted',
    'verification_submitted',
    'verification_verified',
    'verification_rejected',
    'verification_canceled'
  ) THEN
    RAISE EXCEPTION 'Unsupported notification type: %', p_type;
  END IF;

  INSERT INTO public.notifications (user_id, type, category, title, body, data, read)
  VALUES (p_user_id, p_type, CASE
    WHEN p_type IN ('dispute_created','dispute_resolved','dispute_escalated',
                     'workflow_dispute_created','account_warning','account_restricted') THEN 'security'
    WHEN p_type IN ('verification_submitted','verification_verified',
                     'verification_rejected','verification_canceled') THEN 'verification'
  END, p_title, p_body, p_data, false);
END;
$$;

REVOKE ALL ON FUNCTION public.send_system_notification(UUID, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.send_system_notification(UUID, TEXT, TEXT, TEXT, JSONB) TO authenticated;

COMMIT;
