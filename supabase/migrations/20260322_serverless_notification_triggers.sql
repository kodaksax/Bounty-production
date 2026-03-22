-- Migration: Serverless Notification Triggers (Corrected)
-- Description: Ensures notifications_outbox exists and adds database triggers for automated notification queuing.

BEGIN;

-------------------------------------------------------------------------------
-- 0. Ensure notifications_outbox exists
-------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notifications_outbox (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  scheduled_at timestamptz NULL,
  status text NOT NULL DEFAULT 'pending', -- pending | sending | sent | failed
  attempts integer NOT NULL DEFAULT 0,
  last_error text NULL,
  bounty_id text NULL,
  recipients jsonb NULL, -- array of profile ids
  title text NULL,
  body text NULL,
  data jsonb NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Index for processing
CREATE INDEX IF NOT EXISTS idx_notifications_outbox_status_scheduled ON public.notifications_outbox (status, scheduled_at);

-- Trigger to maintain updated_at
CREATE OR REPLACE FUNCTION public.refresh_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notifications_outbox_updated_at ON public.notifications_outbox;
CREATE TRIGGER trg_notifications_outbox_updated_at
  BEFORE UPDATE ON public.notifications_outbox
  FOR EACH ROW EXECUTE FUNCTION public.refresh_updated_at();

-- Enable RLS
ALTER TABLE public.notifications_outbox ENABLE ROW LEVEL SECURITY;

-------------------------------------------------------------------------------
-- 1. Helper Function: Get Username from Profile ID
-------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_username(user_id uuid)
RETURNS text AS $$
DECLARE
  uname text;
BEGIN
  SELECT username INTO uname FROM public.profiles WHERE id = user_id;
  RETURN COALESCE(uname, 'Someone');
END;
$$ LANGUAGE plpgsql STABLE;

-------------------------------------------------------------------------------
-- 2. Trigger: Notify on New Message
-------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_message_notification()
RETURNS TRIGGER AS $$
DECLARE
  sender_name text;
  bounty_title text;
  b_id uuid;
BEGIN
  -- Get sender name
  sender_name := public.get_username(NEW.sender_id);
  
  -- Get bounty info if applicable
  SELECT bounty_id INTO b_id FROM public.conversations WHERE id = NEW.conversation_id;
  IF b_id IS NOT NULL THEN
    SELECT title INTO bounty_title FROM public.bounties WHERE id = b_id;
  END IF;

  -- Insert into outbox for all participants EXCEPT the sender
  INSERT INTO public.notifications_outbox (recipients, title, body, data, bounty_id)
  SELECT 
    jsonb_build_array(cp.user_id),
    'Message from ' || sender_name,
    substring(NEW.text from 1 for 100),
    jsonb_build_object(
      'conversation_id', NEW.conversation_id, 
      'sender_id', NEW.sender_id,
      'type', 'message'
    ),
    b_id::text
  FROM public.conversation_participants cp
  WHERE cp.conversation_id = NEW.conversation_id
    AND cp.user_id != NEW.sender_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_new_message_notification ON public.messages;
CREATE TRIGGER trg_new_message_notification
  AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_message_notification();

-------------------------------------------------------------------------------
-- 3. Trigger: Notify on Bounty Request (Application / Acceptance)
-------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_bounty_request_notification()
RETURNS TRIGGER AS $$
DECLARE
  b_title text;
BEGIN
  SELECT title INTO b_title FROM public.bounties WHERE id = NEW.bounty_id;

  -- Scenario A: New Application (Insert)
  IF (TG_OP = 'INSERT') THEN
    INSERT INTO public.notifications_outbox (recipients, title, body, data, bounty_id)
    VALUES (
      jsonb_build_array(NEW.poster_id),
      'New Bounty Application',
      'Someone applied to your bounty: ' || COALESCE(b_title, 'Bounty'),
      jsonb_build_object('bounty_id', NEW.bounty_id, 'hunter_id', NEW.hunter_id, 'type', 'application'),
      NEW.bounty_id::text
    );
  END IF;

  -- Scenario B: Acceptance (Update status from pending to accepted)
  IF (TG_OP = 'UPDATE' AND OLD.status = 'pending' AND NEW.status = 'accepted') THEN
    INSERT INTO public.notifications_outbox (recipients, title, body, data, bounty_id)
    VALUES (
      jsonb_build_array(NEW.hunter_id),
      'Bounty Accepted!',
      'Your application for "' || COALESCE(b_title, 'Bounty') || '" was accepted',
      jsonb_build_object('bounty_id', NEW.bounty_id, 'type', 'acceptance'),
      NEW.bounty_id::text
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_bounty_request_notification ON public.bounty_requests;
CREATE TRIGGER trg_bounty_request_notification
  AFTER INSERT OR UPDATE ON public.bounty_requests
  FOR EACH ROW EXECUTE FUNCTION public.handle_bounty_request_notification();

-------------------------------------------------------------------------------
-- 4. Trigger: Notify on Bounty Status Change (Review / Approval)
-------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_bounty_status_notification()
RETURNS TRIGGER AS $$
BEGIN
  -- Scenario A: Work Submitted for Review (status -> 'completed')
  IF (OLD.status != 'completed' AND NEW.status = 'completed') THEN
    INSERT INTO public.notifications_outbox (recipients, title, body, data, bounty_id)
    VALUES (
      jsonb_build_array(NEW.creator_id),
      'Review Needed',
      'Bounty "' || NEW.title || '" has been submitted for review',
      jsonb_build_object('bounty_id', NEW.id, 'type', 'review_needed'),
      NEW.id::text
    );
  END IF;

  -- Scenario B: General Status Update (Notify Hunter)
  IF (OLD.status != NEW.status AND NEW.status != 'completed' AND NEW.hunter_id IS NOT NULL) THEN
    INSERT INTO public.notifications_outbox (recipients, title, body, data, bounty_id)
    VALUES (
      jsonb_build_array(NEW.hunter_id),
      'Bounty Update',
      'Bounty "' || NEW.title || '" status is now: ' || NEW.status,
      jsonb_build_object('bounty_id', NEW.id, 'type', 'update'),
      NEW.id::text
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_bounty_status_notification ON public.bounties;
CREATE TRIGGER trg_bounty_status_notification
  AFTER UPDATE ON public.bounties
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.handle_bounty_status_notification();

COMMIT;
