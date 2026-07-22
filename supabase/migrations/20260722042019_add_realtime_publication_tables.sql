-- ============================================================================
-- REALTIME: add missing tables to the supabase_realtime publication
--
-- Verified against production (project xwlwqzzphmmhghiqvkeu) that only
-- conversations, conversation_participants, and messages were ever added to
-- the publication (see 20251002_messaging_schema.sql). Every other
-- .channel().on('postgres_changes', ...) subscription in the client
-- (notifications, completion_ready, completion_submissions) was connecting
-- successfully but silently receiving zero events, running entirely on
-- polling fallbacks. This adds the tables needed for: notifications realtime
-- to actually fire, completion-status realtime to actually fire, and new
-- realtime coverage for wallet balance (profiles), the bounty feed
-- (bounties), and applicant counts (bounty_requests).
--
-- profiles: RLS is self-select-only (auth.uid() = id) for every existing
-- policy, verified live — safe to publish, each subscriber only ever
-- receives change events for their own row.
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'completion_ready'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.completion_ready;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'completion_submissions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.completion_submissions;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'profiles'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'bounties'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.bounties;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'bounty_requests'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.bounty_requests;
  END IF;
END;
$$;

-- bounty_requests DELETE events need to be filterable by bounty_id, which is
-- not the primary key. Default replica identity only includes PK columns in
-- the old-row payload, so a filtered DELETE subscription (bounty_id=in.(...))
-- would never fire without full old-row data.
ALTER TABLE public.bounty_requests REPLICA IDENTITY FULL;
