-- Migration: mark_all_notifications_read() RPC
-- Date: 2026-09-08
--
-- ISSUE (kodaksax/Bounty-production#776):
--   Notifications only flipped to `read = true` when a row was tapped
--   individually (components/notifications/notification-center-screen.tsx
--   handlePress -> notificationService.markAsRead([id])). Instagram-style
--   behavior instead clears everything the moment the activity/notifications
--   screen is opened, without requiring a per-item tap.
--
-- The client already had a `markAllAsRead()` path (wired to a "Mark all
-- read" button), but it went through a Node API route with a raw
-- `UPDATE ... WHERE user_id = ? AND read = false` client-side fallback in
-- its catch block -- no single atomic server-side entry point. This RPC
-- gives both the button and the new "mark everything read on screen
-- open/focus" behavior one atomic, auth.uid()-scoped statement to call
-- instead of relying on client-side table writes.
--
-- SECURITY DEFINER, but -- like get_bounty_exact_location() and
-- get_my_profile() -- there is no caller-supplied identity to spoof: the
-- WHERE clause is scoped to auth.uid() internally, so a caller can only ever
-- mark their own notifications read, identical to what RLS
-- ("notifications_update_own", 20251216_add_notifications_rls.sql) already
-- permits via a direct client UPDATE. This just makes it one round trip
-- instead of a client-side statement.

CREATE OR REPLACE FUNCTION public.mark_all_notifications_read()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated_count INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  UPDATE public.notifications
  SET read = true
  WHERE user_id = auth.uid()
    AND read = false;

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$;

COMMENT ON FUNCTION public.mark_all_notifications_read() IS
  'Marks every unread notification belonging to auth.uid() as read in one statement. Returns the number of rows updated. Scoped server-side to the calling user -- there is no user-id parameter to spoof.';

REVOKE ALL ON FUNCTION public.mark_all_notifications_read() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_all_notifications_read() FROM anon;
GRANT EXECUTE ON FUNCTION public.mark_all_notifications_read() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- Verification:
--   -- as an authenticated user with unread notifications:
--   select public.mark_all_notifications_read();
--   -- returns the count of rows it just flipped to read = true, and a
--   -- second immediate call returns 0 (idempotent, nothing left unread).
--   -- as anon (no session) or unauthenticated:
--   select public.mark_all_notifications_read();
--   -- raises "Not authenticated" (auth.uid() IS NULL) / permission denied
--   -- (EXECUTE revoked from anon).
