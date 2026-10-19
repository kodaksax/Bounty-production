import { readFileSync } from 'fs';
import { join } from 'path';

// SBA-08 (docs/audits/shoal-behavioral-audit.md): is_username_available is
// rate-limited per caller. Behaviour is proven on PGlite by
// scripts/verify-username-rate-limit-pglite.js (29 checks: answers, buckets,
// 30/min and 300/h limits, rollback of refused calls, GET, grants, rollback
// file) and on staging through the real Data API (anon: 30 answered, then
// HTTP 429 rate_limited; a spoofed X-Forwarded-For still counts against the
// real IP). This pins the contract.
const root = join(__dirname, '../..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

const sql = read('supabase/migrations/20261019235800_is_username_available_rate_limit.sql');
const down = read('supabase/rollbacks/production/20261019235800_is_username_available_rate_limit.down.sql');
const manifest = JSON.parse(read('supabase/security/rls-manifest.json'));

const fn = sql.slice(
  sql.indexOf('CREATE OR REPLACE FUNCTION public.is_username_available('),
  sql.indexOf('$function$;') + '$function$;'.length
);

describe('is_username_available rate limit migration (SBA-08)', () => {
  it('keeps the signature and return type every installed build calls', () => {
    expect(fn).toContain('CREATE OR REPLACE FUNCTION public.is_username_available(p_username text)');
    expect(fn).toContain('RETURNS boolean');
  });

  it('SECURITY DEFINER, empty search_path, VOLATILE (it writes)', () => {
    expect(fn).toContain('SECURITY DEFINER');
    expect(fn).toContain("SET search_path = ''");
    expect(fn).toMatch(/\bVOLATILE\b/);
    expect(fn).not.toMatch(/\bSTABLE\b/);
  });

  it('answers exactly as before: case-insensitive, own row ignored, NULL for malformed', () => {
    expect(fn).toContain("btrim(p_username) !~ '^[A-Za-z0-9_]{3,24}$'");
    expect(fn).toContain('lower(p.username) = lower(btrim(p_username))');
    expect(fn).toContain('p.id IS DISTINCT FROM v_uid');
  });

  it('limits anon and authenticated Data API callers by user id, else by hashed IP', () => {
    expect(fn).toContain("coalesce(v_role, 'anon') IN ('anon', 'authenticated')");
    expect(fn).toContain("v_bucket := 'uid:' || v_uid::text;");
    expect(fn).toMatch(/v_headers ->> 'cf-connecting-ip',\s*split_part\(v_headers ->> 'x-forwarded-for', ',', 1\)/);
    expect(fn).toContain('v_bucket := md5(v_bucket);');
  });

  it('refuses over 30/min or 300/h with HTTP 429 rate_limited', () => {
    expect(fn).toContain('IF v_minute_hits > 30 OR v_hour_hits > 300 THEN');
    expect(fn).toContain("RAISE SQLSTATE 'PGRST'");
    expect(fn).toContain("'code', 'rate_limited'");
    expect(fn).toContain("'status', 429");
  });

  it('grants: anon + authenticated, no PUBLIC; counter table closed to clients', () => {
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.is_username_available(text) FROM PUBLIC;');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.is_username_available(text) TO anon, authenticated, service_role;');
    expect(sql).toContain('ALTER TABLE public.username_check_rate_limits ENABLE ROW LEVEL SECURITY;');
    expect(sql).toContain('REVOKE ALL ON TABLE public.username_check_rate_limits FROM PUBLIC, anon, authenticated;');

    const entry = manifest.functions.find((f: any) => f.signature === 'is_username_available(text)');
    expect(entry.forbid_execute).toEqual(['PUBLIC']);
    expect(entry.require_execute).toEqual(expect.arrayContaining(['anon', 'authenticated']));
    expect(manifest.protected.username_check_rate_limits).toEqual({
      policies: [],
      grants: { anon: [], authenticated: [] },
      required_triggers: [],
    });
  });

  it('the rollback restores the unthrottled STABLE function and drops the table', () => {
    expect(down).toContain('STABLE');
    expect(down).not.toContain('username_check_rate_limits r');
    expect(down).toContain('DROP TABLE IF EXISTS public.username_check_rate_limits;');
    expect(down).toContain('GRANT EXECUTE ON FUNCTION public.is_username_available(text) TO anon, authenticated, service_role;');
  });
});
