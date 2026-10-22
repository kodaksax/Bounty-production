/* scripts/verify-internal-and-zip-pglite.mjs
 *
 * Functional checks for
 *   supabase/migrations/20261022120000_internal_accounts_flagged_at_creation.sql
 *   supabase/migrations/20261022120100_profile_zip_from_location.sql
 * on an in-process PostgreSQL (PGlite).
 *
 * The schema is a minimal stand-in with production's columns for the rows
 * these migrations touch. auth.role() reads request.jwt.claims like
 * Supabase's. Rows that exist before the migrations mirror prod on 2026-10-22
 * (a re-registered team address, an unlisted team account, an internal
 * poster's non-test bounty). Each migration is applied twice (idempotency).
 *
 * Usage:
 *   npm i --no-save @electric-sql/pglite
 *     (or set PGLITE_DIR to a folder that has it)
 *   node scripts/verify-internal-and-zip-pglite.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const req = createRequire(process.env.PGLITE_DIR ? path.join(process.env.PGLITE_DIR, 'noop.js') : import.meta.url);
const { PGlite } = await import(pathToFileURL(req.resolve('@electric-sql/pglite')).href);
const INTERNAL = fs.readFileSync(`${REPO}/supabase/migrations/20261022120000_internal_accounts_flagged_at_creation.sql`, 'utf8');
const ZIP = fs.readFileSync(`${REPO}/supabase/migrations/20261022120100_profile_zip_from_location.sql`, 'utf8');
const ZIP_DOWN = fs.readFileSync(`${REPO}/supabase/rollbacks/production/20261022120100_profile_zip_from_location.down.sql`, 'utf8');

const db = await PGlite.create();
const q = (sql, params) => db.query(sql, params);
const one = async (sql, params) => (await q(sql, params)).rows[0];

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok  ', name); }
  else { fail++; console.log('  FAIL', name, detail !== undefined ? JSON.stringify(detail) : ''); }
}
async function rejects(sql, params) {
  try { await q(sql, params); return null; } catch (e) { return e; }
}
// Run `fn` as a signed-in client (role + JWT claims), then back to superuser.
async function asClient(role, sub, fn) {
  await db.exec(`SELECT set_config('request.jwt.claims', '${JSON.stringify({ role, sub })}', false); SET ROLE ${role === 'service_role' ? 'service_role' : role};`);
  try { return await fn(); } finally { await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claims', '', false);`); }
}

const ID = {
  lee: '00000000-0000-4000-8000-000000000001',
  postgod: '00000000-0000-4000-8000-000000000002',
  jordan: '00000000-0000-4000-8000-000000000003',
  hunter158: '00000000-0000-4000-8000-000000000004',
  external: '00000000-0000-4000-8000-000000000005',
  newTeam: '00000000-0000-4000-8000-000000000006',
  newUser: '00000000-0000-4000-8000-000000000007',
  sneaky: '00000000-0000-4000-8000-000000000008',
  later: '00000000-0000-4000-8000-000000000009',
};

// ─── Supabase-ish base ──────────────────────────────────────────────────────
await db.exec(`
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
$$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
$$;

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY, username text, is_internal boolean NOT NULL DEFAULT false,
  location text, zip_code text, latitude double precision, longitude double precision,
  updated_at timestamptz DEFAULT now());
CREATE TABLE public.bounties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), poster_id uuid, user_id uuid, title text,
  status text NOT NULL DEFAULT 'open', accepted_by uuid, is_test boolean NOT NULL DEFAULT false);
GRANT ALL ON public.profiles, public.bounties TO service_role;
`);

// Prod on 2026-10-22: lee + postgod flagged; jordanmag11 re-registered with a
// listed address and hunterbnty158 never listed, both external.
await q(`INSERT INTO auth.users (id, email) VALUES
  ($1, 'leewright093@gmail.com'), ($2, 'posterbnty158@gmail.com'), ($3, 'jordanmag11@yahoo.com'),
  ($4, 'hunterbnty158@gmail.com'), ($5, 'someone@example.org')`,
  [ID.lee, ID.postgod, ID.jordan, ID.hunter158, ID.external]);
await q(`INSERT INTO public.profiles (id, username, is_internal) VALUES
  ($1, 'Robert Wright', true), ($2, 'postgod', true), ($3, 'jordanmag11', false),
  ($4, 'hunterbnty158', false), ($5, 'someone', false)`,
  [ID.lee, ID.postgod, ID.jordan, ID.hunter158, ID.external]);
const couch = (await one(`INSERT INTO public.bounties (poster_id, title, accepted_by, is_test) VALUES ($1, 'Move a couch', $2, false) RETURNING id`, [ID.postgod, ID.external])).id;
const brand = (await one(`INSERT INTO public.bounties (poster_id, title, status, is_test) VALUES ($1, 'Work a brand activation', 'in_progress', false) RETURNING id`, [ID.jordan])).id;
const ext = (await one(`INSERT INTO public.bounties (user_id, title, is_test) VALUES ($1, 'Real job', false) RETURNING id`, [ID.external])).id;
// Prod's NOT VALID constraint permits this legacy row to exist but rejects any
// update to it while it remains open with an accepted_by value.
await db.exec(`ALTER TABLE public.bounties
  ADD CONSTRAINT bounties_open_implies_unassigned
  CHECK (status <> 'open' OR accepted_by IS NULL) NOT VALID`);
// Profiles that predate the ZIP migration (for the backfill).
await q(`INSERT INTO public.profiles (id, username, location) VALUES
  ('10000000-0000-4000-8000-000000000001', 'chico', 'Native Oak Dr, Chico, CA, 95928'),
  ('10000000-0000-4000-8000-000000000002', 'dc', 'Roxanna Road Northwest, Washington, District of Columbia, 20012'),
  ('10000000-0000-4000-8000-000000000003', 'approx', 'Austin, Texas'),
  ('10000000-0000-4000-8000-000000000004', 'typed', 'Faro Dr, Austin, TX, 78741')`);
await q(`UPDATE public.profiles SET zip_code = '78702' WHERE username = 'typed'`);

// ─── 20261022120000: internal accounts ─────────────────────────────────────
console.log('\ninternal accounts flagged at creation');
await db.exec(INTERNAL);
await db.exec(INTERNAL);

const flags = Object.fromEntries((await q(`SELECT username, is_internal FROM public.profiles WHERE username IN ('Robert Wright','postgod','jordanmag11','hunterbnty158','someone')`)).rows.map(r => [r.username, r.is_internal]));
check('re-registered team address is flagged (jordanmag11)', flags.jordanmag11 === true, flags);
check('address from lib/posthog.ts is flagged (hunterbnty158)', flags.hunterbnty158 === true, flags);
check('already-internal accounts stay internal', flags['Robert Wright'] && flags.postgod, flags);
check('an unlisted account stays external', flags.someone === false, flags);
check('18 addresses on the list after two applies', (await one(`SELECT count(*)::int n FROM public.internal_account_emails`)).n === 18);

const tests = Object.fromEntries((await q(`SELECT id, is_test FROM public.bounties`)).rows.map(r => [r.id, r.is_test]));
check('legacy check-violating bounty is isolated (2a39dbf2)', tests[couch] === false, tests);
check("newly flagged account's bounty becomes test (59879908)", tests[brand] === true, tests);
check("external poster's bounty is untouched", tests[ext] === false, tests);

// A listed address signs up again: auth.users row first, then the profile
// (handle_new_user runs with no JWT).
await q(`INSERT INTO auth.users (id, email) VALUES ($1, '  MaglalangJordan4@Gmail.com ')`, [ID.newTeam]);
await q(`INSERT INTO public.profiles (id, username) VALUES ($1, 'MathewM04-again')`, [ID.newTeam]);
check('a listed address is internal from its first row (case/space-insensitive)',
  (await one(`SELECT is_internal FROM public.profiles WHERE id = $1`, [ID.newTeam])).is_internal === true);

await q(`INSERT INTO auth.users (id, email) VALUES ($1, 'new.person@gmail.com')`, [ID.newUser]);
await q(`INSERT INTO public.profiles (id, username) VALUES ($1, 'newperson')`, [ID.newUser]);
check('an unlisted signup is external',
  (await one(`SELECT is_internal FROM public.profiles WHERE id = $1`, [ID.newUser])).is_internal === false);

await q(`INSERT INTO auth.users (id, email) VALUES ($1, 'sneaky@gmail.com')`, [ID.sneaky]);
await asClient('authenticated', ID.sneaky, () =>
  q(`INSERT INTO public.profiles (id, username, is_internal) VALUES ($1, 'sneaky', true)`, [ID.sneaky]));
check('a client cannot create its profile internal',
  (await one(`SELECT is_internal FROM public.profiles WHERE id = $1`, [ID.sneaky])).is_internal === false);

const selfFlag = await asClient('authenticated', ID.sneaky, () =>
  rejects(`UPDATE public.profiles SET is_internal = true WHERE id = $1`, [ID.sneaky]));
// The message, not just 42501 (also plain permission-denied), proves the
// guard refused it rather than a missing grant.
const guarded = e => e?.code === '42501' && /managed server-side/.test(e.message);
check('a client cannot flag itself internal (42501)', guarded(selfFlag), selfFlag?.message);
const selfUnflag = await asClient('authenticated', ID.jordan, () =>
  rejects(`UPDATE public.profiles SET is_internal = false WHERE id = $1`, [ID.jordan]));
check('an internal client cannot unflag itself (42501)', guarded(selfUnflag), selfUnflag?.message);
const sameValue = await asClient('authenticated', ID.jordan, () =>
  rejects(`UPDATE public.profiles SET is_internal = true, username = 'jordanmag11' WHERE id = $1`, [ID.jordan]));
check('a client update that resends the unchanged flag still works', sameValue === null, sameValue?.message);

const listRead = await asClient('authenticated', ID.sneaky, () => rejects(`SELECT * FROM public.internal_account_emails`));
check('clients cannot read the list', listRead !== null);
const listWrite = await asClient('authenticated', ID.sneaky, () =>
  rejects(`INSERT INTO public.internal_account_emails (email) VALUES ('sneaky@gmail.com')`));
check('clients cannot add to the list', listWrite !== null);
const patternRow = await rejects(`INSERT INTO public.internal_account_emails (email) VALUES ('Mixed@Case.com')`);
check('the list only takes lowercased exact addresses', patternRow !== null);

// The admin toggle: adding an address flags an existing external account and
// marks its bounties test.
await q(`INSERT INTO auth.users (id, email) VALUES ($1, 'teammate@gmail.com')`, [ID.later]);
await q(`INSERT INTO public.profiles (id, username) VALUES ($1, 'teammate')`, [ID.later]);
const laterBounty = (await one(`INSERT INTO public.bounties (poster_id, title) VALUES ($1, 'QA post') RETURNING id`, [ID.later])).id;
check('precondition: unlisted teammate starts external',
  (await one(`SELECT is_internal FROM public.profiles WHERE id = $1`, [ID.later])).is_internal === false);
await asClient('service_role', null, () =>
  q(`INSERT INTO public.internal_account_emails (email, note) VALUES ('teammate@gmail.com', 'added by admin')`));
check('adding the address flags the account',
  (await one(`SELECT is_internal FROM public.profiles WHERE id = $1`, [ID.later])).is_internal === true);
check("and that account's bounty leaves the feed (is_test)",
  (await one(`SELECT is_test FROM public.bounties WHERE id = $1`, [laterBounty])).is_test === true);

// Service role may still set the flag directly.
const svc = await asClient('service_role', null, () =>
  rejects(`UPDATE public.profiles SET is_internal = false WHERE id = $1`, [ID.later]));
check('service role can still change the flag', svc === null, svc?.message);

// ─── 20261022120100: ZIP from the location label ───────────────────────────
console.log('\nprofile ZIP from the reverse-geocoded location');
await db.exec(ZIP);
await db.exec(ZIP);
const zipOf = async (username) => (await one(`SELECT zip_code FROM public.profiles WHERE username = $1`, [username]))?.zip_code ?? null;
const newProfile = async (username, location, zip = null) => {
  const id = (await one(`SELECT gen_random_uuid() AS id`)).id;
  await q(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [id, `${username}@example.org`]);
  await q(`INSERT INTO public.profiles (id, username, location, zip_code) VALUES ($1, $2, $3, $4)`, [id, username, location, zip]);
  return id;
};

await newProfile('precise', 'I-77 N, Charlotte, NC, 28217');
check('onboarding label "street, city, ST, ZIP" fills zip_code', (await zipOf('precise')) === '28217', await zipOf('precise'));
await newProfile('spelled', 'Northgate Boulevard, Austin, Texas, 78758');
check('spelled-out state works too', (await zipOf('spelled')) === '78758');
await newProfile('zip4', 'Main St, Austin, TX 78741-1234');
check('ZIP+4 keeps the 5-digit ZIP', (await zipOf('zip4')) === '78741', await zipOf('zip4'));
await newProfile('approximate', 'Austin, Texas');
check('"Only use approximate" (no ZIP in the label) derives nothing', (await zipOf('approximate')) === null);
await newProfile('nolabel', null);
check('no location -> no ZIP', (await zipOf('nolabel')) === null);
await newProfile('number', '1234 Main St, Austin');
check('a street number is not a ZIP', (await zipOf('number')) === null, await zipOf('number'));
await newProfile('given', 'Native Oak Dr, Chico, CA, 95928', '95926');
check('an explicit zip_code on insert wins', (await zipOf('given')) === '95926');

const preciseId = (await one(`SELECT id FROM public.profiles WHERE username = 'precise'`)).id;
await asClient('authenticated', preciseId, () =>
  q(`UPDATE public.profiles SET location = 'Faro Dr, Austin, TX, 78741' WHERE id = $1`, [preciseId]));
check('a derived ZIP follows a new label (client edit)', (await zipOf('precise')) === '78741', await zipOf('precise'));
await q(`UPDATE public.profiles SET location = 'Austin, Texas' WHERE id = $1`, [preciseId]);
check('a label without a ZIP leaves the ZIP alone', (await zipOf('precise')) === '78741');

const givenId = (await one(`SELECT id FROM public.profiles WHERE username = 'given'`)).id;
await q(`UPDATE public.profiles SET location = 'Roxanna Dr, Austin, TX, 78748' WHERE id = $1`, [givenId]);
check('a ZIP that did not come from the label is not overwritten', (await zipOf('given')) === '95926');
await q(`UPDATE public.profiles SET location = 'Rutland Dr, Austin, TX, 78758', zip_code = '73301' WHERE id = $1`, [givenId]);
check('an explicit zip_code in the same UPDATE wins', (await zipOf('given')) === '73301');

// Backfill
const dry = await one(`SELECT * FROM public.fn_backfill_profile_zip_from_location()`);
check('dry run is the default and reports candidates without writing',
  dry.dry_run === true && dry.candidates === 2 && dry.filled === 0 && (await zipOf('chico')) === null, dry);
const run = await one(`SELECT * FROM public.fn_backfill_profile_zip_from_location(false)`);
check('real run fills exactly the candidates', run.filled === 2 && run.candidates === 2, run);
check('filled from the label', (await zipOf('chico')) === '95928' && (await zipOf('dc')) === '20012');
check('approximate label stays empty', (await zipOf('approx')) === null);
check('existing ZIP untouched', (await zipOf('typed')) === '78702');
check('every fill is logged', (await one(`SELECT count(*)::int n FROM public.profile_zip_backfill_log`)).n === 2);
const again = await one(`SELECT * FROM public.fn_backfill_profile_zip_from_location(false)`);
check('second run is a no-op', again.candidates === 0 && again.filled === 0, again);
const clientRun = await asClient('authenticated', ID.sneaky, () =>
  rejects(`SELECT * FROM public.fn_backfill_profile_zip_from_location(false)`));
check('clients cannot run the backfill', clientRun !== null);

// Undo: a backfilled ZIP the user later changed is kept.
await q(`UPDATE public.profiles SET zip_code = '20011' WHERE username = 'dc'`);
await db.exec(ZIP_DOWN);
check('rollback clears unchanged backfilled ZIPs', (await zipOf('chico')) === null);
check('rollback keeps a backfilled ZIP the user changed', (await zipOf('dc')) === '20011');
check('rollback keeps ZIPs it did not write', (await zipOf('typed')) === '78702');
check('rollback drops the trigger', (await one(`SELECT count(*)::int n FROM pg_trigger WHERE tgname = 'trg_profiles_zip_from_location'`)).n === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
