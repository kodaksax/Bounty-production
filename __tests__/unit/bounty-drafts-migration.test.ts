/**
 * public.bounty_drafts (20261110120000_bounty_drafts.sql).
 *
 * Behaviour — one user cannot read, change or delete another's draft; anon
 * gets nothing — is exercised against real Postgres by
 * scripts/verify-bounty-drafts-rls-pglite.mjs (and was run on a Supabase
 * branch before merge). These checks pin what CI can see without a database:
 * the migration's policies and grants, the RLS manifest entry, the rollback,
 * and that draft contents have no path into analytics.
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.join(__dirname, '../..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const stripSqlComments = (sql: string) =>
  sql
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n');

const NAME = '20261110120000_bounty_drafts';
const migration = stripSqlComments(read(`supabase/migrations/${NAME}.sql`));
const rollback = stripSqlComments(read(`supabase/rollbacks/production/${NAME}.down.sql`));
const manifest = JSON.parse(read('supabase/security/rls-manifest.json'));

const SELF = /\(\s*SELECT auth\.uid\(\)\s*\)\s*=\s*user_id/;

function policy(name: string): string {
  const m = migration.match(new RegExp(`CREATE POLICY ${name}\\b([\\s\\S]*?);`));
  if (!m) throw new Error(`policy ${name} not found`);
  return m[1];
}

describe('bounty_drafts migration', () => {
  test('one row per user, removed with the auth user', () => {
    expect(migration).toMatch(
      /user_id\s+uuid\s+PRIMARY KEY REFERENCES auth\.users \(id\) ON DELETE CASCADE/
    );
    for (const col of ['draft\\s+jsonb', 'last_step\\s+smallint', 'updated_at\\s+timestamptz', 'device_name\\s+text']) {
      expect(migration).toMatch(new RegExp(col));
    }
  });

  test('row-level security on; anon has no grants; authenticated only the four commands', () => {
    expect(migration).toMatch(/ALTER TABLE public\.bounty_drafts ENABLE ROW LEVEL SECURITY;/);
    expect(migration).toMatch(/REVOKE ALL ON TABLE public\.bounty_drafts FROM PUBLIC, anon, authenticated;/);
    expect(migration).toMatch(/GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public\.bounty_drafts TO authenticated;/);
    expect(migration).not.toMatch(/GRANT[^;]*\bTO\b[^;]*\banon\b/);
    expect(migration).not.toMatch(/TO\s+(public|anon)\b/i);
  });

  test.each([
    ['bounty_drafts_select_own', 'SELECT', ['USING']],
    ['bounty_drafts_insert_own', 'INSERT', ['WITH CHECK']],
    ['bounty_drafts_update_own', 'UPDATE', ['USING', 'WITH CHECK']],
    ['bounty_drafts_delete_own', 'DELETE', ['USING']],
  ])('%s is self-only for authenticated', (name, cmd, clauses) => {
    const body = policy(name);
    expect(body).toMatch(new RegExp(`FOR ${cmd}\\s+TO authenticated`));
    for (const clause of clauses) {
      expect(body).toMatch(new RegExp(`${clause}\\s*\\(${SELF.source}\\)`));
    }
  });

  test('exactly four policies, all permissive self-only (no OR-ing in a broader one)', () => {
    expect(migration.match(/CREATE POLICY/g)).toHaveLength(4);
  });

  test('the RLS manifest protects the table with the same policies and grants', () => {
    const spec = manifest.protected.bounty_drafts;
    expect(spec.grants).toEqual({ anon: [], authenticated: ['DELETE', 'INSERT', 'SELECT', 'UPDATE'] });
    expect(spec.policies.map((p: any) => [p.policyname, p.cmd, p.roles])).toEqual([
      ['bounty_drafts_delete_own', 'DELETE', ['authenticated']],
      ['bounty_drafts_insert_own', 'INSERT', ['authenticated']],
      ['bounty_drafts_select_own', 'SELECT', ['authenticated']],
      ['bounty_drafts_update_own', 'UPDATE', ['authenticated']],
    ]);
    for (const p of spec.policies) {
      for (const expr of [p.qual, p.with_check].filter(Boolean)) {
        expect(expr).toBe('(( SELECT auth.uid() AS uid) = user_id)');
      }
    }
  });

  test('the rollback drops the table', () => {
    expect(rollback).toMatch(/DROP TABLE IF EXISTS public\.bounty_drafts;/);
  });
});

describe('draft contents stay out of analytics', () => {
  // Drafts can hold the exact pin of an in-person task.
  test.each(['lib/services/bounty-draft-sync.ts', 'app/hooks/useBountyDraft.ts'])(
    '%s has no analytics import',
    (file) => {
      const src = read(file);
      expect(src).not.toMatch(/analytics-service|posthog|trackEvent|captureException|reportError|Sentry/i);
    }
  );
});
