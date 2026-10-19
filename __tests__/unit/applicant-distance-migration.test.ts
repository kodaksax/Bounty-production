import { readFileSync } from 'fs';
import { join } from 'path';

// SBA-02 (docs/audits/shoal-behavioral-audit.md). Behaviour is proven on
// staging by scripts/verify-applicant-distance.js; this pins the contract so a
// later edit can't quietly turn the flag into a block, leak the distance, or
// open the distance function to clients.
const root = join(__dirname, '../..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

const sql = read('supabase/migrations/20261019200000_applicant_distance.sql');
const down = read('supabase/rollbacks/production/20261019200000_applicant_distance.down.sql');
const weekly = read('scripts/ops/applicant-distance-weekly.sql');
const manifest = JSON.parse(read('supabase/security/rls-manifest.json'));

/** Body of a CREATE FUNCTION up to its closing dollar quote. */
function fnBody(name: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  expect(start).toBeGreaterThan(-1);
  const open = sql.indexOf('AS $', start);
  const tag = sql.slice(open + 3, sql.indexOf('$', open + 4) + 1);
  const end = sql.indexOf(tag, open + 3 + tag.length);
  return sql.slice(start, end + tag.length);
}

describe('applicant distance migration (SBA-02)', () => {
  const distance = fnBody('fn_bounty_request_distance');
  const stamp = fnBody('fn_bounty_requests_stamp_distance');
  const broadcast = fnBody('bounty_requests_broadcast_changes');

  it('adds the stored columns', () => {
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS distance_mi integer');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS is_far boolean NOT NULL DEFAULT false');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS distance_computed_at timestamptz');
  });

  it('measures in-person jobs only, from the approximate job point and a coarsened hunter point', () => {
    expect(distance).toContain("b.work_type = 'in_person'");
    expect(distance).toContain('SELECT b.geom INTO v_job');
    expect(distance).toContain('ST_SnapToGrid(p.geom::geometry, 0.01)');
    // The exact address never enters the calculation.
    expect(sql).not.toMatch(/FROM\s+public\.bounty_private_locations/);
    expect(distance).not.toMatch(/\blatitude\b|\blongitude\b/);
  });

  it('rounds to whole miles with 0 meaning under 1 mile, and flags beyond 50', () => {
    expect(distance).toContain('CASE WHEN v_mi < 1 THEN 0 ELSE round(v_mi)::integer END');
    expect(distance).toContain('is_far := distance_mi > 50');
  });

  it('flags, never blocks', () => {
    expect(stamp).not.toMatch(/RAISE\s+EXCEPTION/i);
    expect(distance).not.toMatch(/RAISE\s+EXCEPTION/i);
  });

  it('keeps the distance function away from clients', () => {
    expect(distance).toContain('SECURITY DEFINER');
    expect(distance).toContain('SET search_path = public, extensions, pg_temp');
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION public.fn_bounty_request_distance(uuid, uuid) FROM PUBLIC, anon, authenticated;',
    );
    expect(sql).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.fn_bounty_request_distance\([^)]*\) TO [^;]*authenticated/);
    expect(stamp).toContain('SECURITY DEFINER');
    expect(stamp).toContain('SET search_path = public, pg_temp');
  });

  it('stamps on insert and does not let an UPDATE rewrite the stored values', () => {
    expect(sql).toMatch(
      /CREATE TRIGGER zz_bounty_requests_applicant_distance\s+BEFORE INSERT OR UPDATE ON public\.bounty_requests/,
    );
    expect(stamp).toContain('NEW.distance_mi := OLD.distance_mi;');
    expect(stamp).toContain('NEW.is_far := OLD.is_far;');
    expect(stamp).toContain('FROM public.fn_bounty_request_distance(NEW.bounty_id, NEW.hunter_id) d');
  });

  it('masks the distance in the realtime broadcast every applicant receives', () => {
    for (const rec of ['v_new', 'v_old']) {
      expect(broadcast).toContain(`${rec}.distance_mi := null;`);
      expect(broadcast).toContain(`${rec}.is_far := null;`);
      expect(broadcast).toContain(`${rec}.distance_computed_at := null;`);
    }
    expect(broadcast).not.toMatch(/tg_table_schema,\s*new,/);
  });

  it('backfills before the stamp trigger exists, without bumping updated_at', () => {
    const disable = sql.indexOf('DISABLE TRIGGER trg_bounty_requests_updated_at');
    const backfill = sql.indexOf('UPDATE public.bounty_requests r');
    const enable = sql.indexOf('ENABLE TRIGGER trg_bounty_requests_updated_at');
    const trigger = sql.indexOf('CREATE TRIGGER zz_bounty_requests_applicant_distance');
    expect(disable).toBeGreaterThan(-1);
    expect(disable).toBeLessThan(backfill);
    expect(backfill).toBeLessThan(enable);
    expect(enable).toBeLessThan(trigger);
  });

  it('is registered in the RLS manifest', () => {
    expect(manifest.protected.bounty_requests.required_triggers).toContain('zz_bounty_requests_applicant_distance');
    const sigs = new Map(manifest.functions.map((f: { signature: string; forbid_execute: string[] }) => [f.signature, f.forbid_execute]));
    for (const sig of ['fn_bounty_request_distance(uuid,uuid)', 'fn_bounty_requests_stamp_distance()', 'bounty_requests_broadcast_changes()']) {
      expect(sigs.get(sig)).toEqual(expect.arrayContaining(['anon', 'authenticated', 'PUBLIC']));
    }
  });

  it('has a rollback that restores the unmasked broadcast before dropping the columns', () => {
    expect(down).toContain('DROP TRIGGER IF EXISTS zz_bounty_requests_applicant_distance');
    expect(down.indexOf('CREATE OR REPLACE FUNCTION public.bounty_requests_broadcast_changes()')).toBeLessThan(
      down.indexOf('DROP COLUMN IF EXISTS distance_mi'),
    );
  });

  it('ships the weekly done-when query', () => {
    expect(weekly).toContain("g.work_type = 'in_person'");
    expect(weekly).toContain('r.distance_mi <= 25');
    expect(weekly).toContain("date_trunc('week', r.created_at)");
  });
});
