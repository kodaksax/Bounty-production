-- P0-03b — gate the honor path and enforce the advertised minimum, server-side.
--
-- Why this is a DB trigger and not a client change.
--
-- The composer's honor toggle is client code, and `post_switched_to_honor`
-- fired on builds 2.0.6, 2.0.7 AND 2.0.9 within the same two-week window. A
-- client-only fix therefore reaches only the users who update, and leaves
-- every already-shipped build free to keep creating $0 listings for as long as
-- those builds stay installed. At the time of writing 66 of 135 bounties
-- (49%) are for-honor, and 5 of the 11 currently-open bounties are $0 — the
-- listings a poster recruited to the app sees first, and which no hunter
-- claims. The only place that binds every build at once is the database.
--
-- The client change ships alongside this so users on a current build do not
-- see a control that the server now refuses; the trigger is what actually
-- closes the hole.
--
-- Deliberately NOT retroactive: existing for-honor rows are left alone. This
-- gates creation only. Sweeping the 5 open $0 listings out of the feed is a
-- separate, reversible decision for an operator, not something a schema
-- migration should do silently.

-- ---------------------------------------------------------------------------
-- Config, so the pilot can be relaxed without a deploy.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.posting_policy_config (
  id                   boolean PRIMARY KEY DEFAULT true CHECK (id),
  -- When false (the default), a new bounty may not be created with
  -- is_for_honor = true.
  honor_posts_enabled  boolean NOT NULL DEFAULT false,
  -- Minimum paid bounty amount, in dollars. The marketing site advertises $5.
  minimum_amount       numeric NOT NULL DEFAULT 5 CHECK (minimum_amount >= 0),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  updated_by           uuid
);

INSERT INTO public.posting_policy_config (id) VALUES (true)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.posting_policy_config ENABLE ROW LEVEL SECURITY;

-- Readable by signed-in users (the client mirrors the flag so it can hide the
-- toggle); writable only by an admin, matching the JWT-role pattern the rest
-- of this schema uses. profiles.role is dead in production and must not be
-- used for authorization here.
DROP POLICY IF EXISTS posting_policy_config_read ON public.posting_policy_config;
CREATE POLICY posting_policy_config_read
  ON public.posting_policy_config FOR SELECT
  TO authenticated
  USING (true);

-- Scoped to the write commands explicitly rather than FOR ALL: FOR ALL also
-- covers SELECT, which would silently overlap the read policy above and make
-- the actual read rule ambiguous to anyone auditing this table later. One
-- policy per command keeps "admins may write" and "any signed-in user may
-- read" independently readable.
DROP POLICY IF EXISTS posting_policy_config_admin_write ON public.posting_policy_config;
DROP POLICY IF EXISTS posting_policy_config_admin_insert ON public.posting_policy_config;
CREATE POLICY posting_policy_config_admin_insert
  ON public.posting_policy_config FOR INSERT
  TO authenticated
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

DROP POLICY IF EXISTS posting_policy_config_admin_update ON public.posting_policy_config;
CREATE POLICY posting_policy_config_admin_update
  ON public.posting_policy_config FOR UPDATE
  TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

DROP POLICY IF EXISTS posting_policy_config_admin_delete ON public.posting_policy_config;
CREATE POLICY posting_policy_config_admin_delete
  ON public.posting_policy_config FOR DELETE
  TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

REVOKE ALL ON public.posting_policy_config FROM PUBLIC;
-- anon is auto-granted on new objects in this project; revoke it explicitly.
REVOKE ALL ON public.posting_policy_config FROM anon;
GRANT SELECT ON public.posting_policy_config TO authenticated;

-- ---------------------------------------------------------------------------
-- The gate itself.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_bounties_enforce_posting_policy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog', 'pg_temp'
AS $$
DECLARE
  v_honor_enabled boolean;
  v_minimum       numeric;
BEGIN
  SELECT honor_posts_enabled, minimum_amount
    INTO v_honor_enabled, v_minimum
  FROM public.posting_policy_config
  WHERE id = true;

  -- Fail CLOSED on a missing config row. An absent row means the policy is
  -- unknown, and the failure mode this migration exists to stop is exactly
  -- "a $0 listing got created anyway".
  v_honor_enabled := COALESCE(v_honor_enabled, false);
  v_minimum       := COALESCE(v_minimum, 5);

  IF COALESCE(NEW.is_for_honor, false) AND NOT v_honor_enabled THEN
    RAISE EXCEPTION 'for-honor bounties are not currently accepted'
      USING ERRCODE = 'check_violation',
            HINT    = 'Set an amount for this bounty. Posting is free — you are charged only when you accept a hunter.';
  END IF;

  IF NOT COALESCE(NEW.is_for_honor, false)
     AND COALESCE(NEW.amount, 0) < v_minimum THEN
    RAISE EXCEPTION 'bounty amount % is below the % minimum', COALESCE(NEW.amount, 0), v_minimum
      USING ERRCODE = 'check_violation',
            HINT    = 'Raise the amount to at least the minimum shown in the app.';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_bounties_enforce_posting_policy() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_bounties_enforce_posting_policy() FROM anon;

DROP TRIGGER IF EXISTS trg_bounties_enforce_posting_policy ON public.bounties;
CREATE TRIGGER trg_bounties_enforce_posting_policy
  BEFORE INSERT ON public.bounties
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_bounties_enforce_posting_policy();

COMMENT ON TRIGGER trg_bounties_enforce_posting_policy ON public.bounties IS
  'P0-03b: refuses $0/for-honor and below-minimum bounties at creation for every client build, not just updated ones. Toggle via public.posting_policy_config.';
