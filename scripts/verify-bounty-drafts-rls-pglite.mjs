/* scripts/verify-bounty-drafts-rls-pglite.mjs
 *
 * Functional checks, on an in-process PostgreSQL (PGlite), for
 *   supabase/migrations/20261110120000_bounty_drafts.sql
 *
 * Mirrors Supabase's roles and default privileges (ALL on new tables to anon
 * and authenticated), so the migration's REVOKE is actually tested. Then:
 * owner-only access for each command, one user cannot read, change or delete
 * another's draft, anon gets nothing, the row constraints, cascade on user
 * delete, the manifest entry matches the live policies (scripts/rls-policy-check),
 * re-applying is safe, and the rollback drops the table.
 *
 * Usage:
 *   npm i --no-save @electric-sql/pglite   (or set PGLITE_DIR to a folder that has it)
 *   node scripts/verify-bounty-drafts-rls-pglite.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const req = createRequire(process.env.PGLITE_DIR ? path.join(process.env.PGLITE_DIR, 'noop.js') : import.meta.url);
const { PGlite } = await import(pathToFileURL(req.resolve('@electric-sql/pglite')).href);
const { analyze } = createRequire(import.meta.url)(`${REPO}/scripts/rls-policy-check/rules.js`);
const NAME = '20261110120000_bounty_drafts';
const MIGRATION = fs.readFileSync(`${REPO}/supabase/migrations/${NAME}.sql`, 'utf8');
const ROLLBACK = fs.readFileSync(`${REPO}/supabase/rollbacks/production/${NAME}.down.sql`, 'utf8');
const MANIFEST = JSON.parse(fs.readFileSync(`${REPO}/supabase/security/rls-manifest.json`, 'utf8'));

const db = await PGlite.create();
let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok  ', name); }
  else { fail++; console.log('  FAIL', name, detail !== undefined ? JSON.stringify(detail) : ''); }
}

const ALICE = '00000000-0000-0000-0000-00000000000a';
const BOB = '00000000-0000-0000-0000-00000000000b';
const DRAFT = JSON.stringify({ title: 'Mount my TV', latitude: 40.7128, longitude: -74.006 });

await db.exec(`
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
-- Supabase grants every client role ALL on new public tables by default.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid $$;
INSERT INTO auth.users (id) VALUES ('${ALICE}'), ('${BOB}');
`);

/** Run `sql` as `role` (with `uid` as auth.uid()) in a transaction that is rolled back unless `keep`. */
async function as(role, uid, sql, params = [], keep = false) {
  await db.exec('BEGIN');
  try {
    await db.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify(uid ? { sub: uid, role } : { role })]);
    await db.exec(`SET LOCAL ROLE ${role}`);
    const r = await db.query(sql, params);
    await db.exec(keep ? 'COMMIT' : 'ROLLBACK');
    return { ok: true, rows: r.rows, affected: r.affectedRows ?? 0 };
  } catch (e) {
    await db.exec('ROLLBACK');
    return { ok: false, code: e.code, message: e.message };
  }
}

const insertOwn = (uid, owner = uid, keep = false) =>
  as('authenticated', uid,
    `INSERT INTO public.bounty_drafts (user_id, draft, last_step, updated_at, device_name)
     VALUES ($1, $2::jsonb, 3, now(), 'Pixel 7')`, [owner, DRAFT], keep);

async function run(label) {
  console.log(`\n${label}`);

  // Seed Alice's draft as Alice.
  await db.exec(`DELETE FROM public.bounty_drafts`);
  const seeded = await insertOwn(ALICE, ALICE, true);
  check('Alice can insert her own draft', seeded.ok, seeded);

  const aliceReads = await as('authenticated', ALICE, `SELECT user_id, draft->>'title' AS title, last_step FROM public.bounty_drafts`);
  check('Alice reads her own draft', aliceReads.ok && aliceReads.rows.length === 1 && aliceReads.rows[0].title === 'Mount my TV', aliceReads);

  // The core rule: one user cannot read another's draft.
  const bobReads = await as('authenticated', BOB, `SELECT * FROM public.bounty_drafts`);
  check("Bob cannot read Alice's draft (0 rows)", bobReads.ok && bobReads.rows.length === 0, bobReads);
  const bobReadsById = await as('authenticated', BOB, `SELECT * FROM public.bounty_drafts WHERE user_id = $1`, [ALICE]);
  check("Bob cannot read Alice's draft by id", bobReadsById.ok && bobReadsById.rows.length === 0, bobReadsById);

  const bobUpdates = await as('authenticated', BOB, `UPDATE public.bounty_drafts SET draft = '{"title":"pwned"}' WHERE user_id = $1`, [ALICE]);
  check("Bob cannot update Alice's draft (0 rows)", bobUpdates.ok && bobUpdates.affected === 0, bobUpdates);
  const bobDeletes = await as('authenticated', BOB, `DELETE FROM public.bounty_drafts WHERE user_id = $1`, [ALICE]);
  check("Bob cannot delete Alice's draft (0 rows)", bobDeletes.ok && bobDeletes.affected === 0, bobDeletes);
  const stillThere = await db.query(`SELECT draft->>'title' AS title FROM public.bounty_drafts WHERE user_id = $1`, [ALICE]);
  check("Alice's draft is untouched", stillThere.rows[0]?.title === 'Mount my TV');

  const bobForges = await insertOwn(BOB, ALICE);
  check('Bob cannot insert a draft for Alice', !bobForges.ok && bobForges.code === '42501', bobForges);
  const bobUpserts = await as('authenticated', BOB,
    `INSERT INTO public.bounty_drafts (user_id, draft) VALUES ($1, '{"title":"x"}'::jsonb)
     ON CONFLICT (user_id) DO UPDATE SET draft = EXCLUDED.draft`, [ALICE]);
  check("Bob cannot upsert over Alice's draft", !bobUpserts.ok, bobUpserts);

  const aliceMovesRow = await as('authenticated', ALICE, `UPDATE public.bounty_drafts SET user_id = $1 WHERE user_id = $2`, [BOB, ALICE]);
  check('Alice cannot hand her row to Bob (WITH CHECK)', !aliceMovesRow.ok && aliceMovesRow.code === '42501', aliceMovesRow);

  const aliceUpserts = await as('authenticated', ALICE,
    `INSERT INTO public.bounty_drafts (user_id, draft, last_step, updated_at) VALUES ($1, '{"title":"Mount my 65in TV"}'::jsonb, 2, now())
     ON CONFLICT (user_id) DO UPDATE SET draft = EXCLUDED.draft, last_step = EXCLUDED.last_step, updated_at = EXCLUDED.updated_at`, [ALICE]);
  check('Alice can upsert her own draft (the client write path)', aliceUpserts.ok && aliceUpserts.affected === 1, aliceUpserts);
  const aliceDeletes = await as('authenticated', ALICE, `DELETE FROM public.bounty_drafts WHERE user_id = $1`, [ALICE]);
  check('Alice can delete her own draft', aliceDeletes.ok && aliceDeletes.affected === 1, aliceDeletes);

  // anon: no grants at all.
  for (const [what, sql] of [
    ['select', `SELECT * FROM public.bounty_drafts`],
    ['insert', `INSERT INTO public.bounty_drafts (user_id, draft) VALUES ('${ALICE}', '{}'::jsonb)`],
    ['update', `UPDATE public.bounty_drafts SET last_step = 1`],
    ['delete', `DELETE FROM public.bounty_drafts`],
  ]) {
    const r = await as('anon', null, sql);
    check(`anon ${what}: permission denied`, !r.ok && r.code === '42501', r);
  }
  const noSession = await as('authenticated', null, `SELECT * FROM public.bounty_drafts`);
  check('authenticated with no uid sees nothing', noSession.ok && noSession.rows.length === 0, noSession);

  const grants = (await db.query(`
    SELECT grantee, privilege_type FROM information_schema.role_table_grants
     WHERE table_schema = 'public' AND table_name = 'bounty_drafts' AND grantee IN ('anon', 'authenticated')
     ORDER BY 1, 2`)).rows.map(r => `${r.grantee}:${r.privilege_type}`);
  check('grants: authenticated has exactly SELECT/INSERT/UPDATE/DELETE, anon nothing',
    JSON.stringify(grants) === JSON.stringify(['authenticated:DELETE', 'authenticated:INSERT', 'authenticated:SELECT', 'authenticated:UPDATE']), grants);
  const rls = (await db.query(`SELECT relrowsecurity FROM pg_class WHERE oid = 'public.bounty_drafts'::regclass`)).rows[0];
  check('row-level security is enabled', rls?.relrowsecurity === true);

  // Constraints.
  const notObject = await as('authenticated', ALICE, `INSERT INTO public.bounty_drafts (user_id, draft) VALUES ($1, '[1,2]'::jsonb)`, [ALICE]);
  check('a non-object draft is rejected', !notObject.ok && notObject.code === '23514', notObject);
  const huge = await as('authenticated', ALICE,
    `INSERT INTO public.bounty_drafts (user_id, draft) VALUES ($1, jsonb_build_object('title', (SELECT string_agg(md5(i::text), '') FROM generate_series(1, 2000) i)))`, [ALICE]);
  check('a draft over 32 KB is rejected', !huge.ok && huge.code === '23514', huge);
  const badStep = await as('authenticated', ALICE, `INSERT INTO public.bounty_drafts (user_id, draft, last_step) VALUES ($1, '{}'::jsonb, 0)`, [ALICE]);
  check('last_step 0 is rejected', !badStep.ok && badStep.code === '23514', badStep);

  // Cascade on auth user delete.
  await insertOwn(ALICE, ALICE, true);
  await db.exec(`BEGIN; DELETE FROM auth.users WHERE id = '${ALICE}';`);
  const gone = (await db.query(`SELECT count(*)::int AS n FROM public.bounty_drafts WHERE user_id = '${ALICE}'`)).rows[0].n;
  await db.exec('ROLLBACK');
  check("deleting the auth user deletes the draft", gone === 0, gone);
  await db.exec(`DELETE FROM public.bounty_drafts`);

  // The RLS check's manifest entry agrees with what the migration created.
  const policies = (await db.query(`
    SELECT tablename, policyname, permissive, cmd, roles::text AS roles, qual, with_check
      FROM pg_policies WHERE schemaname = 'public' AND tablename = 'bounty_drafts'`)).rows;
  const grantRows = (await db.query(`
    SELECT table_name, grantee, privilege_type FROM information_schema.role_table_grants
     WHERE table_schema = 'public' AND table_name = 'bounty_drafts' AND grantee IN ('anon', 'authenticated')`)).rows;
  const columns = (await db.query(`
    SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'bounty_drafts'`)).rows;
  const result = analyze(
    { policies, grants: grantRows, triggers: [], columns, functions: [], column_grants: [],
      tables: [{ table_name: 'bounty_drafts', rls_enabled: rls?.relrowsecurity === true }] },
    { ...MANIFEST, protected: { bounty_drafts: MANIFEST.protected.bounty_drafts }, functions: [], baseline: [] }
  );
  check('rls-manifest.json bounty_drafts block matches (rules.js analyze: no errors)', result.errors.length === 0, result.errors);
}

await db.exec(MIGRATION);
await run('After the migration');
await db.exec(MIGRATION);
await run('After applying it twice');

console.log('\nRollback');
await db.exec(ROLLBACK);
const exists = (await db.query(`SELECT to_regclass('public.bounty_drafts') AS t`)).rows[0].t;
check('rollback drops the table', exists === null, exists);
await db.exec(MIGRATION);
check('the migration applies again after a rollback', (await db.query(`SELECT to_regclass('public.bounty_drafts') AS t`)).rows[0].t !== null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
