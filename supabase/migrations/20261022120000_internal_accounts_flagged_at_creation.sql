-- Internal accounts are flagged when their profile is created.
--
-- profiles.is_internal (20260913010000) was backfilled once from the
-- 14-address team list and never again: a new profile defaults to false.
-- 2026-10-11 the team member behind jordanmag11@yahoo.com, one of those 14
-- addresses, signed up again. The new profile (97c7692c) came up external, its
-- $5 bounty went into the hunter feed, and internal `postgod` was accepted on
-- it 18 s after applying, which read as the first external accept in six
-- weeks. hunterbnty158@gmail.com (2026-10-05, the hunter half of postgod's
-- posterbnty158) is on the app's own internal list (lib/posthog.ts) and was
-- external too. Prod had 13 internal profiles, not 14.
--
-- Any signed-in user could also PATCH their own is_internal: the column is
-- granted for UPDATE, the self-update policies are `auth.uid() = id`, and
-- prevent_client_writes_to_protected_profile_columns does not list it.
--
-- This migration:
--   1. internal_account_emails: the team list as data, exact lowercased
--      addresses only, never a pattern. Service role only.
--   2. BEFORE INSERT on profiles: a profile whose auth email is on the list is
--      created internal, whatever the sign-in method. A client cannot create
--      itself internal, and (BEFORE UPDATE) cannot change the flag at all.
--   3. AFTER INSERT on the list: adding an address flags that account at
--      once. That is the admin toggle. trg_queue_profile_analytics_snapshot
--      already fires on is_internal, so the PostHog person gets
--      is_internal=true and joins cohort 473053, which matches on it.
--   4. AFTER UPDATE of is_internal false -> true: the account's existing
--      bounties become is_test, so they leave the hunter feed, search and
--      nearby notifications like every bounty an internal poster creates
--      (fn_bounties_default_is_test only runs on INSERT).
--   5. One-time fix: seed the list (flags jordanmag11, hunterbnty158 and the
--      two Maglalang family accounts the founder confirmed 2026-10-22,
--      tonkagisil_1167 and gisellemaglalang, through 3 and 4) and mark every
--      remaining internal poster's bounty is_test. On
--      prod that is 2a39dbf2 "Move a couch" (postgod), which the 09-13
--      backfill skipped: it then had accepted_by set while open, so its UPDATE
--      failed bounties_open_implies_unassigned and the error was swallowed.
--      Nothing here swallows errors.
--
-- Expected on prod (read 2026-10-22): profiles.is_internal 13 -> 17;
-- bounties.is_test false -> true on 4 rows (2a39dbf2, 59879908, and
-- tonkagisil_1167's 9f5355f6 and d4f6c2ad).
--
-- Rollback: supabase/rollbacks/production/20261022120000_internal_accounts_flagged_at_creation.down.sql

BEGIN;

-- ─── 1. The team list ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.internal_account_emails (
  email    text PRIMARY KEY CHECK (email = lower(btrim(email)) AND email <> ''),
  note     text,
  added_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.internal_account_emails IS
  'Team and QA sign-in addresses, exact and lowercased. A profile whose auth email is listed is created with is_internal = true; inserting a row flags an existing account. Patterns are deliberately unsupported.';

ALTER TABLE public.internal_account_emails ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.internal_account_emails FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.internal_account_emails TO service_role;

-- ─── 2. Creation and client writes ─────────────────────────────────────────
-- SECURITY DEFINER to read auth.users, so the caller is read from the JWT
-- (auth.role()), as prevent_client_writes_to_protected_profile_columns does.
-- No JWT (handle_new_user inside the auth.users INSERT, migrations, ops SQL)
-- is a trusted caller.
CREATE OR REPLACE FUNCTION public.fn_profiles_guard_is_internal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_client boolean := COALESCE(auth.role(), '') IN ('authenticated', 'anon');
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF v_client THEN
      NEW.is_internal := false;
    END IF;
    IF NOT COALESCE(NEW.is_internal, false) THEN
      NEW.is_internal := EXISTS (
        SELECT 1
        FROM auth.users u
        JOIN public.internal_account_emails i ON i.email = lower(btrim(u.email))
        WHERE u.id = NEW.id
      );
    END IF;
    RETURN NEW;
  END IF;

  IF v_client AND NEW.is_internal IS DISTINCT FROM OLD.is_internal THEN
    RAISE EXCEPTION 'profiles.is_internal is managed server-side'
      USING ERRCODE = '42501',
            HINT = 'Add the address to internal_account_emails instead.';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_profiles_guard_is_internal() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_profiles_guard_is_internal ON public.profiles;
CREATE TRIGGER trg_profiles_guard_is_internal
  BEFORE INSERT OR UPDATE OF is_internal ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.fn_profiles_guard_is_internal();

-- ─── 4. Internal -> existing bounties become test content ──────────────────
CREATE OR REPLACE FUNCTION public.fn_profiles_internal_marks_bounties_test()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  UPDATE public.bounties
  SET is_test = true
  WHERE COALESCE(poster_id, user_id) = NEW.id
    AND is_test IS NOT TRUE;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_profiles_internal_marks_bounties_test() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_profiles_internal_marks_bounties_test ON public.profiles;
CREATE TRIGGER trg_profiles_internal_marks_bounties_test
  AFTER UPDATE OF is_internal ON public.profiles
  FOR EACH ROW
  WHEN (NEW.is_internal AND NOT OLD.is_internal)
  EXECUTE FUNCTION public.fn_profiles_internal_marks_bounties_test();

-- ─── 3. Adding an address flags the account ────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_internal_account_emails_flag_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  UPDATE public.profiles p
  SET is_internal = true
  FROM auth.users u
  WHERE u.id = p.id
    AND lower(btrim(u.email)) = NEW.email
    AND NOT p.is_internal;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_internal_account_emails_flag_profile() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_internal_account_emails_flag_profile ON public.internal_account_emails;
CREATE TRIGGER trg_internal_account_emails_flag_profile
  AFTER INSERT ON public.internal_account_emails
  FOR EACH ROW EXECUTE FUNCTION public.fn_internal_account_emails_flag_profile();

-- ─── 5. One-time fix ───────────────────────────────────────────────────────
-- The 14 addresses 20260913010000 backfilled, the two in lib/posthog.ts
-- INTERNAL_EMAILS that were never on it, and two family accounts.
INSERT INTO public.internal_account_emails (email, note) VALUES
  ('leewright093@gmail.com',      '20260913010000 team list'),
  ('jordanmag11@yahoo.com',       '20260913010000 team list; re-registered 2026-10-11 as 97c7692c'),
  ('posterbnty158@gmail.com',     '20260913010000 team list (postgod)'),
  ('maglalangjordan4@gmail.com',  '20260913010000 team list'),
  ('maglalangjordn4@gmail.com',   '20260913010000 team list'),
  ('maglalangjordan@gmail.com',   '20260913010000 team list'),
  ('jordanm4@umbc.edu',           '20260913010000 team list'),
  ('nickel681@gmail.com',         '20260913010000 team list'),
  ('wrightangelique07@gmail.com', '20260913010000 team list'),
  ('work.angeliquew@gmail.com',   '20260913010000 team list'),
  ('jordancooper555@gmail.com',   '20260913010000 team list'),
  ('ralphjordan73@gmail.com',     '20260913010000 team list'),
  ('test@example.com',            '20260913010000 team list'),
  ('testuser_diag99@test.com',    '20260913010000 team list'),
  ('hunterbnty158@gmail.com',     'lib/posthog.ts INTERNAL_EMAILS; hunter half of posterbnty158'),
  ('support@bountyfinder.app',    'lib/posthog.ts INTERNAL_EMAILS'),
  ('giselle.maglalang@icloud.com', 'family account (tonkagisil_1167), confirmed 2026-10-22'),
  ('gisellemaglalang@gmail.com',   'family account (gisellemaglalang), confirmed 2026-10-22')
ON CONFLICT (email) DO NOTHING;

UPDATE public.bounties b
SET is_test = true
FROM public.profiles p
WHERE p.id = COALESCE(b.poster_id, b.user_id)
  AND p.is_internal
  AND b.is_test IS NOT TRUE;

COMMIT;
