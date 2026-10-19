/* scripts/verify-username-rate-limit-pglite.js
 *
 * Functional checks for the rate-limited is_username_available()
 * (supabase/migrations/20261019235800_is_username_available_rate_limit.sql)
 * on an in-process PostgreSQL (PGlite). It loads the original function
 * (20261019195723), then the rate-limit migration, then the rollback, exactly
 * as shipped, against a minimal Supabase stand-in: anon/authenticated/
 * service_role roles, auth.uid() from request.jwt.claims, and the default
 * EXECUTE/table grants Supabase gives new public objects (so the REVOKEs are
 * really tested).
 *
 * Each call runs the way PostgREST runs it: its own transaction, SET LOCAL
 * ROLE, request.headers and request.jwt.claims set locally.
 *
 * Usage:
 *   npm i --no-save @electric-sql/pglite      (or set PGLITE_DIR to a folder that has it)
 *   node scripts/verify-username-rate-limit-pglite.js
 */
const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const ORIGINAL = read('supabase/migrations/20261019195723_is_username_available.sql');
const MIGRATION = read('supabase/migrations/20261019235800_is_username_available_rate_limit.sql');
const ROLLBACK = read('supabase/rollbacks/production/20261019235800_is_username_available_rate_limit.down.sql');

function loadPGlite() {
  const from = process.env.PGLITE_DIR ? path.join(process.env.PGLITE_DIR, 'noop.js') : __filename;
  const req = createRequire(from);
  return import(pathToFileURL(req.resolve('@electric-sql/pglite')).href).then((m) => m.PGlite);
}

const SCHEMA = `
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid
$$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
CREATE TABLE public.profiles (id uuid PRIMARY KEY, username text UNIQUE);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_row ON public.profiles FOR SELECT USING (auth.uid() = id);
`;

const ALICE = '00000000-0000-0000-0000-0000000000a1';
const BOB = '00000000-0000-0000-0000-0000000000b2';
const CAROL = '00000000-0000-0000-0000-0000000000c3';

const results = [];
function check(name, ok, info) {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info !== undefined ? '  -- ' + JSON.stringify(info) : ''}`);
}

async function main() {
  const PGlite = await loadPGlite();
  const db = await PGlite.create();
  await db.exec(SCHEMA);
  await db.query(`INSERT INTO public.profiles (id, username) VALUES ($1, 'alice'), ($2, 'bob')`, [ALICE, BOB]);
  await db.exec(ORIGINAL);
  await db.exec(MIGRATION);
  check('original function, then the rate-limit migration, load', true);

  // One PostgREST-style request. headers === null means a direct DB session.
  const call = async (name, { role = 'anon', uid = null, headers = { 'x-forwarded-for': '203.0.113.7' }, readOnly = false } = {}) => {
    const claims = JSON.stringify(uid ? { role, sub: uid } : { role });
    try {
      await db.exec(readOnly ? 'BEGIN READ ONLY' : 'BEGIN');
      await db.query(`SELECT set_config('request.jwt.claims', $1, true)`, [claims]);
      if (headers) await db.query(`SELECT set_config('request.headers', $1, true)`, [JSON.stringify(headers)]);
      await db.exec(`SET LOCAL ROLE ${role}`);
      const r = await db.query(`SELECT public.is_username_available($1) AS v`, [name]);
      await db.exec('COMMIT');
      return { ok: true, v: r.rows[0].v };
    } catch (e) {
      await db.exec('ROLLBACK');
      return { ok: false, code: e.code, message: e.message, detail: e.detail };
    }
  };
  const rows = async () => (await db.query(`SELECT bucket, hits FROM public.username_check_rate_limits ORDER BY bucket`)).rows;
  const hitsFor = async (key) => {
    const r = await db.query(`SELECT coalesce(sum(hits), 0)::int AS n FROM public.username_check_rate_limits WHERE bucket = md5($1)`, [key]);
    return r.rows[0].n;
  };
  const reset = () => db.exec('DELETE FROM public.username_check_rate_limits');

  // --- Answers (unchanged from 20261019195723) ---
  check('signed out: an existing name is taken', (await call('alice')).v === false);
  check('signed out: case-insensitive (ALICE)', (await call('ALICE')).v === false);
  check('signed out: a fresh name is free', (await call('fresh_name')).v === true);
  check('malformed input returns NULL', (await call('a b')).v === null && (await call('ab')).v === null);
  check('the owner sees their own name as free', (await call('alice', { role: 'authenticated', uid: ALICE })).v === true);
  check('another signed-in user sees it as taken', (await call('alice', { role: 'authenticated', uid: BOB })).v === false);

  // --- Counting ---
  await reset();
  await call('alice');
  const stored = await rows();
  check('a signed-out call is counted under md5(ip), never the raw IP',
    stored.length === 1 && stored[0].bucket === (await db.query(`SELECT md5('ip:203.0.113.7') m`)).rows[0].m
      && !JSON.stringify(stored).includes('203.0.113.7'), stored);

  await reset();
  await call('alice', { headers: { 'cf-connecting-ip': '198.51.100.9', 'x-forwarded-for': '6.6.6.6, 198.51.100.9' } });
  check('cf-connecting-ip wins over a client-supplied X-Forwarded-For', (await hitsFor('ip:198.51.100.9')) === 1 && (await hitsFor('ip:6.6.6.6')) === 0);

  await reset();
  await call('alice', { headers: { 'x-forwarded-for': '192.0.2.1, 10.0.0.1' } });
  check('without cf-connecting-ip, the first X-Forwarded-For hop is used', (await hitsFor('ip:192.0.2.1')) === 1);

  await reset();
  await call('alice', { role: 'authenticated', uid: CAROL });
  check('a signed-in call is counted by user id, not IP', (await hitsFor(`uid:${CAROL}`)) === 1 && (await hitsFor('ip:203.0.113.7')) === 0);

  await reset();
  const direct = await call('alice', { headers: null });
  check('a direct DB session (no request headers) is not limited or recorded', direct.ok && (await rows()).length === 0);
  const svc = await call('alice', { role: 'service_role' });
  check('the service role is not limited or recorded', svc.ok && svc.v === false && (await rows()).length === 0, svc);

  // --- Per-minute limit ---
  await reset();
  let allOk = true;
  for (let i = 0; i < 30; i++) allOk = allOk && (await call(`name_${i}`)).ok;
  check('30 calls in a minute are answered', allOk);
  const over = await call('alice');
  let detail = {};
  try { detail = JSON.parse(over.detail || '{}'); } catch { /* checked below */ }
  check('the 31st is refused with PGRST / HTTP 429 / rate_limited',
    !over.ok && over.code === 'PGRST' && detail.status === 429 && JSON.parse(over.message).code === 'rate_limited', over);
  check('a refused call is not counted (rolled back)', (await hitsFor('ip:203.0.113.7')) === 30);
  check('another IP is unaffected', (await call('alice', { headers: { 'x-forwarded-for': '203.0.113.8' } })).ok);
  check('a signed-in user behind the same IP is unaffected',
    (await call('alice', { role: 'authenticated', uid: CAROL, headers: { 'x-forwarded-for': '203.0.113.7' } })).ok);
  await db.exec(`UPDATE public.username_check_rate_limits SET window_start = window_start - interval '1 minute'`);
  check('the next minute answers again', (await call('alice')).ok);

  // --- Per-hour limit ---
  await reset();
  await db.query(
    `INSERT INTO public.username_check_rate_limits (bucket, window_start, hits)
     SELECT md5('ip:203.0.113.7'), date_trunc('minute', now()) - make_interval(mins => g), 30
       FROM generate_series(1, 10) g`);
  const hourly = await call('alice');
  check('300 calls within the hour (none this minute) refuse the next', !hourly.ok && hourly.code === 'PGRST', hourly);
  await db.query(`UPDATE public.username_check_rate_limits SET window_start = window_start - interval '1 hour' WHERE window_start < date_trunc('minute', now()) - interval '5 minutes'`);
  check('...and answer again once old windows leave the hour', (await call('alice')).ok);

  // --- Housekeeping ---
  await reset();
  await db.query(`INSERT INTO public.username_check_rate_limits VALUES (md5('ip:old'), now() - interval '3 hours', 5)`);
  for (let i = 0; i < 300 && (await hitsFor('ip:old')) > 0; i++) {
    await call('alice', { headers: { 'x-forwarded-for': `198.18.${i % 250}.1` } });
  }
  check('stale windows (> 2 h) are swept', (await hitsFor('ip:old')) === 0);

  // --- GET (read-only) cannot skip the counter ---
  const get = await call('alice', { readOnly: true });
  check('a read-only transaction (PostgREST GET) fails instead of answering uncounted', !get.ok && get.code === '25006', get);

  // --- Grants, definer, search_path ---
  const fn = (await db.query(`
    SELECT p.prosecdef, p.provolatile, p.proconfig,
           has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_x,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_x,
           EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0) AS public_x
      FROM pg_proc p WHERE p.oid = 'public.is_username_available(text)'::regprocedure`)).rows[0];
  check('SECURITY DEFINER, VOLATILE, search_path=""',
    fn.prosecdef === true && fn.provolatile === 'v' && JSON.stringify(fn.proconfig) === JSON.stringify(['search_path=""']), fn);
  check('EXECUTE for anon and authenticated; none for PUBLIC', fn.anon_x && fn.auth_x && !fn.public_x, fn);

  const tbl = (await db.query(`
    SELECT c.relrowsecurity AS rls,
           has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE') AS anon_any,
           has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE') AS auth_any
      FROM pg_class c WHERE c.oid = 'public.username_check_rate_limits'::regclass`)).rows[0];
  check('counter table: RLS on, no anon/authenticated privileges', tbl.rls && !tbl.anon_any && !tbl.auth_any, tbl);
  let direct_read;
  try {
    await db.exec('BEGIN; SET LOCAL ROLE anon;');
    await db.query('SELECT * FROM public.username_check_rate_limits');
    direct_read = 'allowed';
  } catch (e) {
    direct_read = e.code;
  } finally {
    await db.exec('ROLLBACK');
  }
  check('anon cannot read the counter table directly', direct_read === '42501', direct_read);

  // --- Rollback ---
  await db.exec(ROLLBACK);
  const after = (await db.query(`
    SELECT p.provolatile, to_regclass('public.username_check_rate_limits') AS tbl,
           has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_x
      FROM pg_proc p WHERE p.oid = 'public.is_username_available(text)'::regprocedure`)).rows[0];
  check('rollback restores the STABLE function and drops the table',
    after.provolatile === 's' && after.tbl === null && after.anon_x, after);
  check('...and it still answers', (await call('alice')).v === false);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
