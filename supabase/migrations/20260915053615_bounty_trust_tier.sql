-- Bounty-level trust requirement system. A lightweight, per-bounty trust
-- tier (standard / digital_skill / home_entry / animal_care /
-- licensed_trades / vulnerable_people -- see lib/utils/trust-tier.ts) with
-- an optional, poster-controlled ID-verification requirement. Deliberately
-- NOT a universal gate: standard bounties are unaffected. Deliberately NOT
-- background checks or license verification -- this only ever gates on
-- Stripe Identity verification, which already exists; nothing here claims
-- Bounty vetted, background-checked, or verified a license.
--
-- Enforcement mirrors 20260903130000_bounty_requests_require_open_bounty.sql
-- exactly: a BEFORE INSERT trigger (SECURITY DEFINER, so it can see a bounty
-- the applicant may have no RLS SELECT visibility on) plus a matching
-- WITH CHECK on the existing hunter-application INSERT policy. Client-side
-- blocking (app/bounty/[id]/public.tsx) exists only so a hunter never
-- invests time in a pitch they can't submit -- this is the real boundary.

BEGIN;

ALTER TABLE public.bounties
  ADD COLUMN IF NOT EXISTS trust_tier text NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS requires_id_verified boolean NOT NULL DEFAULT false;

ALTER TABLE public.bounties
  DROP CONSTRAINT IF EXISTS bounties_trust_tier_check;
ALTER TABLE public.bounties
  ADD CONSTRAINT bounties_trust_tier_check
  CHECK (trust_tier IN ('standard', 'digital_skill', 'home_entry', 'animal_care', 'licensed_trades', 'vulnerable_people'));

-- ---------------------------------------------------------------------------
-- 1. Requirement check, reused by both the trigger and the RLS policy below.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hunter_meets_bounty_id_requirement(p_bounty_id uuid, p_hunter_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_requires boolean;
  v_verified boolean;
BEGIN
  -- SECURITY DEFINER + EXECUTE granted to `authenticated` (required so the
  -- WITH CHECK below, which runs as the inserting role, can call this) means
  -- any signed-in user could otherwise pass an arbitrary p_hunter_id and use
  -- the boolean result as a side channel to learn a stranger's verification
  -- status. Hard-require the caller to only ever ask about themselves --
  -- the only legitimate callers (this trigger, fired on NEW.hunter_id; the
  -- INSERT policy, evaluated on bounty_requests.hunter_id) always pass the
  -- applicant's own id.
  IF p_hunter_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'hunter_meets_bounty_id_requirement: p_hunter_id must match the current user'
      USING ERRCODE = '42501';
  END IF;

  SELECT b.requires_id_verified INTO v_requires
    FROM public.bounties b
   WHERE b.id = p_bounty_id;

  IF v_requires IS NULL OR v_requires = false THEN
    RETURN true;
  END IF;

  SELECT (p.stripe_identity_status = 'verified' OR p.id_verification_status = 'verified')
    INTO v_verified
    FROM public.profiles p
   WHERE p.id = p_hunter_id;

  RETURN COALESCE(v_verified, false);
END;
$$;

REVOKE ALL ON FUNCTION public.hunter_meets_bounty_id_requirement(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hunter_meets_bounty_id_requirement(uuid, uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. BEFORE INSERT trigger on bounty_requests
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_bounty_request_id_requirement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.hunter_meets_bounty_id_requirement(NEW.bounty_id, NEW.hunter_id) THEN
    RAISE EXCEPTION 'This poster requires ID verification to apply'
      USING ERRCODE = 'check_violation',
            HINT = format('bounty %s requires ID-verified hunters', NEW.bounty_id);
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_bounty_request_id_requirement() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_bounty_request_require_id_verified ON public.bounty_requests;
CREATE TRIGGER trg_bounty_request_require_id_verified
  BEFORE INSERT ON public.bounty_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_bounty_request_id_requirement();

-- ---------------------------------------------------------------------------
-- 3. Tighten the INSERT policy (adds to, does not replace, the open-bounty
--    check from 20260903130000).
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
    AND public.hunter_meets_bounty_id_requirement(bounty_requests.bounty_id, bounty_requests.hunter_id)
  );

COMMIT;

-- Verification:
--   -- requires_id_verified = false on the bounty -> insert succeeds regardless of hunter status
--   -- requires_id_verified = true, hunter stripe_identity_status/id_verification_status <> 'verified'
--      -> raises 'This poster requires ID verification to apply'
--   -- requires_id_verified = true, hunter verified -> insert succeeds
--   -- select public.hunter_meets_bounty_id_requirement(any_bounty_id, some_other_users_id)
--      as an authenticated user -> raises '... p_hunter_id must match the current user',
--      never a boolean revealing that other user's verification status
