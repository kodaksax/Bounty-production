import { readFileSync } from 'fs';
import { join } from 'path';
import { POSTING_RULE_MESSAGES } from '../../lib/utils/bounty-publish-error';

// SBA-03 (docs/audits/shoal-behavioral-audit.md). Behaviour is proven on
// staging by scripts/verify-posting-quality-rules.js (real trigger stack,
// RLS, the service-role path and the paid web intake). This pins the contract
// so a later edit can't quietly switch the description rule on for installed
// builds, refuse a paid web bounty, or let a client exempt itself.
const root = join(__dirname, '../..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

const sql = read('supabase/migrations/20261019230000_posting_quality_rules.sql');
const down = read('supabase/rollbacks/production/20261019230000_posting_quality_rules.down.sql');
const weekly = read('scripts/ops/posting-quality-weekly.sql');
const stepTask = read('app/screens/CreateBounty/quick/StepTask.tsx');
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

describe('posting quality rules migration (SBA-03)', () => {
  const fn = fnBody('fn_bounties_enforce_posting_quality');

  it('runs before every insert, and only on insert', () => {
    expect(sql).toMatch(
      /CREATE TRIGGER trg_bounties_enforce_posting_quality\s+BEFORE INSERT ON public\.bounties\s+FOR EACH ROW/
    );
    expect(sql).not.toMatch(/BEFORE INSERT OR UPDATE ON public\.bounties/);
  });

  describe('rule 1: in-person description', () => {
    it('ships switched off, behind posting_policy_config', () => {
      expect(sql).toContain(
        'ADD COLUMN IF NOT EXISTS require_in_person_description boolean NOT NULL DEFAULT false'
      );
      expect(fn).toContain('SELECT c.require_in_person_description');
      expect(fn).toMatch(/IF COALESCE\(v_require_desc, false\)\s+AND NEW\.work_type = 'in_person'/);
      // The migration must not turn it on itself (the header comment shows how).
      const code = sql.replace(/^\s*--.*$/gm, '');
      expect(code).not.toMatch(/SET\s+require_in_person_description\s*=\s*true/i);
    });

    it('needs 20 trimmed characters, the same bar as the composer', () => {
      expect(fn).toContain("char_length(btrim(COALESCE(NEW.description, ''), E' \\t\\r\\n')) < 20");
      expect(stepTask).toContain('const MIN_DETAIL_LENGTH = 20;');
    });
  });

  describe('rule 2: new-account cap', () => {
    it('allows 2 open bounties in the first 24 hours of the profile', () => {
      expect(fn).toContain("v_joined_at > now() - interval '24 hours'");
      expect(fn).toContain("AND b.status = 'open'");
      expect(fn).toContain('IF v_open >= 2 THEN');
    });

    it('serialises concurrent inserts per poster', () => {
      expect(fn).toContain("pg_advisory_xact_lock(\n      hashtextextended('bounties:new_account_open_cap:' || v_poster::text, 0)");
      expect(fn.indexOf('pg_advisory_xact_lock')).toBeLessThan(fn.indexOf('SELECT count(*)'));
    });
  });

  it('raises check_violation with exactly the copy the app maps', () => {
    for (const message of Object.values(POSTING_RULE_MESSAGES)) {
      expect(fn).toContain(`RAISE EXCEPTION '${message}'`);
    }
    expect((fn.match(/ERRCODE = 'check_violation'/g) ?? []).length).toBe(2);
    // The client falls back to the service-role relay on RLS wording; a
    // refusal must not look like one.
    for (const message of Object.values(POSTING_RULE_MESSAGES)) {
      expect(message).not.toMatch(/row level security|RLS|permission denied|not authorized/i);
    }
  });

  describe('exemptions', () => {
    it('exempts internal accounts by profiles.is_internal only', () => {
      expect(fn).toContain('IF COALESCE(v_internal, false) THEN');
      // A client can send is_test = true on its own insert.
      expect(fn).not.toMatch(/NEW\.is_test/);
      expect(fn).not.toMatch(/email/i);
    });

    it('exempts the paid web intake by call stack, before any refusal', () => {
      expect(fn).toContain('GET DIAGNOSTICS v_context = PG_CONTEXT;');
      expect(fn).toContain("position('function fn_create_bounty_from_pending(' IN v_context) > 0");
      expect(fn.indexOf('PG_CONTEXT')).toBeLessThan(fn.indexOf('RAISE EXCEPTION'));
      // Not redefined here: its live body is not tracked in this repo.
      expect(sql).not.toMatch(/CREATE OR REPLACE FUNCTION public\.fn_create_bounty_from_pending/);
    });
  });

  it('keeps the trigger function away from clients', () => {
    expect(fn).toContain('SECURITY DEFINER');
    expect(fn).toContain('SET search_path = public, pg_catalog, pg_temp');
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION public.fn_bounties_enforce_posting_quality() FROM PUBLIC, anon, authenticated;'
    );
    expect(sql).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.fn_bounties_enforce_posting_quality/);
  });

  it('is registered in the RLS manifest', () => {
    expect(manifest.protected.bounties.required_triggers).toContain('trg_bounties_enforce_posting_quality');
    const entry = manifest.functions.find(
      (f: { signature: string }) => f.signature === 'fn_bounties_enforce_posting_quality()'
    );
    expect(entry.forbid_execute).toEqual(expect.arrayContaining(['anon', 'authenticated', 'PUBLIC']));
  });

  it('has a rollback that removes the trigger, function and switch', () => {
    expect(down).toContain('DROP TRIGGER IF EXISTS trg_bounties_enforce_posting_quality ON public.bounties;');
    expect(down).toContain('DROP FUNCTION IF EXISTS public.fn_bounties_enforce_posting_quality();');
    expect(down).toContain('DROP COLUMN IF EXISTS require_in_person_description');
  });

  it('ships the weekly done-when query', () => {
    expect(weekly).toContain("char_length(btrim(COALESCE(g.description, ''), E' \\t\\r\\n')) AS desc_len");
    expect(weekly).toContain("o.outcome_by = 'poster'");
    expect(weekly).toContain("date_trunc('week', created_at)");
  });
});
