-- Migration: Comprehensive Row Level Security Policies
-- Description: Add RLS policies to all public tables missing security
-- Date: 2025-12-02
--
-- This migration addresses the following security issues:
-- 1. Fix public_profiles view (SECURITY DEFINER -> SECURITY INVOKER)
-- 2. Enable RLS on all public tables that are missing it
-- 3. Add appropriate policies for each table based on application requirements
--
-- Tables addressed:
-- - users
-- - user_ratings
-- - outbox_events
-- - ratings
-- - reports
-- - blocked_users
-- - skills
-- - bounties
-- - notifications
-- - wallet_transactions
-- - push_tokens
-- - completion_ready
-- - moderation_actions
-- - notification_preferences
-- - completion_submissions
-- - bounty_cancellations
-- - bounty_disputes

BEGIN;

-- ============================================================================
-- 1. FIX: public_profiles VIEW (SECURITY DEFINER -> SECURITY INVOKER)
-- ============================================================================
-- If the public_profiles view exists with SECURITY DEFINER, recreate it with SECURITY INVOKER
-- This ensures the view respects the querying user's permissions

DO $$ 
BEGIN
  -- Check if the view exists
  IF EXISTS (SELECT 1 FROM pg_views WHERE viewname = 'public_profiles' AND schemaname = 'public') THEN
    -- Drop and recreate with SECURITY INVOKER (the default, more secure option)
    DROP VIEW IF EXISTS public.public_profiles;
    
    -- Recreate the view without SECURITY DEFINER
    -- This shows basic profile info that should be publicly visible
    CREATE VIEW public.public_profiles AS
    SELECT 
      p.id,
      p.username,
      p.avatar,
      p.about,
      p.created_at
    FROM public.profiles p;
    
    -- Add comment
    COMMENT ON VIEW public.public_profiles IS 
      'Public profile information visible to all authenticated users. Uses SECURITY INVOKER (default) to respect RLS policies.';
  END IF;
END $$;

-- ============================================================================
-- 2. USERS TABLE RLS
-- ============================================================================
-- Note: The issue references "users" table but the main user table in this
-- schema is "profiles". We'll enable RLS on "users" if it exists.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'users' AND schemaname = 'public') THEN
    EXECUTE 'ALTER TABLE public.users ENABLE ROW LEVEL SECURITY';
    
    -- Drop existing policies if any
    DROP POLICY IF EXISTS "users_select_all" ON public.users;
    DROP POLICY IF EXISTS "users_insert_own" ON public.users;
    DROP POLICY IF EXISTS "users_update_own" ON public.users;
    DROP POLICY IF EXISTS "users_delete_own" ON public.users;
    
    -- Everyone can view users (public profiles)
    CREATE POLICY "users_select_all" ON public.users
      FOR SELECT
      USING (true);
    
    -- Users can only insert their own record
    CREATE POLICY "users_insert_own" ON public.users
      FOR INSERT
      WITH CHECK (auth.uid() = id);
    
    -- Users can only update their own record
    CREATE POLICY "users_update_own" ON public.users
      FOR UPDATE
      USING (auth.uid() = id)
      WITH CHECK (auth.uid() = id);
    
    -- Users can only delete their own record
    CREATE POLICY "users_delete_own" ON public.users
      FOR DELETE
      USING (auth.uid() = id);
  END IF;
END $$;

-- ============================================================================
-- 3. USER_RATINGS TABLE RLS
-- ============================================================================
-- Note: The schema defines "ratings" table. user_ratings may be an alias or 
-- separate table. We'll handle both.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'user_ratings' AND schemaname = 'public') THEN
    EXECUTE 'ALTER TABLE public.user_ratings ENABLE ROW LEVEL SECURITY';
    
    -- Drop existing policies if any
    DROP POLICY IF EXISTS "user_ratings_select_all" ON public.user_ratings;
    DROP POLICY IF EXISTS "user_ratings_insert_rater" ON public.user_ratings;
    DROP POLICY IF EXISTS "user_ratings_update_rater" ON public.user_ratings;
    DROP POLICY IF EXISTS "user_ratings_delete_rater" ON public.user_ratings;
    
    -- Everyone can view ratings (for reputation transparency)
    CREATE POLICY "user_ratings_select_all" ON public.user_ratings
      FOR SELECT
      USING (true);
    
    -- Only the rater can insert their ratings
    CREATE POLICY "user_ratings_insert_rater" ON public.user_ratings
      FOR INSERT
      WITH CHECK (auth.uid() = rater_id);
    
    -- Raters can update their own ratings
    CREATE POLICY "user_ratings_update_rater" ON public.user_ratings
      FOR UPDATE
      USING (auth.uid() = rater_id)
      WITH CHECK (auth.uid() = rater_id);
    
    -- Raters can delete their own ratings
    CREATE POLICY "user_ratings_delete_rater" ON public.user_ratings
      FOR DELETE
      USING (auth.uid() = rater_id);
  END IF;
END $$;

-- ============================================================================
-- 4. OUTBOX_EVENTS TABLE RLS
-- ============================================================================
-- Outbox events are for internal backend processing only (event sourcing).
-- No user access should be allowed - only service role can access.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'outbox_events' AND schemaname = 'public') THEN
    EXECUTE 'ALTER TABLE public.outbox_events ENABLE ROW LEVEL SECURITY';
    
    -- Drop existing policies if any
    DROP POLICY IF EXISTS "outbox_events_no_access" ON public.outbox_events;
    
    -- No user access - service role bypasses RLS
    -- This effectively blocks all access for authenticated users
    CREATE POLICY "outbox_events_no_access" ON public.outbox_events
      FOR ALL
      USING (false);
    
    RAISE NOTICE 'RLS enabled for outbox_events - backend only access via service role';
  END IF;
END $$;

-- ============================================================================
-- 5. RATINGS TABLE RLS
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'ratings' AND schemaname = 'public') THEN
    EXECUTE 'ALTER TABLE public.ratings ENABLE ROW LEVEL SECURITY';
    
    -- Drop existing policies if any
    DROP POLICY IF EXISTS "ratings_select_all" ON public.ratings;
    DROP POLICY IF EXISTS "ratings_insert_rater" ON public.ratings;
    DROP POLICY IF EXISTS "ratings_update_rater" ON public.ratings;
    DROP POLICY IF EXISTS "ratings_delete_rater" ON public.ratings;
    
    -- Everyone can view ratings (for reputation system)
    CREATE POLICY "ratings_select_all" ON public.ratings
      FOR SELECT
      USING (true);
    
    -- Only the rater (from_user_id) can insert ratings
    CREATE POLICY "ratings_insert_rater" ON public.ratings
      FOR INSERT
      WITH CHECK (auth.uid() = from_user_id);
    
    -- Raters can update their own ratings
    CREATE POLICY "ratings_update_rater" ON public.ratings
      FOR UPDATE
      USING (auth.uid() = from_user_id)
      WITH CHECK (auth.uid() = from_user_id);
    
    -- Raters can delete their own ratings  
    CREATE POLICY "ratings_delete_rater" ON public.ratings
      FOR DELETE
      USING (auth.uid() = from_user_id);
  END IF;
END $$;

-- ============================================================================
-- 6. REPORTS TABLE RLS
-- ============================================================================
-- Reports are confidential - users can only see their own reports

ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any
DROP POLICY IF EXISTS "reports_select_own" ON public.reports;
DROP POLICY IF EXISTS "reports_insert_own" ON public.reports;
DROP POLICY IF EXISTS "reports_update_own" ON public.reports;
DROP POLICY IF EXISTS "reports_delete_own" ON public.reports;

-- Users can only view their own reports
CREATE POLICY "reports_select_own" ON public.reports
  FOR SELECT
  USING (auth.uid() = user_id);

-- Users can only create reports as themselves
CREATE POLICY "reports_insert_own" ON public.reports
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own pending reports (e.g., add details)
CREATE POLICY "reports_update_own" ON public.reports
  FOR UPDATE
  USING (auth.uid() = user_id AND status = 'pending')
  WITH CHECK (auth.uid() = user_id);

-- Users can delete their own pending reports
CREATE POLICY "reports_delete_own" ON public.reports
  FOR DELETE
  USING (auth.uid() = user_id AND status = 'pending');

-- ============================================================================
-- 7. BLOCKED_USERS TABLE RLS
-- ============================================================================
-- Users can only see and manage their own block list

ALTER TABLE public.blocked_users ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any
DROP POLICY IF EXISTS "blocked_users_select_own" ON public.blocked_users;
DROP POLICY IF EXISTS "blocked_users_insert_own" ON public.blocked_users;
DROP POLICY IF EXISTS "blocked_users_delete_own" ON public.blocked_users;

-- Users can view their own block list
CREATE POLICY "blocked_users_select_own" ON public.blocked_users
  FOR SELECT
  USING (auth.uid() = blocker_id);

-- Users can block others (as themselves)
CREATE POLICY "blocked_users_insert_own" ON public.blocked_users
  FOR INSERT
  WITH CHECK (auth.uid() = blocker_id);

-- Users can unblock others
CREATE POLICY "blocked_users_delete_own" ON public.blocked_users
  FOR DELETE
  USING (auth.uid() = blocker_id);

-- ============================================================================
-- 8. SKILLS TABLE RLS
-- ============================================================================
-- Skills are publicly viewable (part of user profile) but only editable by owner

ALTER TABLE public.skills ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any
DROP POLICY IF EXISTS "skills_select_all" ON public.skills;
DROP POLICY IF EXISTS "skills_insert_own" ON public.skills;
DROP POLICY IF EXISTS "skills_update_own" ON public.skills;
DROP POLICY IF EXISTS "skills_delete_own" ON public.skills;

-- Everyone can view skills (part of public profile)
CREATE POLICY "skills_select_all" ON public.skills
  FOR SELECT
  USING (true);

-- Users can add their own skills
CREATE POLICY "skills_insert_own" ON public.skills
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own skills
CREATE POLICY "skills_update_own" ON public.skills
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Users can delete their own skills
CREATE POLICY "skills_delete_own" ON public.skills
  FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================================
-- 9. BOUNTIES TABLE RLS
-- ============================================================================
-- Bounties are publicly viewable but only editable by the poster
--
-- IMPORTANT: The bounties table has two owner columns for backwards compatibility:
-- - user_id: Legacy column (NOT NULL) - many parts of the codebase reference this
-- - poster_id: New canonical column (nullable) - being backfilled from user_id
-- Both columns are checked in policies to ensure compatibility during migration.
-- See database/schema.sql lines 84-87 for documentation of this design decision.

ALTER TABLE public.bounties ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any
DROP POLICY IF EXISTS "bounties_select_all" ON public.bounties;
DROP POLICY IF EXISTS "bounties_insert_own" ON public.bounties;
DROP POLICY IF EXISTS "bounties_update_own" ON public.bounties;
DROP POLICY IF EXISTS "bounties_delete_own" ON public.bounties;

-- Everyone can view bounties (they're public postings)
CREATE POLICY "bounties_select_all" ON public.bounties
  FOR SELECT
  USING (true);

-- Users can create bounties (as poster)
-- Checks both user_id and poster_id for backwards compatibility
CREATE POLICY "bounties_insert_own" ON public.bounties
  FOR INSERT
  WITH CHECK (auth.uid() = user_id OR auth.uid() = poster_id);

-- Posters can update their own bounties
-- Checks both columns for backwards compatibility
CREATE POLICY "bounties_update_own" ON public.bounties
  FOR UPDATE
  USING (auth.uid() = user_id OR auth.uid() = poster_id)
  WITH CHECK (auth.uid() = user_id OR auth.uid() = poster_id);

-- Posters can delete their own bounties (only if open/cancelled)
-- Checks both columns for backwards compatibility
CREATE POLICY "bounties_delete_own" ON public.bounties
  FOR DELETE
  USING (
    (auth.uid() = user_id OR auth.uid() = poster_id)
    AND status IN ('open', 'cancelled', 'archived')
  );

-- ============================================================================
-- 10. NOTIFICATIONS TABLE RLS
-- ============================================================================
-- Notifications are private to each user

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'notifications' AND schemaname = 'public') THEN
    EXECUTE 'ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY';
    
    -- Drop existing policies if any
    DROP POLICY IF EXISTS "notifications_select_own" ON public.notifications;
    DROP POLICY IF EXISTS "notifications_insert_system" ON public.notifications;
    DROP POLICY IF EXISTS "notifications_update_own" ON public.notifications;
    DROP POLICY IF EXISTS "notifications_delete_own" ON public.notifications;
    
    -- Users can only view their own notifications
    CREATE POLICY "notifications_select_own" ON public.notifications
      FOR SELECT
      USING (auth.uid() = user_id);
    
    -- Allow inserts for the user's own notifications (or via service role for system notifications)
    CREATE POLICY "notifications_insert_system" ON public.notifications
      FOR INSERT
      WITH CHECK (auth.uid() = user_id);
    
    -- Users can update their own notifications (mark as read)
    CREATE POLICY "notifications_update_own" ON public.notifications
      FOR UPDATE
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
    
    -- Users can delete their own notifications
    CREATE POLICY "notifications_delete_own" ON public.notifications
      FOR DELETE
      USING (auth.uid() = user_id);
  END IF;
END $$;

-- ============================================================================
-- 11. WALLET_TRANSACTIONS TABLE RLS
-- ============================================================================
-- Wallet transactions are private - users can only see their own

ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any
DROP POLICY IF EXISTS "wallet_transactions_select_own" ON public.wallet_transactions;
DROP POLICY IF EXISTS "wallet_transactions_insert_own" ON public.wallet_transactions;
DROP POLICY IF EXISTS "wallet_transactions_update_none" ON public.wallet_transactions;
DROP POLICY IF EXISTS "wallet_transactions_delete_none" ON public.wallet_transactions;

-- Users can only view their own wallet transactions
CREATE POLICY "wallet_transactions_select_own" ON public.wallet_transactions
  FOR SELECT
  USING (auth.uid() = user_id);

-- Wallet transactions are typically created by the system (service role)
-- But allow users to create deposits/withdrawals for themselves
CREATE POLICY "wallet_transactions_insert_own" ON public.wallet_transactions
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Wallet transactions should not be updatable by users
-- Only service role should update transaction status
-- We create a restrictive policy
CREATE POLICY "wallet_transactions_update_none" ON public.wallet_transactions
  FOR UPDATE
  USING (false);

-- Wallet transactions should never be deleted (audit trail)
CREATE POLICY "wallet_transactions_delete_none" ON public.wallet_transactions
  FOR DELETE
  USING (false);

-- ============================================================================
-- 12. PUSH_TOKENS TABLE RLS
-- ============================================================================
-- Push tokens are private and device-specific

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'push_tokens' AND schemaname = 'public') THEN
    EXECUTE 'ALTER TABLE public.push_tokens ENABLE ROW LEVEL SECURITY';
    
    -- Drop existing policies if any
    DROP POLICY IF EXISTS "push_tokens_select_own" ON public.push_tokens;
    DROP POLICY IF EXISTS "push_tokens_insert_own" ON public.push_tokens;
    DROP POLICY IF EXISTS "push_tokens_update_own" ON public.push_tokens;
    DROP POLICY IF EXISTS "push_tokens_delete_own" ON public.push_tokens;
    
    -- Users can only view their own push tokens
    CREATE POLICY "push_tokens_select_own" ON public.push_tokens
      FOR SELECT
      USING (auth.uid() = user_id);
    
    -- Users can register their own push tokens
    CREATE POLICY "push_tokens_insert_own" ON public.push_tokens
      FOR INSERT
      WITH CHECK (auth.uid() = user_id);
    
    -- Users can update their own push tokens
    CREATE POLICY "push_tokens_update_own" ON public.push_tokens
      FOR UPDATE
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
    
    -- Users can delete their own push tokens
    CREATE POLICY "push_tokens_delete_own" ON public.push_tokens
      FOR DELETE
      USING (auth.uid() = user_id);
  END IF;
END $$;

-- ============================================================================
-- 13. COMPLETION_READY TABLE RLS
-- ============================================================================
-- Completion ready status visible to bounty poster and assigned hunter

ALTER TABLE public.completion_ready ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any
DROP POLICY IF EXISTS "completion_ready_select_related" ON public.completion_ready;
DROP POLICY IF EXISTS "completion_ready_insert_hunter" ON public.completion_ready;
DROP POLICY IF EXISTS "completion_ready_update_hunter" ON public.completion_ready;
DROP POLICY IF EXISTS "completion_ready_delete_hunter" ON public.completion_ready;

-- Posters and hunters can view completion_ready status for related bounties
CREATE POLICY "completion_ready_select_related" ON public.completion_ready
  FOR SELECT
  USING (
    auth.uid() = hunter_id
    OR EXISTS (
      SELECT 1 FROM public.bounties
      WHERE bounties.id = completion_ready.bounty_id
      AND (bounties.user_id = auth.uid() OR bounties.poster_id = auth.uid())
    )
  );

-- Hunters can mark their bounty work as ready
CREATE POLICY "completion_ready_insert_hunter" ON public.completion_ready
  FOR INSERT
  WITH CHECK (auth.uid() = hunter_id);

-- Hunters can update their ready status
CREATE POLICY "completion_ready_update_hunter" ON public.completion_ready
  FOR UPDATE
  USING (auth.uid() = hunter_id)
  WITH CHECK (auth.uid() = hunter_id);

-- Hunters can remove their ready status
CREATE POLICY "completion_ready_delete_hunter" ON public.completion_ready
  FOR DELETE
  USING (auth.uid() = hunter_id);

-- ============================================================================
-- 14. MODERATION_ACTIONS TABLE RLS
-- ============================================================================
-- Moderation actions are admin-only

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'moderation_actions' AND schemaname = 'public') THEN
    EXECUTE 'ALTER TABLE public.moderation_actions ENABLE ROW LEVEL SECURITY';
    
    -- Drop existing policies if any
    DROP POLICY IF EXISTS "moderation_actions_no_access" ON public.moderation_actions;
    
    -- No user access - only service role/admin can manage moderation actions
    -- This blocks all access for regular authenticated users
    CREATE POLICY "moderation_actions_no_access" ON public.moderation_actions
      FOR ALL
      USING (false);
    
    RAISE NOTICE 'RLS enabled for moderation_actions - admin only access via service role';
  END IF;
END $$;

-- ============================================================================
-- 15. NOTIFICATION_PREFERENCES TABLE RLS
-- ============================================================================
-- Notification preferences are private to each user

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'notification_preferences' AND schemaname = 'public') THEN
    EXECUTE 'ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY';
    
    -- Drop existing policies if any
    DROP POLICY IF EXISTS "notification_preferences_select_own" ON public.notification_preferences;
    DROP POLICY IF EXISTS "notification_preferences_insert_own" ON public.notification_preferences;
    DROP POLICY IF EXISTS "notification_preferences_update_own" ON public.notification_preferences;
    DROP POLICY IF EXISTS "notification_preferences_delete_own" ON public.notification_preferences;
    
    -- Users can only view their own notification preferences
    CREATE POLICY "notification_preferences_select_own" ON public.notification_preferences
      FOR SELECT
      USING (auth.uid() = user_id);
    
    -- Users can create their own notification preferences
    CREATE POLICY "notification_preferences_insert_own" ON public.notification_preferences
      FOR INSERT
      WITH CHECK (auth.uid() = user_id);
    
    -- Users can update their own notification preferences
    CREATE POLICY "notification_preferences_update_own" ON public.notification_preferences
      FOR UPDATE
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
    
    -- Users can delete their own notification preferences
    CREATE POLICY "notification_preferences_delete_own" ON public.notification_preferences
      FOR DELETE
      USING (auth.uid() = user_id);
  END IF;
END $$;

-- ============================================================================
-- 16. COMPLETION_SUBMISSIONS TABLE RLS
-- ============================================================================
-- Completion submissions visible to poster and hunter

ALTER TABLE public.completion_submissions ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any
DROP POLICY IF EXISTS "completion_submissions_select_related" ON public.completion_submissions;
DROP POLICY IF EXISTS "completion_submissions_insert_hunter" ON public.completion_submissions;
DROP POLICY IF EXISTS "completion_submissions_update_poster" ON public.completion_submissions;
DROP POLICY IF EXISTS "completion_submissions_update_hunter" ON public.completion_submissions;

-- Hunters can view their own submissions, posters can view submissions for their bounties
CREATE POLICY "completion_submissions_select_related" ON public.completion_submissions
  FOR SELECT
  USING (
    auth.uid() = hunter_id
    OR EXISTS (
      SELECT 1 FROM public.bounties
      WHERE bounties.id = completion_submissions.bounty_id
      AND (bounties.user_id = auth.uid() OR bounties.poster_id = auth.uid())
    )
  );

-- Hunters can submit completions for bounties they're assigned to
CREATE POLICY "completion_submissions_insert_hunter" ON public.completion_submissions
  FOR INSERT
  WITH CHECK (auth.uid() = hunter_id);

-- Posters can update submission status (approve, reject, request revision)
CREATE POLICY "completion_submissions_update_poster" ON public.completion_submissions
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.bounties
      WHERE bounties.id = completion_submissions.bounty_id
      AND (bounties.user_id = auth.uid() OR bounties.poster_id = auth.uid())
    )
  );

-- Hunters can update their own submissions (resubmit with revisions)
CREATE POLICY "completion_submissions_update_hunter" ON public.completion_submissions
  FOR UPDATE
  USING (auth.uid() = hunter_id AND status IN ('pending', 'revision_requested'))
  WITH CHECK (auth.uid() = hunter_id);

-- ============================================================================
-- 17. BOUNTY_CANCELLATIONS TABLE RLS
-- ============================================================================
-- Cancellation requests visible to poster and hunter involved

ALTER TABLE public.bounty_cancellations ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any
DROP POLICY IF EXISTS "bounty_cancellations_select_related" ON public.bounty_cancellations;
DROP POLICY IF EXISTS "bounty_cancellations_insert_related" ON public.bounty_cancellations;
DROP POLICY IF EXISTS "bounty_cancellations_update_responder" ON public.bounty_cancellations;

-- Poster and hunter can view cancellation requests for their bounties
CREATE POLICY "bounty_cancellations_select_related" ON public.bounty_cancellations
  FOR SELECT
  USING (
    auth.uid() = requester_id
    OR auth.uid() = responder_id
    OR EXISTS (
      SELECT 1 FROM public.bounties
      WHERE bounties.id = bounty_cancellations.bounty_id
      AND (
        bounties.user_id = auth.uid() 
        OR bounties.poster_id = auth.uid() 
        OR bounties.accepted_by = auth.uid()
      )
    )
  );

-- Poster or hunter can request cancellation
CREATE POLICY "bounty_cancellations_insert_related" ON public.bounty_cancellations
  FOR INSERT
  WITH CHECK (
    auth.uid() = requester_id
    AND EXISTS (
      SELECT 1 FROM public.bounties
      WHERE bounties.id = bounty_cancellations.bounty_id
      AND (
        bounties.user_id = auth.uid() 
        OR bounties.poster_id = auth.uid() 
        OR bounties.accepted_by = auth.uid()
      )
    )
  );

-- The other party (responder) can update the cancellation (accept/reject)
CREATE POLICY "bounty_cancellations_update_responder" ON public.bounty_cancellations
  FOR UPDATE
  USING (
    auth.uid() != requester_id  -- Can't respond to own request
    AND EXISTS (
      SELECT 1 FROM public.bounties
      WHERE bounties.id = bounty_cancellations.bounty_id
      AND (
        bounties.user_id = auth.uid() 
        OR bounties.poster_id = auth.uid() 
        OR bounties.accepted_by = auth.uid()
      )
    )
  );

-- ============================================================================
-- 18. BOUNTY_DISPUTES TABLE RLS
-- ============================================================================
-- Disputes are visible to involved parties and admins

ALTER TABLE public.bounty_disputes ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any
DROP POLICY IF EXISTS "bounty_disputes_select_related" ON public.bounty_disputes;
DROP POLICY IF EXISTS "bounty_disputes_insert_initiator" ON public.bounty_disputes;
DROP POLICY IF EXISTS "bounty_disputes_update_related" ON public.bounty_disputes;

-- Poster, hunter, and initiator can view disputes for their bounties
CREATE POLICY "bounty_disputes_select_related" ON public.bounty_disputes
  FOR SELECT
  USING (
    auth.uid() = initiator_id
    OR EXISTS (
      SELECT 1 FROM public.bounties
      WHERE bounties.id = bounty_disputes.bounty_id
      AND (
        bounties.user_id = auth.uid() 
        OR bounties.poster_id = auth.uid() 
        OR bounties.accepted_by = auth.uid()
      )
    )
  );

-- Users can initiate disputes for bounties they're involved in
CREATE POLICY "bounty_disputes_insert_initiator" ON public.bounty_disputes
  FOR INSERT
  WITH CHECK (
    auth.uid() = initiator_id
    AND EXISTS (
      SELECT 1 FROM public.bounties
      WHERE bounties.id = bounty_disputes.bounty_id
      AND (
        bounties.user_id = auth.uid() 
        OR bounties.poster_id = auth.uid() 
        OR bounties.accepted_by = auth.uid()
      )
    )
  );

-- Involved parties can add evidence/update disputes
-- Note: Resolution is done by service role/admin
CREATE POLICY "bounty_disputes_update_related" ON public.bounty_disputes
  FOR UPDATE
  USING (
    status IN ('open', 'under_review')
    AND (
      auth.uid() = initiator_id
      OR EXISTS (
        SELECT 1 FROM public.bounties
        WHERE bounties.id = bounty_disputes.bounty_id
        AND (
          bounties.user_id = auth.uid() 
          OR bounties.poster_id = auth.uid() 
          OR bounties.accepted_by = auth.uid()
        )
      )
    )
  );

-- ============================================================================
-- GRANT STATEMENTS
-- ============================================================================
-- Ensure authenticated users have appropriate base permissions
-- RLS policies will further restrict access

GRANT SELECT ON public.reports TO authenticated;
GRANT INSERT ON public.reports TO authenticated;
GRANT UPDATE ON public.reports TO authenticated;
GRANT DELETE ON public.reports TO authenticated;

GRANT SELECT ON public.blocked_users TO authenticated;
GRANT INSERT ON public.blocked_users TO authenticated;
GRANT DELETE ON public.blocked_users TO authenticated;

GRANT SELECT ON public.skills TO authenticated;
GRANT INSERT ON public.skills TO authenticated;
GRANT UPDATE ON public.skills TO authenticated;
GRANT DELETE ON public.skills TO authenticated;

GRANT SELECT ON public.bounties TO authenticated;
GRANT INSERT ON public.bounties TO authenticated;
GRANT UPDATE ON public.bounties TO authenticated;
GRANT DELETE ON public.bounties TO authenticated;

GRANT SELECT ON public.wallet_transactions TO authenticated;
GRANT INSERT ON public.wallet_transactions TO authenticated;

GRANT SELECT ON public.completion_ready TO authenticated;
GRANT INSERT ON public.completion_ready TO authenticated;
GRANT UPDATE ON public.completion_ready TO authenticated;
GRANT DELETE ON public.completion_ready TO authenticated;

GRANT SELECT ON public.completion_submissions TO authenticated;
GRANT INSERT ON public.completion_submissions TO authenticated;
GRANT UPDATE ON public.completion_submissions TO authenticated;

GRANT SELECT ON public.bounty_cancellations TO authenticated;
GRANT INSERT ON public.bounty_cancellations TO authenticated;
GRANT UPDATE ON public.bounty_cancellations TO authenticated;

GRANT SELECT ON public.bounty_disputes TO authenticated;
GRANT INSERT ON public.bounty_disputes TO authenticated;
GRANT UPDATE ON public.bounty_disputes TO authenticated;

COMMIT;

-- ============================================================================
-- VERIFICATION QUERIES (run after migration to verify)
-- ============================================================================
-- 
-- Check RLS is enabled on all tables:
-- SELECT schemaname, tablename, rowsecurity 
-- FROM pg_tables 
-- WHERE schemaname = 'public' 
-- ORDER BY tablename;
--
-- List all policies:
-- SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
-- FROM pg_policies
-- WHERE schemaname = 'public'
-- ORDER BY tablename, policyname;
--
-- Check for SECURITY DEFINER views:
-- SELECT schemaname, viewname, definition 
-- FROM pg_views 
-- WHERE schemaname = 'public';
