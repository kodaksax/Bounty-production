-- Migration: Real RLS + notifications for user_follows (replaces mock Followers feature)
-- Created: 2026-07-26
--
-- BACKGROUND: the Followers feature has been a client-side mock
-- (lib/services/follow-service.ts held an in-memory array seeded with fake
-- rows and injected a 5% random failure rate). A real table already exists --
-- public.user_follows, added in 20251001_baseline_schema.sql (lines 277-294)
-- -- with the right columns, a UNIQUE(follower_id, following_id) constraint
-- (duplicate-follow prevention) and indexes, but RLS was enabled with ZERO
-- policies ever defined. Same "enabled but totally locked, not just
-- unpoliced" situation reports/blocked_users were in before
-- 20260725150000_trust_safety_hardening.sql -- this migration is the
-- equivalent fix for user_follows, plus the missing self-follow guard and
-- the notification trigger that produces the 'follow' notifications the
-- client already knows how to render/deep-link (lib/config/notification-
-- taxonomy.ts, lib/services/notification-deep-links.ts, supabase/functions/
-- process-notification/index.ts all already handle type:'follow' /
-- data.follower_id -- nothing has ever produced one).
--
-- Depends on public.is_account_active() from
-- 20260726000000_enforce_account_status.sql (must apply first): a
-- suspended/banned user should not be able to follow anyone either.

-- ============================================================================
-- 1. Self-follow guard
-- ============================================================================
ALTER TABLE public.user_follows
  DROP CONSTRAINT IF EXISTS user_follows_no_self_follow;
ALTER TABLE public.user_follows
  ADD CONSTRAINT user_follows_no_self_follow CHECK (follower_id <> following_id);

-- ============================================================================
-- 2. RLS -- open read (follower/following relationships are public-facing by
--    product design, same as follower/following counts shown on profiles),
--    self-scoped write.
-- ============================================================================
DROP POLICY IF EXISTS "user_follows_select_all" ON public.user_follows;
CREATE POLICY "user_follows_select_all"
  ON public.user_follows
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "user_follows_insert_own" ON public.user_follows;
CREATE POLICY "user_follows_insert_own"
  ON public.user_follows
  FOR INSERT
  TO authenticated
  WITH CHECK (follower_id = auth.uid() AND public.is_account_active(auth.uid()));

DROP POLICY IF EXISTS "user_follows_delete_own" ON public.user_follows;
CREATE POLICY "user_follows_delete_own"
  ON public.user_follows
  FOR DELETE
  TO authenticated
  USING (follower_id = auth.uid());

GRANT SELECT, INSERT, DELETE ON public.user_follows TO authenticated;

-- ============================================================================
-- 2b. Realtime -- required for lib/services/follow-realtime.ts's
--     postgres_changes subscription to receive anything at all. Confirmed
--     via 20260722042019_add_realtime_publication_tables.sql's own findings:
--     tables are NOT broadcast over realtime just by existing/having RLS --
--     they must be explicitly added to the supabase_realtime publication.
--     DELETE events are filtered on following_id, which is not user_follows'
--     primary key (id is) -- default REPLICA IDENTITY only ships PK columns
--     in the old-row payload, so a following_id=eq.<uuid> filter on DELETE
--     would never match without full old-row data (same fix already applied
--     to bounty_requests for the same reason).
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'user_follows'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.user_follows;
  END IF;
END;
$$;

ALTER TABLE public.user_follows REPLICA IDENTITY FULL;

-- ============================================================================
-- 3. Notification trigger -- direct-insert style (one follow = one
--    notification, not a rapid-fire case that needs the bundling helper),
--    modeled on handle_bounty_request_notification from
--    20260322_serverless_notification_triggers.sql. Reuses get_username(),
--    already defined in that same migration.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.handle_new_follow_notification()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.notifications_outbox (recipients, title, body, data)
  VALUES (
    jsonb_build_array(NEW.following_id),
    'New Follower',
    public.get_username(NEW.follower_id) || ' started following you',
    jsonb_build_object('type', 'follow', 'follower_id', NEW.follower_id)
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_new_follow_notification ON public.user_follows;
CREATE TRIGGER trg_new_follow_notification
  AFTER INSERT ON public.user_follows
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_follow_notification();

NOTIFY pgrst, 'reload schema';
