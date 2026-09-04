-- Migration: reject applications to bounties that are not open
-- Date: 2026-09-03
--
-- FINDING (P2, verified on production):
--   Nothing server-side validated bounty status when a hunter applied. The
--   "Hunters can create applications" INSERT policy on bounty_requests checked
--   only (auth.uid() = hunter_id AND is_account_active(auth.uid())). There was
--   no CHECK constraint and no validating trigger, so the Supabase REST endpoint
--   accepted applications to completed, cancelled and in_progress bounties
--   (HTTP 201). The only guard was UNIQUE (bounty_id, hunter_id), which stops a
--   second application from the same hunter but not a first one to a closed
--   bounty. The AFTER INSERT notification trigger then fired, notifying the
--   poster of an application on a bounty they had already cancelled/completed.
--
--   Reachable two ways: directly through the API, or -- ordinary user behaviour
--   -- from a stale detail page whose bounty was claimed or cancelled after it
--   rendered (the client only shows "Apply" while status === 'open').
--
-- FIX (defence in depth, two layers):
--   1. A BEFORE INSERT trigger on bounty_requests that looks up the target
--      bounty and raises a clear, client-surfaceable error unless its status is
--      'open'. SECURITY DEFINER so the lookup succeeds even when the applicant
--      has no RLS SELECT visibility on a cancelled/completed bounty. Fires for
--      every role (authenticated and service_role) -- there is no legitimate
--      path that inserts an application to a non-open bounty.
--   2. The "Hunters can create applications" RLS policy is tightened to also
--      require the bounty to be open, matching the existing precedent on
--      bounty_disputes (INSERT policy checks the parent bounty's status).
--
-- bounties.status is bounty_status_enum in production and a CHECKed text column
-- in older environments; comparing status::text = 'open' works on both.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. BEFORE INSERT trigger
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_bounty_request_target_open()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status text;
BEGIN
  SELECT b.status::text
    INTO v_status
    FROM public.bounties b
   WHERE b.id = NEW.bounty_id;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Cannot apply: bounty % does not exist', NEW.bounty_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF v_status <> 'open' THEN
    RAISE EXCEPTION 'This bounty is no longer accepting applications'
      USING ERRCODE = 'check_violation',
            HINT = format('bounty %s has status %s', NEW.bounty_id, v_status);
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_bounty_request_target_open() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_bounty_request_require_open ON public.bounty_requests;
CREATE TRIGGER trg_bounty_request_require_open
  BEFORE INSERT ON public.bounty_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_bounty_request_target_open();

-- ---------------------------------------------------------------------------
-- 2. Tighten the INSERT policy (keeps hunter-identity + account-active checks)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Hunters can create applications" ON public.bounty_requests;
CREATE POLICY "Hunters can create applications"
  ON public.bounty_requests
  FOR INSERT
  WITH CHECK (
    auth.uid() = hunter_id
    AND public.is_account_active(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.bounties b
      WHERE b.id = bounty_requests.bounty_id
        AND b.status::text = 'open'
    )
  );

COMMIT;

-- Verification:
--   -- open bounty  -> insert succeeds
--   -- cancelled / completed / in_progress bounty -> raises
--      'This bounty is no longer accepting applications'
--   INSERT INTO public.bounty_requests (bounty_id, hunter_id, poster_id, status)
--   VALUES ('<closed-bounty-uuid>', auth.uid(), '<poster>', 'pending');
