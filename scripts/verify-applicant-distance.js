/* scripts/verify-applicant-distance.js
 *
 * Staging check for supabase/migrations/20261019200000_applicant_distance.sql
 * (SBA-02, docs/audits/shoal-behavioral-audit.md).
 *
 * Runs in ONE transaction on staging and ALWAYS rolls back. Uses Shoal pool
 * accounts (qa/shoal/README.md), all is_internal, and seeds its own is_test
 * bounties, so no real user is involved and nothing persists. Any
 * notification rows the inserts enqueue roll back with everything else.
 *
 * If the migration is not applied yet, the script seeds one application
 * first, applies the migration inside the transaction and checks the
 * backfill too. If it is applied, the backfill check is reported as skipped.
 *
 * Hunters at known points (the job is at 39.2904, -76.6122, Baltimore):
 *   near   shoal-hunter-11  39.3300, -76.6200   ~2.8 mi   -> ~3, not far
 *   far    shoal-hunter-12  39.9526, -75.1652   ~90 mi    -> ~90, is_far
 *   close  shoal-hunter-10  39.2950, -76.6150   ~0.4 mi   -> 0 ("under 1 mile")
 *   none   shoal-hunter-09  no location                   -> NULL, not far
 *
 * What it proves:
 *   1. Applications are stamped at insert from the approximate job point;
 *      values the client sends are discarded.
 *   2. FLAG, not block: a far in-person application and any online
 *      application are accepted; online jobs get no distance.
 *   3. Who can read it: the poster (existing select('*') path) and the
 *      applicant only. Other applicants and unrelated users cannot.
 *   4. The poster cannot rewrite distance_mi / is_far through their UPDATE
 *      policy, and a status change keeps the stored values.
 *   5. fn_bounty_request_distance is not callable by clients.
 *   6. The realtime broadcast that every applicant receives carries no
 *      distance.
 *   7. The weekly "done when" query runs and counts these rows.
 *
 * Usage: PGSSLROOTCERT=/path/to/supabase-ca.crt node scripts/verify-applicant-distance.js
 *        (staging only)
 * Exits non-zero if any check fails.
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const { candidateUrls } = require('./lib/ro-query');

const ROOT = path.resolve(__dirname, '..');
const MIGRATION = path.join(ROOT, 'supabase/migrations/20261019200000_applicant_distance.sql');
const STAGING_REF = 'gwumwpoomwvkjyibdmpj';

const ENV = (process.argv.find((a) => a.startsWith('--env=')) || '--env=staging').slice(6);
if (ENV !== 'staging') {
  console.error('verify-applicant-distance only runs against staging (it writes inside a rolled-back transaction).');
  process.exit(2);
}

const JOB = { lat: 39.2904, lng: -76.6122 };
const HUNTERS = {
  near: { email: 'qa+shoal-hunter-11@bountyfinder.test', lat: 39.33, lng: -76.62 },
  far: { email: 'qa+shoal-hunter-12@bountyfinder.test', lat: 39.9526, lng: -75.1652 },
  close: { email: 'qa+shoal-hunter-10@bountyfinder.test', lat: 39.295, lng: -76.615 },
  none: { email: 'qa+shoal-hunter-09@bountyfinder.test', lat: null, lng: null },
};
const POSTER_EMAIL = 'qa+shoal-poster-12@bountyfinder.test';
const OUTSIDER_EMAIL = 'qa+shoal-hunter-08@bountyfinder.test';

let failures = 0;
function check(name, ok, detail) {
  if (ok) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail !== undefined ? ` -- ${JSON.stringify(detail)}` : ''}`);
  }
}

function haversineMi(a, b) {
  const R = 3958.7613;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
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

async function asUser(c, userId) {
  await c.query('SET LOCAL ROLE authenticated');
  await c.query("SELECT set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: userId, role: 'authenticated' }),
  ]);
}

async function asOwner(c) {
  await c.query('RESET ROLE');
  await c.query("SELECT set_config('request.jwt.claims', '', true)");
}

/** Run a statement in a savepoint so an expected error doesn't abort the transaction. */
async function attempt(c, sql, params) {
  await c.query('SAVEPOINT attempt');
  try {
    const res = await c.query(sql, params);
    await c.query('RELEASE SAVEPOINT attempt');
    return { res };
  } catch (err) {
    await c.query('ROLLBACK TO SAVEPOINT attempt');
    return { err };
  }
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

    // ── accounts ────────────────────────────────────────────────────────────
    const emails = [POSTER_EMAIL, OUTSIDER_EMAIL, ...Object.values(HUNTERS).map((h) => h.email)];
    const { rows: accounts } = await c.query(
      `SELECT u.email, p.id, p.is_internal FROM auth.users u JOIN public.profiles p ON p.id = u.id WHERE u.email = ANY($1)`,
      [emails],
    );
    const idOf = Object.fromEntries(accounts.map((a) => [a.email, a.id]));
    const missing = emails.filter((e) => !idOf[e]);
    if (missing.length) throw new Error(`pool accounts missing on staging: ${missing.join(', ')} (run qa/shoal/bin/seed.mjs accounts)`);
    check('every account used is an internal pool account', accounts.every((a) => a.is_internal === true), accounts);
    const posterId = idOf[POSTER_EMAIL];
    const outsiderId = idOf[OUTSIDER_EMAIL];
    for (const h of Object.values(HUNTERS)) h.id = idOf[h.email];

    for (const h of Object.values(HUNTERS)) {
      await c.query('UPDATE public.profiles SET latitude = $2, longitude = $3 WHERE id = $1', [h.id, h.lat, h.lng]);
    }

    // ── seed bounties (is_test, rolled back) ────────────────────────────────
    async function seedBounty(workType) {
      const { rows } = await c.query(
        `INSERT INTO public.bounties (user_id, poster_id, title, description, amount, work_type, location,
                                      latitude, longitude, is_test, status)
         VALUES ($1, $1, $2, 'SBA-02 staging check, rolled back', 25, $3, $4, $5, $6, true, 'open')
         RETURNING id, geom, approx_latitude, approx_longitude, latitude, longitude`,
        [
          posterId,
          `[sba02-check] ${workType}`,
          workType,
          workType === 'in_person' ? '100 N Holliday St, Baltimore, MD 21202' : null,
          workType === 'in_person' ? JOB.lat : null,
          workType === 'in_person' ? JOB.lng : null,
        ],
      );
      return rows[0];
    }
    const job = await seedBounty('in_person');
    const online = await seedBounty('online');
    console.log('\nSeeded');
    check('in-person bounty has an approximate geom and no exact coordinates on the row',
      job.geom && job.latitude === null && job.longitude === null, job);
    const approx = { lat: job.approx_latitude, lng: job.approx_longitude };

    // ── migration state / backfill ──────────────────────────────────────────
    const { rows: colRows } = await c.query(
      `SELECT count(*)::int n FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'bounty_requests' AND column_name = 'distance_mi'`,
    );
    console.log('\nBackfill');
    if (colRows[0].n === 0) {
      const { rows: pre } = await c.query(
        `INSERT INTO public.bounty_requests (bounty_id, hunter_id, poster_id, status)
         VALUES ($1, $2, $3, 'pending') RETURNING id, updated_at`,
        [job.id, HUNTERS.near.id, posterId],
      );
      const sql = fs.readFileSync(MIGRATION, 'utf8').replace(/^BEGIN;\s*$/m, '').replace(/^COMMIT;\s*$/m, '');
      await c.query(sql);
      const { rows: post } = await c.query(
        'SELECT distance_mi, is_far, distance_computed_at, updated_at FROM public.bounty_requests WHERE id = $1',
        [pre[0].id],
      );
      check('pre-existing application backfilled with a distance', post[0].distance_mi !== null, post[0]);
      check('backfill did not bump updated_at', +post[0].updated_at === +pre[0].updated_at, { before: pre[0].updated_at, after: post[0].updated_at });
      await c.query('DELETE FROM public.bounty_requests WHERE id = $1', [pre[0].id]);
    } else {
      console.log('  skip migration already applied on staging; backfill is checked when run before applying');
    }

    // ── 1/2. stamped at insert, client values ignored, never refused ───────
    console.log('\nApplications (as each hunter, through RLS)');
    const reqIds = {};
    for (const [key, h] of Object.entries(HUNTERS)) {
      await asUser(c, h.id);
      const r = await attempt(
        c,
        `INSERT INTO public.bounty_requests (bounty_id, hunter_id, poster_id, status, distance_mi, is_far)
         VALUES ($1, $2, $3, 'pending', 1, false) RETURNING id`,
        [job.id, h.id, posterId],
      );
      check(`${key}: in-person application accepted`, !r.err, r.err && r.err.message);
      if (r.res) reqIds[key] = r.res.rows[0].id;
      await asOwner(c);
    }
    await asUser(c, HUNTERS.far.id);
    const onlineApp = await attempt(
      c,
      `INSERT INTO public.bounty_requests (bounty_id, hunter_id, poster_id, status, distance_mi, is_far)
       VALUES ($1, $2, $3, 'pending', 7, true) RETURNING id`,
      [online.id, HUNTERS.far.id, posterId],
    );
    await asOwner(c);
    check('far hunter: online application accepted', !onlineApp.err, onlineApp.err && onlineApp.err.message);

    const { rows: stored } = await c.query(
      `SELECT id, hunter_id, distance_mi, is_far, distance_computed_at FROM public.bounty_requests WHERE id = ANY($1)`,
      [[...Object.values(reqIds), onlineApp.res && onlineApp.res.rows[0].id].filter(Boolean)],
    );
    const byId = Object.fromEntries(stored.map((r) => [r.id, r]));
    const near = byId[reqIds.near];
    const far = byId[reqIds.far];
    const close = byId[reqIds.close];
    const none = byId[reqIds.none];
    const onl = onlineApp.res && byId[onlineApp.res.rows[0].id];

    // Expected from the approximate job point; the ~1 km hunter snap and
    // whole-mile rounding allow up to ~1.5 mi of difference.
    const expNear = haversineMi(approx, HUNTERS.near);
    const expFar = haversineMi(approx, HUNTERS.far);
    console.log(`  info expected ~${expNear.toFixed(2)} mi (near), ~${expFar.toFixed(2)} mi (far); stored ${near && near.distance_mi}, ${far && far.distance_mi}`);
    check('near: distance within 1.5 mi of the true approximate distance, not far',
      near && Math.abs(near.distance_mi - expNear) <= 1.5 && near.is_far === false, near);
    check('far: distance within 1.5 mi of the true approximate distance, flagged far',
      far && Math.abs(far.distance_mi - expFar) <= 1.5 && far.distance_mi > 50 && far.is_far === true, far);
    check('close: stored as 0 ("under 1 mile")', close && close.distance_mi === 0 && close.is_far === false, close);
    check('no hunter location: NULL distance, not far', none && none.distance_mi === null && none.is_far === false, none);
    check('online job: NULL distance, not far (client sent 7 / true)', onl && onl.distance_mi === null && onl.is_far === false, onl);
    check('client-sent distance_mi = 1 was discarded', near && near.distance_mi !== 1 && far.distance_mi !== 1);
    check('distance_computed_at stamped on every new application', stored.every((r) => r.distance_computed_at), stored);

    // ── 3. who can read it ──────────────────────────────────────────────────
    console.log('\nVisibility');
    await asUser(c, posterId);
    const { rows: posterView } = await c.query(
      'SELECT id, distance_mi, is_far FROM public.bounty_requests WHERE bounty_id = $1 ORDER BY distance_mi NULLS LAST',
      [job.id],
    );
    await asOwner(c);
    check('poster sees all 4 applicants with distances (existing select path)',
      posterView.length === 4 && posterView.filter((r) => r.distance_mi !== null).length === 3, posterView);

    await asUser(c, HUNTERS.near.id);
    const { rows: nearView } = await c.query('SELECT id, hunter_id, distance_mi FROM public.bounty_requests WHERE bounty_id = $1', [job.id]);
    await asOwner(c);
    check('applicant sees only their own application', nearView.length === 1 && nearView[0].hunter_id === HUNTERS.near.id, nearView);

    await asUser(c, outsiderId);
    const { rows: outsiderView } = await c.query('SELECT id FROM public.bounty_requests WHERE bounty_id = $1', [job.id]);
    await asOwner(c);
    check('unrelated user sees no applications', outsiderView.length === 0, outsiderView);

    await asUser(c, HUNTERS.near.id);
    const { rows: otherProfile } = await c.query('SELECT id, latitude FROM public.profiles WHERE id = $1', [HUNTERS.far.id]);
    await asOwner(c);
    check("profiles RLS unchanged: a hunter can't read another hunter's coordinates", otherProfile.length === 0, otherProfile);

    // ── 4. poster can't rewrite; status change keeps values ─────────────────
    console.log('\nIntegrity');
    await asUser(c, posterId);
    const tamper = await attempt(c, 'UPDATE public.bounty_requests SET distance_mi = 2, is_far = false WHERE id = $1', [reqIds.far]);
    await asOwner(c);
    const { rows: afterTamper } = await c.query('SELECT distance_mi, is_far FROM public.bounty_requests WHERE id = $1', [reqIds.far]);
    check('poster UPDATE of distance_mi / is_far has no effect',
      afterTamper[0].distance_mi === far.distance_mi && afterTamper[0].is_far === true, { tamper: tamper.err && tamper.err.message, afterTamper });

    await asUser(c, posterId);
    await attempt(c, "UPDATE public.bounty_requests SET status = 'rejected' WHERE id = $1", [reqIds.far]);
    await asOwner(c);
    const { rows: afterReject } = await c.query('SELECT status, distance_mi, is_far FROM public.bounty_requests WHERE id = $1', [reqIds.far]);
    check('declining keeps the stored distance', afterReject[0].status === 'rejected' && afterReject[0].distance_mi === far.distance_mi && afterReject[0].is_far === true, afterReject);

    // ── 5. the oracle is not client-callable ────────────────────────────────
    for (const role of ['authenticated', 'anon']) {
      if (role === 'authenticated') await asUser(c, HUNTERS.near.id);
      else await c.query('SET LOCAL ROLE anon');
      const call = await attempt(c, 'SELECT * FROM public.fn_bounty_request_distance($1, $2)', [job.id, HUNTERS.far.id]);
      await asOwner(c);
      check(`${role} cannot call fn_bounty_request_distance`, call.err && /permission denied/i.test(call.err.message), call.err ? call.err.message : call.res.rows);
    }

    // ── 6. realtime broadcast carries no distance ───────────────────────────
    console.log('\nRealtime');
    const { rows: msgs } = await c.query(
      `SELECT event, payload FROM realtime.messages WHERE topic = $1 ORDER BY inserted_at`,
      [`bounty:${job.id}`],
    );
    const leaked = msgs.filter((m) => {
      const rec = (m.payload && m.payload.record) || {};
      const old = (m.payload && m.payload.old_record) || {};
      return [rec, old].some((r) => r.distance_mi != null || r.is_far != null || r.distance_computed_at != null);
    });
    check('broadcasts were emitted for these applications', msgs.filter((m) => m.event === 'applied').length >= 4, msgs.map((m) => m.event));
    check('no broadcast payload carries distance_mi / is_far / distance_computed_at', leaked.length === 0, leaked.map((m) => m.payload));
    check('status-change broadcast still emitted', msgs.some((m) => m.event === 'application_status_changed'), msgs.map((m) => m.event));

    // ── 7. the weekly query runs (pool accounts are internal, so the genuine
    //       filter would exclude them; this runs the same shape without it) ──
    console.log('\nWeekly query shape');
    const { rows: weekly } = await c.query(
      `SELECT date_trunc('week', r.created_at)::date AS week,
              count(*) AS apps,
              count(*) FILTER (WHERE r.distance_mi IS NOT NULL) AS measurable,
              count(*) FILTER (WHERE r.distance_mi <= 25) AS within_25mi,
              count(*) FILTER (WHERE r.is_far) AS far
       FROM public.bounty_requests r
       JOIN public.bounties b ON b.id = r.bounty_id
       WHERE b.work_type = 'in_person' AND b.id = $1
       GROUP BY 1`,
      [job.id],
    );
    check('4 apps, 3 measurable, 2 within 25 mi, 1 far',
      weekly.length === 1 && +weekly[0].apps === 4 && +weekly[0].measurable === 3 && +weekly[0].within_25mi === 2 && +weekly[0].far === 1, weekly);
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
