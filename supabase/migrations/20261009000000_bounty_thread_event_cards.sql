-- Bounty threads and event cards, for web accounts (bountyfinder.net/bounty).
--
-- A thread is one conversation per (bounty, hunter): the hunter sees exactly
-- one thread for a bounty, the poster one per applicant. It is created when the
-- hunter applies, so a web-only poster or hunter always has a
-- conversation_participants row to read it through (messages RLS is
-- participant-only via my_conversation_ids()).
--
-- Event cards are messages with message_type = 'system' plus two new nullable
-- columns, event_type and ref_id. A card is a pointer, not a record: the web
-- renders it from the live row ref_id names (bounty_requests,
-- completion_submissions, bounty_payments, bounty_v3_funding,
-- wallet_transactions), never from messages.text. `text` is only a short
-- neutral fallback because the app renders every message as a bubble and
-- messages.text is NOT NULL.
--
-- 1. messages.event_type / messages.ref_id, unique per
--    (conversation_id, event_type, ref_id): one card per event, bumped in place.
-- 2. fn_bounty_thread_id(bounty, hunter)  get-or-create the thread.
-- 3. fn_upsert_thread_event(...)         insert-or-bump one card.
-- 4. AFTER triggers on bounty_requests, completion_submissions,
--    bounty_payments and bounty_v3_funding write the card in the same
--    transaction as the state change. v1 (wallet_transactions) is deliberately
--    NOT triggered: the v1 ledger is out of scope, so the web-account release
--    endpoint records the v1 payout card itself.
--    Every card write is wrapped so a card failure can never roll back an
--    application, an acceptance or a payment.
-- 5. trg_messages_guard_event_cards  clients (authenticated/anon) cannot
--    create, edit, retarget or delete a card; only these SECURITY DEFINER
--    functions and the service role can.
-- 6. handle_new_message_notification skips system messages: each event
--    already has its own notification (application, acceptance, completion,
--    payment), so a card must not add a second "Message from ..." push/email.
--
-- Additive only: two nullable columns, two indexes, new functions and
-- triggers; (6) re-creates an existing function with one early return.
-- Rollback: supabase/rollbacks/production/20261009000000_bounty_thread_event_cards.down.sql

BEGIN;

-- 1. Columns + uniqueness ---------------------------------------------------

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS event_type text,
  ADD COLUMN IF NOT EXISTS ref_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'messages_event_type_check'
  ) THEN
    ALTER TABLE public.messages
      ADD CONSTRAINT messages_event_type_check
      CHECK (
        event_type IS NULL
        OR (event_type IN ('applied', 'accepted', 'submitted', 'payout')
            AND ref_id IS NOT NULL
            AND message_type = 'system')
      );
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS messages_event_card_unique
  ON public.messages (conversation_id, event_type, ref_id)
  WHERE event_type IS NOT NULL;

CREATE INDEX IF NOT EXISTS messages_event_card_ref
  ON public.messages (ref_id)
  WHERE event_type IS NOT NULL;

-- 2. Thread get-or-create ---------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_bounty_thread_id(p_bounty_id uuid, p_hunter_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_poster_id uuid;
  v_conv_id   uuid;
BEGIN
  IF p_bounty_id IS NULL OR p_hunter_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT poster_id INTO v_poster_id FROM public.bounties WHERE id = p_bounty_id;
  IF v_poster_id IS NULL OR v_poster_id = p_hunter_id THEN
    RETURN NULL;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('bounty_thread:' || p_bounty_id::text || ':' || p_hunter_id::text));

  -- Reuse a 1:1 conversation already tagged with this bounty (the app may have
  -- opened one), so app and web users talk in the same thread.
  SELECT c.id INTO v_conv_id
  FROM public.conversations c
  WHERE c.bounty_id = p_bounty_id
    AND c.is_group = false
    AND EXISTS (SELECT 1 FROM public.conversation_participants cp
                WHERE cp.conversation_id = c.id AND cp.user_id = v_poster_id)
    AND EXISTS (SELECT 1 FROM public.conversation_participants cp
                WHERE cp.conversation_id = c.id AND cp.user_id = p_hunter_id)
  ORDER BY c.created_at
  LIMIT 1;

  IF v_conv_id IS NULL THEN
    INSERT INTO public.conversations (bounty_id, name, is_group, created_by)
    VALUES (p_bounty_id, '', false, p_hunter_id)
    RETURNING id INTO v_conv_id;
  END IF;

  -- Both sides must be able to read it: add missing rows, and restore a row
  -- someone hid in the app, since a new event on their bounty must reach them.
  INSERT INTO public.conversation_participants (conversation_id, user_id)
  VALUES (v_conv_id, v_poster_id), (v_conv_id, p_hunter_id)
  ON CONFLICT (conversation_id, user_id) DO UPDATE SET deleted_at = NULL
    WHERE public.conversation_participants.deleted_at IS NOT NULL;

  RETURN v_conv_id;
END;
$$;

-- 3. Card upsert --------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_upsert_thread_event(
  p_bounty_id uuid,
  p_hunter_id uuid,
  p_event_type text,
  p_ref_id uuid,
  p_sender_id uuid,
  p_fallback_text text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_conv_id uuid;
  v_msg_id  uuid;
BEGIN
  v_conv_id := public.fn_bounty_thread_id(p_bounty_id, p_hunter_id);
  IF v_conv_id IS NULL OR p_sender_id IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.messages (conversation_id, sender_id, text, message_type, event_type, ref_id)
  VALUES (v_conv_id, p_sender_id, p_fallback_text, 'system', p_event_type, p_ref_id)
  ON CONFLICT (conversation_id, event_type, ref_id) WHERE event_type IS NOT NULL
  DO UPDATE SET updated_at = now()
  RETURNING id INTO v_msg_id;

  RETURN v_msg_id;
END;
$$;

-- Bump every card pointing at a row whose state changed, so realtime
-- subscribers re-render it. Never creates a card.
CREATE OR REPLACE FUNCTION public.fn_touch_thread_events(p_event_type text, p_ref_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  UPDATE public.messages SET updated_at = now()
  WHERE event_type = p_event_type AND ref_id = p_ref_id;
$$;

-- 4. State-change triggers ---------------------------------------------------

CREATE OR REPLACE FUNCTION public.trg_thread_events_from_requests()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  BEGIN
    IF TG_OP = 'INSERT' AND NEW.hunter_id IS NOT NULL THEN
      PERFORM public.fn_upsert_thread_event(NEW.bounty_id, NEW.hunter_id, 'applied', NEW.id,
        NEW.hunter_id, 'Applied to this bounty.');
    ELSIF TG_OP = 'UPDATE' AND NEW.hunter_id IS NOT NULL AND NEW.status IS DISTINCT FROM OLD.status THEN
      PERFORM public.fn_upsert_thread_event(NEW.bounty_id, NEW.hunter_id, 'applied', NEW.id,
        NEW.hunter_id, 'Applied to this bounty.');
      IF NEW.status = 'accepted' THEN
        PERFORM public.fn_upsert_thread_event(NEW.bounty_id, NEW.hunter_id, 'accepted', NEW.id,
          NEW.poster_id, 'Accepted the application.');
      END IF;
    ELSIF TG_OP = 'DELETE' THEN
      -- A withdrawn application: the card stays and renders as withdrawn.
      PERFORM public.fn_touch_thread_events('applied', OLD.id);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'trg_thread_events_from_requests: % (request %)', SQLERRM, COALESCE(NEW.id, OLD.id);
  END;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE TRIGGER trg_thread_events_from_requests
  AFTER INSERT OR UPDATE OF status OR DELETE ON public.bounty_requests
  FOR EACH ROW EXECUTE FUNCTION public.trg_thread_events_from_requests();

CREATE OR REPLACE FUNCTION public.trg_thread_events_from_completions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  BEGIN
    IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status
       OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at THEN
      PERFORM public.fn_upsert_thread_event(NEW.bounty_id, NEW.hunter_id, 'submitted', NEW.id,
        NEW.hunter_id, 'Submitted the work for review.');
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'trg_thread_events_from_completions: % (submission %)', SQLERRM, NEW.id;
  END;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE TRIGGER trg_thread_events_from_completions
  AFTER INSERT OR UPDATE ON public.completion_submissions
  FOR EACH ROW EXECUTE FUNCTION public.trg_thread_events_from_completions();

-- v2: a payout card exists from the first release attempt on.
CREATE OR REPLACE FUNCTION public.trg_thread_events_from_bounty_payments()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_hunter uuid;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NULL;
  END IF;
  BEGIN
    IF NEW.status IN ('release_pending', 'released') OR NEW.stripe_transfer_id IS NOT NULL THEN
      v_hunter := COALESCE(NEW.hunter_id, (SELECT accepted_by FROM public.bounties WHERE id = NEW.bounty_id));
      PERFORM public.fn_upsert_thread_event(NEW.bounty_id, v_hunter, 'payout', NEW.id,
        NEW.poster_id, 'Released the payment.');
    ELSE
      PERFORM public.fn_touch_thread_events('payout', NEW.id);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'trg_thread_events_from_bounty_payments: % (payment %)', SQLERRM, NEW.id;
  END;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE TRIGGER trg_thread_events_from_bounty_payments
  AFTER UPDATE OF status ON public.bounty_payments
  FOR EACH ROW EXECUTE FUNCTION public.trg_thread_events_from_bounty_payments();

-- v3: keyed by bounty_id (the table's key); a card from the first transfer on.
CREATE OR REPLACE FUNCTION public.trg_thread_events_from_v3_funding()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_bounty public.bounties%ROWTYPE;
BEGIN
  IF NEW.state IS NOT DISTINCT FROM OLD.state THEN
    RETURN NULL;
  END IF;
  BEGIN
    IF NEW.state IN ('capturing', 'released') OR NEW.stripe_transfer_id IS NOT NULL THEN
      SELECT * INTO v_bounty FROM public.bounties WHERE id = NEW.bounty_id;
      PERFORM public.fn_upsert_thread_event(NEW.bounty_id, COALESCE(NEW.hunter_id, v_bounty.accepted_by),
        'payout', NEW.bounty_id, v_bounty.poster_id, 'Released the payment.');
    ELSE
      PERFORM public.fn_touch_thread_events('payout', NEW.bounty_id);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'trg_thread_events_from_v3_funding: % (bounty %)', SQLERRM, NEW.bounty_id;
  END;
  RETURN NULL;
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.bounty_v3_funding') IS NOT NULL THEN
    CREATE OR REPLACE TRIGGER trg_thread_events_from_v3_funding
      AFTER UPDATE OF state ON public.bounty_v3_funding
      FOR EACH ROW EXECUTE FUNCTION public.trg_thread_events_from_v3_funding();
  END IF;
END $$;

-- 5. Clients cannot forge or alter cards -------------------------------------
-- SECURITY INVOKER on purpose: current_user is the caller's role for a direct
-- client write, and the definer (owner) inside the functions above.

CREATE OR REPLACE FUNCTION public.fn_messages_guard_event_cards()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.message_type = 'system' OR NEW.event_type IS NOT NULL OR NEW.ref_id IS NOT NULL THEN
      RAISE EXCEPTION 'system messages are written by Bounty only' USING ERRCODE = '42501';
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF (OLD.message_type = 'system' OR NEW.message_type = 'system')
       AND (NEW.message_type IS DISTINCT FROM OLD.message_type
            OR NEW.event_type IS DISTINCT FROM OLD.event_type
            OR NEW.ref_id IS DISTINCT FROM OLD.ref_id
            OR NEW.text IS DISTINCT FROM OLD.text
            OR NEW.conversation_id IS DISTINCT FROM OLD.conversation_id
            OR NEW.sender_id IS DISTINCT FROM OLD.sender_id
            OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at) THEN
      RAISE EXCEPTION 'system messages are written by Bounty only' USING ERRCODE = '42501';
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.message_type = 'system' THEN
      RAISE EXCEPTION 'system messages are written by Bounty only' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE TRIGGER trg_messages_guard_event_cards
  BEFORE INSERT OR UPDATE OR DELETE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.fn_messages_guard_event_cards();

-- 6. No duplicate notification for a card ------------------------------------
-- Identical to 20260825120000 except for the first IF.

CREATE OR REPLACE FUNCTION public.handle_new_message_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  sender_name text;
  b_id uuid;
  recipient record;
  preview text;
BEGIN
  -- Event cards: the event already sent its own notification.
  IF NEW.message_type = 'system' THEN
    RETURN NEW;
  END IF;

  sender_name := public.get_username(NEW.sender_id);

  SELECT bounty_id INTO b_id FROM public.conversations WHERE id = NEW.conversation_id;

  -- Attachment-only messages have empty text; label them by media kind so the
  -- push body is never blank. Mirrors mediaPreviewLabel() in
  -- lib/utils/message-media.ts.
  preview := NULLIF(btrim(COALESCE(NEW.text, '')), '');
  IF preview IS NULL THEN
    IF NEW.media_url IS NOT NULL THEN
      preview := CASE
        WHEN NEW.media_url ~* '\.(jpe?g|png|gif|webp|heic|heif|bmp)(\?|#|$)' THEN 'Photo'
        WHEN NEW.media_url ~* '\.(mp4|mov|m4v|webm|avi|3gp)(\?|#|$)'         THEN 'Video'
        ELSE 'Attachment'
      END;
    ELSE
      preview := '';
    END IF;
  ELSE
    preview := substring(preview from 1 for 100);
  END IF;

  -- Bundle rapid-fire messages in the same conversation from the same sender
  -- within a 60s window into one outbox row (count++) instead of one push per
  -- message. One enqueue call per recipient (bundle_key is per-recipient +
  -- conversation + sender so one chatty participant doesn't suppress another's
  -- separate notification).
  FOR recipient IN
    SELECT cp.user_id FROM public.conversation_participants cp
    WHERE cp.conversation_id = NEW.conversation_id AND cp.user_id != NEW.sender_id
  LOOP
    PERFORM public.enqueue_bundled_notification(
      jsonb_build_array(recipient.user_id),
      'message:' || NEW.conversation_id::text || ':' || NEW.sender_id::text || ':' || recipient.user_id::text,
      60,
      'Message from ' || sender_name,
      preview,
      jsonb_build_object(
        'conversation_id', NEW.conversation_id,
        'sender_id', NEW.sender_id,
        'type', 'message'
      ),
      b_id::text
    );
  END LOOP;

  RETURN NEW;
END;
$function$;

-- Internal helpers: called from triggers and the service role only.
REVOKE ALL ON FUNCTION public.fn_bounty_thread_id(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_upsert_thread_event(uuid, uuid, text, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_touch_thread_events(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_bounty_thread_id(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_upsert_thread_event(uuid, uuid, text, uuid, uuid, text) TO service_role;

COMMIT;
