/**
 * 20261022120000: internal accounts are flagged when the profile is created
 * (jordanmag11 re-registered 2026-10-11 and came up external).
 * 20261022120100: profiles.zip_code is derived from the reverse-geocoded
 * location label (0 of 69 new profiles had one after the onboarding rewrite).
 *
 * Behaviour is exercised on PGlite by scripts/verify-internal-and-zip-pglite.mjs;
 * these checks pin the properties that keep the migrations safe to ship.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (rel: string) => readFileSync(join(__dirname, '../../', rel), 'utf8').replace(/\r\n/g, '\n');

const internal = read('supabase/migrations/20261022120000_internal_accounts_flagged_at_creation.sql');
const zip = read('supabase/migrations/20261022120100_profile_zip_from_location.sql');
const manifest = JSON.parse(read('supabase/security/rls-manifest.json'));

// SQL only, so header comments can't satisfy a check.
const code = (sql: string) => sql.replace(/^\s*--.*$/gm, '');

describe('internal accounts flagged at creation', () => {
  const sql = code(internal);

  it('keeps the team list as exact lowercased addresses, service role only', () => {
    expect(sql).toContain('CHECK (email = lower(btrim(email)) AND email <> \'\')');
    expect(sql).toContain('ALTER TABLE public.internal_account_emails ENABLE ROW LEVEL SECURITY;');
    expect(sql).toContain('REVOKE ALL ON public.internal_account_emails FROM PUBLIC, anon, authenticated;');
    // The standing rule: no email patterns.
    expect(sql).not.toMatch(/\bI?LIKE\b/i);
  });

  it('lists jordanmag11, both lib/posthog.ts addresses and the confirmed family accounts', () => {
    for (const email of [
      'jordanmag11@yahoo.com',
      'hunterbnty158@gmail.com',
      'support@bountyfinder.app',
      'giselle.maglalang@icloud.com',
      'gisellemaglalang@gmail.com',
    ]) {
      expect(sql).toContain(`('${email}',`);
    }
  });

  it('decides the flag at INSERT from auth.users and refuses client changes', () => {
    expect(sql).toContain('BEFORE INSERT OR UPDATE OF is_internal ON public.profiles');
    expect(sql).toContain("v_client boolean := COALESCE(auth.role(), '') IN ('authenticated', 'anon');");
    expect(sql).toContain("JOIN public.internal_account_emails i ON i.email = lower(btrim(u.email))");
    expect(sql).toMatch(/RAISE EXCEPTION 'profiles\.is_internal is managed server-side'\s+USING ERRCODE = '42501'/);
  });

  it('marks an account\'s bounties test when it becomes internal, without swallowing errors', () => {
    expect(sql).toContain('WHEN (NEW.is_internal AND NOT OLD.is_internal)');
    expect(sql).toContain('SET is_test = true');
    // The 09-13 backfill swallowed the error that left 2a39dbf2 in the feed.
    expect(sql).not.toMatch(/EXCEPTION\s+WHEN\s+OTHERS/i);
  });

  it('revokes every new function from clients, matching the manifest', () => {
    for (const fn of [
      'fn_profiles_guard_is_internal()',
      'fn_profiles_internal_marks_bounties_test()',
      'fn_internal_account_emails_flag_profile()',
    ]) {
      expect(sql).toContain(`REVOKE ALL ON FUNCTION public.${fn} FROM PUBLIC, anon, authenticated;`);
      expect(manifest.functions).toContainEqual({ signature: fn, forbid_execute: ['anon', 'authenticated', 'PUBLIC'] });
    }
    expect(manifest.protected.profiles.required_triggers).toContain('trg_profiles_guard_is_internal');
    expect(manifest.protected.internal_account_emails.grants).toEqual({ anon: [], authenticated: [] });
  });
});

describe('profile ZIP from the location label', () => {
  const sql = code(zip);
  const ZIP_RE = "'(?:^|[\\s,])(\\d{5})(?:-\\d{4})?\\s*$'";

  it('derives on insert and on location edits, and keeps a typed ZIP', () => {
    expect(sql).toContain('BEFORE INSERT OR UPDATE OF location ON public.profiles');
    expect(sql).toContain(`substring(NEW.location from ${ZIP_RE})`);
    expect(sql).toContain('IF NEW.zip_code IS DISTINCT FROM OLD.zip_code THEN');
    expect(sql).toContain("IF NULLIF(btrim(OLD.zip_code), '') IS NULL OR OLD.zip_code = v_old THEN");
  });

  it('backfills only on request, dry run by default, logging every row it fills', () => {
    expect(sql).toContain('fn_backfill_profile_zip_from_location(p_dry_run boolean DEFAULT true)');
    expect(sql).toContain('IF NOT p_dry_run THEN');
    expect(sql).toContain('INSERT INTO public.profile_zip_backfill_log (user_id, zip_code)');
    // The migration itself never runs it.
    expect(sql).not.toMatch(/SELECT[^;]*fn_backfill_profile_zip_from_location\(/);
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.fn_backfill_profile_zip_from_location(boolean) TO service_role;');
    expect(manifest.protected.profile_zip_backfill_log.grants).toEqual({ anon: [], authenticated: [] });
  });
});
