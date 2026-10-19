/* scripts/verify-search-nearby-online.js
 *
 * Staging check for
 * supabase/migrations/20261019210000_search_bounties_nearby_include_online.sql
 * (SBA-02 client side, docs/audits/shoal-behavioral-audit.md).
 *
 * Runs in ONE transaction on staging and ALWAYS rolls back. Uses Shoal pool
 * accounts (qa/shoal/README.md), all is_internal, and seeds its own is_test
 * bounties, so no real user is involved and nothing persists. If the
 * migration is not applied yet, it is applied inside the transaction.
 *
 * Seeds three open bounties and searches as a hunter in Baltimore:
 *   near    in-person, Baltimore (39.2904, -76.6122)   ~3 mi
 *   far     in-person, Philadelphia (39.9526, -75.1652) ~90 mi
 *   online  online, no point
 *
 * What it proves:
 *   1. p_include_online = false (and the 7-argument call installed builds
 *      make) returns exactly what it did before: near only.
 *   2. p_include_online = true keeps online jobs in a 25 mi search, after
 *      every in-person row, and still drops the far in-person job.
 *   3. No radius: all three, unchanged.
 *   4. work_type comes back on every row.
 *   5. EXECUTE: anon and authenticated yes, PUBLIC no.
 *
 * Usage: PGSSLROOTCERT=/path/to/supabase-ca.crt node scripts/verify-search-nearby-online.js
 *        (staging only)
 * Exits non-zero if any check fails.
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const { candidateUrls } = require('./lib/ro-query');

const ROOT = path.resolve(__dirname, '..');
const MIGRATION = path.join(ROOT, 'supabase/migrations/20261019210000_search_bounties_nearby_include_online.sql');
const STAGING_REF = 'gwumwpoomwvkjyibdmpj';

const ENV = (process.argv.find((a) => a.startsWith('--env=')) || '--env=staging').slice(6);
if (ENV !== 'staging') {
  console.error('verify-search-nearby-online only runs against staging (it writes inside a rolled-back transaction).');
  process.exit(2);
}

const HUNTER = { email: 'qa+shoal-hunter-11@bountyfinder.test', lat: 39.33, lng: -76.62 };
const POSTER_EMAIL = 'qa+shoal-poster-12@bountyfinder.test';
const JOBS = {
  near: { workType: 'in_person', lat: 39.2904, lng: -76.6122, address: '100 N Holliday St, Baltimore, MD 21202' },
  far: { workType: 'in_person', lat: 39.9526, lng: -75.1652, address: '1400 John F Kennedy Blvd, Philadelphia, PA 19107' },
  online: { workType: 'online' },
};
const NEW_SIGNATURE =
  'public.search_bounties_nearby(double precision,double precision,double precision,text,integer,integer,boolean,boolean)';

let failures = 0;
function check(name, ok, detail) {
  if (ok) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail !== undefined ? ` -- ${JSON.stringify(detail)}` : ''}`);
  }
}

// Supabase's pooler presents a certificate signed by its own root CA:
// PGSSLROOTCERT=/path/to/supabase-ca.crt (Dashboard > Database > SSL Configuration).
async function connect() {
  const ca = process.env.PGSSLROOTCERT;
  const ssl = ca ? { rejectUnauthorized: true, ca: fs.readFileSync(ca, 'utf8') } : { rejectUnauthorized: true };
  let lastError;
  for (const connectionString of candidateUrls('staging')) {
    const c = new Client({ connectionString, ssl, connectionTimeoutMillis: 10000 });
    try {
      await c.connect();
      return c;
    } catch (err) {
      await c.end().catch(() => {});
      if (/self[- ]signed|unable to verify|certificate/i.test(err.message)) {
        throw new Error(`${err.message}\nSet PGSSLROOTCERT to Supabase's root CA.`);
      }
      lastError = err;
    }
  }
  throw lastError;
}

async function main() {
  const c = await connect();
  const user = c.connectionParameters.user || '';
  const host = c.connectionParameters.host || '';
  if (!user.includes(STAGING_REF) && !host.includes(STAGING_REF)) {
    await c.end();
    throw new Error(`refusing: connection is not staging (${user}@${host})`);
  }

  try {
    await c.query('BEGIN');

    const { rows: applied } = await c.query('SELECT to_regprocedure($1) IS NOT NULL AS ok', [NEW_SIGNATURE]);
    if (!applied[0].ok) {
      console.log('Migration not applied on staging; applying inside the transaction');
      const sql = fs.readFileSync(MIGRATION, 'utf8').replace(/^BEGIN;\s*$/m, '').replace(/^COMMIT;\s*$/m, '');
      await c.query(sql);
    } else {
      console.log('Migration already applied on staging');
    }

    const { rows: accounts } = await c.query(
      `SELECT u.email, p.id, p.is_internal FROM auth.users u JOIN public.profiles p ON p.id = u.id WHERE u.email = ANY($1)`,
      [[HUNTER.email, POSTER_EMAIL]],
    );
    const idOf = Object.fromEntries(accounts.map((a) => [a.email, a.id]));
    if (!idOf[HUNTER.email] || !idOf[POSTER_EMAIL]) {
      throw new Error('pool accounts missing on staging (run qa/shoal/bin/seed.mjs accounts)');
    }
    check('every account used is an internal pool account', accounts.every((a) => a.is_internal === true), accounts);

    const ids = {};
    for (const [key, job] of Object.entries(JOBS)) {
      const inPerson = job.workType === 'in_person';
      const { rows } = await c.query(
        `INSERT INTO public.bounties (user_id, poster_id, title, description, amount, work_type, location,
                                      latitude, longitude, is_test, status)
         VALUES ($1, $1, $2, 'SBA-02 staging check, rolled back', 25, $3, $4, $5, $6, true, 'open')
         RETURNING id`,
        [
          idOf[POSTER_EMAIL],
          `[sba02-feed-check] ${key}`,
          job.workType,
          inPerson ? job.address : null,
          inPerson ? job.lat : null,
          inPerson ? job.lng : null,
        ],
      );
      ids[rows[0].id] = key;
    }
    const seeded = Object.keys(ids);

    await c.query('SET LOCAL ROLE authenticated');
    await c.query("SELECT set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: idOf[HUNTER.email], role: 'authenticated' }),
    ]);

    // Only the seeded rows: staging has other open bounties. p_limit 100 is
    // the RPC's ceiling; the seeded rows are newest, so they are in range.
    async function search(sql, params) {
      const { rows } = await c.query(sql, params);
      return rows.filter((r) => ids[r.id]).map((r) => ({ key: ids[r.id], work_type: r.work_type, miles: r.distance_miles }));
    }
    const at = [HUNTER.lat, HUNTER.lng];

    console.log('\nRadius 25 mi, online excluded (installed builds)');
    const legacy = await search(
      'SELECT * FROM public.search_bounties_nearby($1, $2, 25, NULL, 100, 0, true)',
      at,
    );
    check('7-argument call resolves and returns the near job only', legacy.map((r) => r.key).join() === 'near', legacy);
    const off = await search(
      'SELECT * FROM public.search_bounties_nearby($1, $2, 25, NULL, 100, 0, true, false)',
      at,
    );
    check('p_include_online = false matches the 7-argument call', JSON.stringify(off) === JSON.stringify(legacy), off);

    console.log('\nRadius 25 mi, online included (new default feed)');
    const on = await search(
      'SELECT * FROM public.search_bounties_nearby($1, $2, 25, NULL, 100, 0, true, true)',
      at,
    );
    const keys = on.map((r) => r.key);
    check('near and online returned, far dropped', keys.includes('near') && keys.includes('online') && !keys.includes('far'), on);
    check('online sorts after the in-person row', keys.indexOf('online') > keys.indexOf('near'), keys);
    check('online row has no distance', on.find((r) => r.key === 'online')?.miles === null, on);
    check('work_type returned', on.every((r) => r.work_type === JOBS[r.key].workType), on);

    console.log('\nNo radius');
    const all = await search(
      'SELECT * FROM public.search_bounties_nearby($1, $2, NULL, NULL, 100, 0, true, false)',
      at,
    );
    check('all three returned', ['near', 'far', 'online'].every((k) => all.some((r) => r.key === k)), all);

    await c.query('RESET ROLE');
    console.log('\nGrants');
    const { rows: priv } = await c.query(
      `SELECT has_function_privilege('anon', $1, 'EXECUTE') AS anon,
              has_function_privilege('authenticated', $1, 'EXECUTE') AS authenticated,
              EXISTS (
                SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                WHERE p.oid = $1::regprocedure AND a.grantee = 0 AND a.privilege_type = 'EXECUTE'
              ) AS public`,
      [NEW_SIGNATURE],
    );
    check('anon and authenticated can execute; PUBLIC cannot',
      priv[0].anon && priv[0].authenticated && !priv[0].public, priv[0]);
    const { rows: def } = await c.query(
      'SELECT prosecdef, proconfig FROM pg_proc WHERE oid = $1::regprocedure',
      [NEW_SIGNATURE],
    );
    check('SECURITY DEFINER with a fixed search_path',
      def[0].prosecdef && (def[0].proconfig || []).some((s) => s.startsWith('search_path=')), def[0]);
  } finally {
    await c.query('ROLLBACK').catch(() => {});
    await c.end();
  }

  console.log(failures ? `\n${failures} check(s) FAILED (rolled back)` : '\nAll checks passed (rolled back)');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
