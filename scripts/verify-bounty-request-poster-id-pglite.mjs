/* scripts/verify-bounty-request-poster-id-pglite.mjs
 *
 * Functional checks, on an in-process PostgreSQL (PGlite), for
 *   supabase/migrations/20261104130000_bounty_requests_poster_id_must_match_bounty.sql
 *
 * Starts from the rollback file's policy (what production runs), shows the forged
 * insert succeeding, applies the migration and shows it refused, then rolls back.
 *
 * Usage:
 *   npm i --no-save @electric-sql/pglite   (or set PGLITE_DIR to a folder that has it)
 *   node scripts/verify-bounty-request-poster-id-pglite.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const req = createRequire(process.env.PGLITE_DIR ? path.join(process.env.PGLITE_DIR, 'noop.js') : import.meta.url);
const { PGlite } = await import(pathToFileURL(req.resolve('@electric-sql/pglite')).href);
const NAME = '20261104130000_bounty_requests_poster_id_must_match_bounty';
const MIGRATION = fs.readFileSync(`${REPO}/supabase/migrations/${NAME}.sql`, 'utf8');
const ROLLBACK = fs.readFileSync(`${REPO}/supabase/rollbacks/production/${NAME}.down.sql`, 'utf8');
const AUDIT = fs.readFileSync(`${REPO}/scripts/ops/bounty-request-forged-poster-audit.sql`, 'utf8');

const db = await PGlite.create();
let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok  ', name); }
  else { fail++; console.log('  FAIL', name, detail !== undefined ? JSON.stringify(detail) : ''); }
}

const POSTER = '00000000-0000-0000-0000-00000000000a';
const HUNTER = '00000000-0000-0000-0000-00000000000b';
const SUSPENDED = '00000000-0000-0000-0000-00000000000c';
const OPEN = '10000000-0000-0000-0000-000000000001';
const LEGACY = '10000000-0000-0000-0000-000000000002';
const CLOSED = '10000000-0000-0000-0000-000000000003';
const IDREQ = '10000000-0000-0000-0000-000000000004';

await db.exec(`
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid $$;
CREATE TABLE public.bounties (id uuid PRIMARY KEY, poster_id uuid, user_id uuid, status text, funding_mode text DEFAULT 'at_accept', accepted_request_id uuid);
CREATE TABLE public.bounty_requests (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bounty_id uuid, hunter_id uuid, poster_id uuid NOT NULL, status text DEFAULT 'pending', created_at timestamptz DEFAULT now(), accepted_at timestamptz);
CREATE TABLE public.wallet_transactions (bounty_id uuid, type text, status text);
GRANT SELECT ON public.bounties TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.bounty_requests TO authenticated, service_role;
ALTER TABLE public.bounty_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY read_all ON public.bounty_requests FOR SELECT USING (true);
CREATE FUNCTION public.is_account_active(u uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT u <> '${SUSPENDED}'::uuid $$;
CREATE FUNCTION public.hunter_meets_bounty_id_requirement(b uuid, h uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT b <> '${IDREQ}'::uuid $$;
INSERT INTO public.bounties (id, poster_id, user_id, status) VALUES
  ('${OPEN}', '${POSTER}', '${POSTER}', 'open'),
  ('${LEGACY}', NULL, '${POSTER}', 'open'),
  ('${CLOSED}', '${POSTER}', '${POSTER}', 'completed'),
  ('${IDREQ}', '${POSTER}', '${POSTER}', 'open');
`);

async function apply(uid, bounty, poster) {
  await db.exec('BEGIN');
  try {
    await db.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, role: 'authenticated' })]);
    await db.exec('SET LOCAL ROLE authenticated');
    await db.query(`INSERT INTO public.bounty_requests (bounty_id, hunter_id, poster_id) VALUES ($1, $2, $3)`, [bounty, uid, poster]);
    return 'allowed';
  } catch (e) {
    return e.code === '42501' ? 'refused' : `error ${e.code}`;
  } finally {
    await db.exec('ROLLBACK');
  }
}

await db.exec(ROLLBACK);
console.log('\nBefore the migration (production today)');
check('a hunter naming themselves as poster is allowed: the defect', (await apply(HUNTER, OPEN, HUNTER)) === 'allowed');

async function after(label) {
  console.log(`\n${label}`);
  check('forged: hunter as poster, refused', (await apply(HUNTER, OPEN, HUNTER)) === 'refused');
  check('forged: a third party as poster, refused', (await apply(HUNTER, OPEN, SUSPENDED)) === 'refused');
  check('a genuine application still works', (await apply(HUNTER, OPEN, POSTER)) === 'allowed');
  check('legacy bounty with only user_id still works', (await apply(HUNTER, LEGACY, POSTER)) === 'allowed');
  check('existing rule kept: applying as someone else', (await apply(POSTER, OPEN, POSTER)) === 'allowed' &&
    (await (async () => {
      await db.exec('BEGIN');
      try {
        await db.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: HUNTER, role: 'authenticated' })]);
        await db.exec('SET LOCAL ROLE authenticated');
        await db.query(`INSERT INTO public.bounty_requests (bounty_id, hunter_id, poster_id) VALUES ($1, $2, $3)`, [OPEN, SUSPENDED, POSTER]);
        return 'allowed';
      } catch (e) { return 'refused'; } finally { await db.exec('ROLLBACK'); }
    })()) === 'refused');
  check('existing rule kept: bounty must be open', (await apply(HUNTER, CLOSED, POSTER)) === 'refused');
  check('existing rule kept: suspended hunter', (await apply(SUSPENDED, OPEN, POSTER)) === 'refused');
  check('existing rule kept: ID requirement', (await apply(HUNTER, IDREQ, POSTER)) === 'refused');
}

await db.exec(MIGRATION);
await after('After the migration');
await db.exec(MIGRATION);
await after('After applying it twice');

console.log('\nThe audit query');
const FORGED = '20000000-0000-0000-0000-000000000001';
await db.query(`INSERT INTO public.bounty_requests (id, bounty_id, hunter_id, poster_id) VALUES ($1, $2, $3, $3)`, [FORGED, OPEN, HUNTER]);
await db.query(`INSERT INTO public.bounty_requests (bounty_id, hunter_id, poster_id) VALUES ($1, $2, $3), ($4, $2, $3)`, [OPEN, HUNTER, POSTER, LEGACY]);
const rows = (await db.query(AUDIT)).rows;
check('finds the forged row, and only that row', rows.length === 1 && rows[0].request_id === FORGED && rows[0].poster_is_applicant === true, rows);
await db.exec(`DELETE FROM public.bounty_requests`);

await db.exec(ROLLBACK);
console.log('\nAfter the rollback');
check('prior policy restored', (await apply(HUNTER, OPEN, HUNTER)) === 'allowed');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
