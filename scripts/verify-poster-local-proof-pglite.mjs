/* scripts/verify-poster-local-proof-pglite.mjs
 *
 * Functional checks for
 *   supabase/migrations/20261108120000_poster_local_proof.sql
 * on an in-process PostgreSQL + PostGIS (PGlite). Touches no remote database.
 * The schema is a minimal stand-in with the columns the function reads.
 *
 * Usage:
 *   npm i --no-save @electric-sql/pglite @electric-sql/pglite-postgis
 *     (or set PGLITE_DIR to a folder that has them)
 *   node scripts/verify-poster-local-proof-pglite.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const req = createRequire(process.env.PGLITE_DIR ? path.join(process.env.PGLITE_DIR, 'noop.js') : import.meta.url);
const { PGlite } = await import(pathToFileURL(req.resolve('@electric-sql/pglite')).href);
const { postgis } = await import(pathToFileURL(req.resolve('@electric-sql/pglite-postgis')).href);

const UP = fs.readFileSync(`${REPO}/supabase/migrations/20261108120000_poster_local_proof.sql`, 'utf8');
const DOWN = fs.readFileSync(`${REPO}/supabase/rollbacks/production/20261108120000_poster_local_proof.down.sql`, 'utf8');

const db = await PGlite.create({ extensions: { postgis } });
let pass = 0;
let fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok  ', name); }
  else { fail++; console.log('  FAIL', name, detail !== undefined ? JSON.stringify(detail) : ''); }
}

await db.exec(`
  CREATE EXTENSION IF NOT EXISTS postgis;
  CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
  CREATE SCHEMA auth; CREATE SCHEMA extensions;
  GRANT USAGE ON SCHEMA public, auth, extensions TO anon, authenticated, service_role;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
    $$ SELECT nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid $$;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated;

  CREATE TABLE public.profiles (
    id uuid PRIMARY KEY,
    latitude double precision, longitude double precision,
    last_session_at timestamptz,
    primary_role text,
    account_status text NOT NULL DEFAULT 'active',
    is_internal boolean
  );
  CREATE TYPE bounty_status_enum AS ENUM ('open', 'in_progress', 'completed', 'archived');
  CREATE TABLE public.bounties (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    status bounty_status_enum NOT NULL DEFAULT 'open',
    is_test boolean NOT NULL DEFAULT false,
    geom geography(Point, 4326),
    completed_at timestamptz,
    updated_at timestamp NOT NULL DEFAULT now(),
    poster_id uuid, user_id uuid, accepted_by uuid
  );
`);
await db.exec(UP);
await db.exec(UP); // idempotent

// Los Angeles, and points about 10 and 60 miles away.
const LA = [34.0522, -118.2437];
const NEAR = [34.14, -118.15];
const FAR = [34.9, -118.2437];
let seq = 0;
const uid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

async function hunter({ at = NEAR, seen = "now() - interval '1 day'", role = 'hunter', status = 'active', internal = false, id = uid() } = {}) {
  await db.query(
    `INSERT INTO public.profiles (id, latitude, longitude, last_session_at, primary_role, account_status, is_internal)
     VALUES ($1, $2, $3, ${seen}, $4, $5, $6)`,
    [id, at?.[0] ?? null, at?.[1] ?? null, role, status, internal]
  );
  return id;
}
async function completed({ at = NEAR, when = "now() - interval '3 days'", isTest = false, status = 'completed', poster = null } = {}) {
  await db.query(
    `INSERT INTO public.bounties (status, is_test, geom, completed_at, poster_id)
     VALUES ($1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography, ${when}, $5)`,
    [status, isTest, at[1], at[0], poster]
  );
}
async function asUser(sub, sql, params) {
  await db.exec(`SELECT set_config('request.jwt.claims', '${JSON.stringify({ sub })}', false); SET ROLE authenticated;`);
  try { return (await db.query(sql, params)).rows; }
  finally { await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claims', '', false);`); }
}
const CALLER = '00000000-0000-4000-8000-00000000abcd';
const proof = async (lat = LA[0], lng = LA[1], radius = 25, caller = CALLER) =>
  (await asUser(caller, 'SELECT public.fn_poster_local_proof($1, $2, $3) AS r', [lat, lng, radius]))[0].r;

// Below the minimum: nothing is readable.
await hunter(); await hunter();
await completed(); await completed();
let r = await proof();
check('2 hunters comes back NULL', r.hunters_active_7d === null, r);
check('2 completions comes back NULL', r.bounties_completed_30d === null, r);

// At the minimum.
await hunter({ role: 'both' });
await completed();
r = await proof();
check('3 hunters is shown (role both counts)', r.hunters_active_7d === 3, r);
check('3 completions is shown', r.bounties_completed_30d === 3, r);

// None of these may change the counts.
await hunter({ internal: true });
await hunter({ status: 'suspended' });
await hunter({ status: 'banned' });
await hunter({ role: 'poster' });
await hunter({ seen: "now() - interval '8 days'" });
await hunter({ seen: 'NULL' });
await hunter({ at: null });
await hunter({ at: FAR });
const internalPoster = await hunter({ internal: true, role: 'poster' });
await completed({ isTest: true });
await completed({ when: "now() - interval '31 days'" });
await completed({ at: FAR });
await completed({ status: 'open', when: 'NULL' });
await completed({ poster: internalPoster });
r = await proof();
check('excludes internal, suspended, banned, poster-only, stale, unlocated, out-of-radius hunters', r.hunters_active_7d === 3, r);
check('excludes test, old, out-of-radius, unfinished and internal-poster bounties', r.bounties_completed_30d === 3, r);

// The caller is not their own proof.
const self = await hunter();
r = await proof(LA[0], LA[1], 25, CALLER);
check('counts another hunter', r.hunters_active_7d === 4, r);
r = await proof(LA[0], LA[1], 25, self);
check('never counts the caller', r.hunters_active_7d === 3, r);

// A tiny radius can't isolate anyone: it clamps up to 25 miles.
r = await proof(LA[0], LA[1], 1);
check('radius floor is 25 miles', r.hunters_active_7d === 4, r);
r = await proof(LA[0], LA[1], 1000);
check('radius ceiling is 100 miles (the 60-mile hunter joins)', r.hunters_active_7d === 5, r);

// Bad input.
r = await proof(95, 0);
check('an invalid latitude returns NULLs', r.hunters_active_7d === null && r.bounties_completed_30d === null, r);

// A completion with no completed_at falls back to updated_at.
const before = (await proof()).bounties_completed_30d;
await db.query(
  `INSERT INTO public.bounties (status, geom, completed_at) VALUES ('completed', ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, NULL)`,
  [NEAR[1], NEAR[0]]
);
r = await proof();
check('a NULL completed_at uses updated_at', r.bounties_completed_30d === before + 1, r);

// The shape exposes only the two counts.
check('returns exactly the two counts', Object.keys(r).sort().join() === 'bounties_completed_30d,hunters_active_7d', r);

// Grants.
const canExec = async role =>
  (await db.query(`SELECT has_function_privilege($1, 'public.fn_poster_local_proof(double precision, double precision, double precision)', 'EXECUTE') AS ok`, [role])).rows[0].ok;
check('anon cannot execute', (await canExec('anon')) === false);
check('authenticated can execute', (await canExec('authenticated')) === true);
check('service_role can execute', (await canExec('service_role')) === true);

// Rollback.
await db.exec(DOWN);
const gone = (await db.query(`SELECT to_regprocedure('public.fn_poster_local_proof(double precision, double precision, double precision)') AS f`)).rows[0].f;
check('rollback removes the function', gone === null, gone);

console.log(`\n${pass} passed, ${fail} failed`);
await db.close();
process.exit(fail ? 1 : 0);
