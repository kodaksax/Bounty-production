/* scripts/verify-location-privacy.js
 *
 * DB-level security test for supabase/migrations/20261001160000_bounty_location_privacy.sql.
 *
 * Runs in ONE transaction on staging and ALWAYS rolls back: seeds a legacy
 * bounty with an exact address (pre-migration), applies the migration (which
 * backfills it), then exercises the real triggers, RPCs, grants and RLS as the
 * PostgREST roles (anon / authenticated with JWT claims). Finally it replays
 * the rollback script inside a savepoint. Nothing persists.
 *
 * What it proves:
 *   1. Data at rest: no exact address / coordinates / unit left on bounties.
 *   2. Every write path (old-client payloads, service role) is privatized,
 *      re-saves don't re-roll the jitter, approx_* isn't client-writable.
 *   3. Access matrix for get_bounty_exact_location (anon, ordinary user,
 *      unrelated user, applicant, poster, accepted hunter, finished hunter,
 *      admin, service_role) + every call logged.
 *   4. Direct table/column access per role, serialized rows scanned.
 *   5. search_bounties_nearby only reveals the approximate point.
 *   6. A unique address token appears in no table except the private ones
 *      (notifications, events, realtime.messages, ...).
 *   7. Rollback restores data and the live definitions captured at apply time.
 *
 * Usage:
 *   node scripts/verify-location-privacy.js               # staging
 *   node scripts/verify-location-privacy.js --with-revoke # + staged column revoke
 *
 * Refuses production. Exits non-zero if any check fails.
 */
const fs = require('fs');
const path = require('path');
const { connect } = require('./lib/ro-query');
const { inlineLabelSql } = require('./location-privacy-dry-run');

const ROOT = path.resolve(__dirname, '..');
const MIGRATION = path.join(ROOT, 'supabase/migrations/20261001160000_bounty_location_privacy.sql');
const ROLLBACK = path.join(ROOT, 'supabase/rollbacks/production/20261001160000_bounty_location_privacy.down.sql');
const STAGED_REVOKE = path.join(ROOT, 'supabase/staged/20261001160100_bounty_location_column_revoke.sql');
const CASES = require('../__tests__/fixtures/public-location-label-cases.json');

const ENV = (process.argv.find((a) => a.startsWith('--env=')) || '--env=staging').slice(6);
const WITH_REVOKE = process.argv.includes('--with-revoke');
if (ENV !== 'staging' && ENV !== 'local') {
  console.error('verify-location-privacy only runs against staging or a local mock (it applies DDL inside a transaction).');
  process.exit(2);
}

// Unique tokens so a whole-database scan can find every copy.
const LEGACY = {
  address: '4411 Qwvlegacy Road, Owings Mills, MD 21117, USA',
  token: 'Qwvlegacy',
  lat: 39.4143217,
  lng: -76.7802155,
  unit: 'Suite 4Qw',
  label: 'Owings Mills, MD',
};
const FRESH = {
  address: '77 Zyxquor Lane, Pikesville, MD 21208, USA',
  token: 'Zyxquor',
  lat: 39.3790123,
  lng: -76.7231456,
  unit: 'Apt 9Zq',
  unitToken: '9Zq',
  label: 'Pikesville, MD',
};
const MOVED = { address: '9 Vrrmoved Court, Towson, MD 21204', token: 'Vrrmoved', lat: 39.4015, lng: -76.6019, label: 'Towson, MD' };

const results = [];
function check(name, ok, info) {
  results.push({ name, ok: !!ok, info });
  const suffix = info !== undefined ? '  -- ' + (typeof info === 'string' ? info : JSON.stringify(info)) : '';
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${suffix}`);
}

function feedSafeColumns() {
  const src = fs.readFileSync(path.join(ROOT, 'lib/services/bounty-service.ts'), 'utf8');
  const m = src.match(/FEED_SAFE_BOUNTY_COLUMNS = \[([\s\S]*?)\]\.join/);
  if (!m) throw new Error('FEED_SAFE_BOUNTY_COLUMNS not found');
  return [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
}

async function main() {
  const c = await connect(ENV);
  const notices = [];
  c.on('notice', (n) => notices.push(n.message));
  const q = async (sql, params) => (await c.query(sql, params)).rows;
  const one = async (sql, params) => (await q(sql, params))[0];
  let spSeq = 0;
  // Run fn in a savepoint; keep its effects on success, undo them on error.
  const attempt = async (fn) => {
    const sp = `sp_${++spSeq}`;
    await c.query(`SAVEPOINT ${sp}`);
    try {
      const value = await fn();
      await c.query(`RELEASE SAVEPOINT ${sp}`);
      return { ok: true, value };
    } catch (error) {
      await c.query(`ROLLBACK TO SAVEPOINT ${sp}`);
      return { ok: false, error };
    }
  };
  const asRole = async (role, claims, fn) => {
    await c.query(`SET LOCAL ROLE ${role}`);
    await c.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims || {})]);
    try {
      return await fn();
    } finally {
      await c.query('RESET ROLE').catch(() => {});
      await c.query(`SELECT set_config('request.jwt.claims', '', true)`).catch(() => {});
    }
  };
  const user = (id, extra = {}) => ({ sub: id, role: 'authenticated', ...extra });
  const asUser = (id, fn, extra) => asRole('authenticated', user(id, extra), fn);
  const asAnon = (fn) => asRole('anon', { role: 'anon' }, fn);
  const exactFor = (claims, role, bountyId) =>
    attempt(() => asRole(role, claims, () => q(`SELECT * FROM public.get_bounty_exact_location($1)`, [bountyId])));

  try {
    await c.query('BEGIN');
    await c.query("SET LOCAL statement_timeout = '600s'");

    const hasCol = async (col) =>
      !!(await one(`SELECT 1 AS x FROM information_schema.columns WHERE table_schema='public' AND table_name='bounties' AND column_name=$1`, [col]));
    const hasFundingMode = await hasCol('funding_mode');
    if ((await one(`SELECT count(*)::int n FROM pg_trigger WHERE tgrelid='public.bounties'::regclass AND tgname='trg_bounties_reserve_escrow'`)).n) {
      // Staging's normaliser reserves escrow from a zero balance on insert.
      await c.query(`ALTER TABLE public.bounties DISABLE TRIGGER trg_bounties_reserve_escrow`);
    }

    // --- fixtures ----------------------------------------------------------
    const mkUser = async (label) => {
      const stamp = `${Date.now()}${Math.floor(Math.random() * 1e4)}`;
      const r = await one(
        `WITH u AS (
           INSERT INTO auth.users (id, aud, role, email, created_at, updated_at)
           VALUES (gen_random_uuid(), 'authenticated', 'authenticated', $1, now(), now()) RETURNING id)
         INSERT INTO public.profiles (id, username, created_at)
         SELECT id, $2, now() - interval '30 days' FROM u RETURNING id`,
        [`locpriv+${label}+${stamp}@example.test`, `locpriv_${label}_${stamp.slice(-7)}`]
      );
      return r.id;
    };
    const poster = await mkUser('poster');
    const hunter = await mkUser('hunter');
    const ordinary = await mkUser('ordinary');
    const unrelated = await mkUser('unrelated');
    const applicant = await mkUser('applicant');
    const admin = await mkUser('admin');

    const insertCols = ['title', 'description', 'amount', 'is_for_honor', 'poster_id', 'user_id', 'status', 'work_type',
      'location', 'latitude', 'longitude', 'unit', 'neighborhood'];
    const insertBounty = (b) => {
      const cols = [...insertCols, ...(hasFundingMode ? ['funding_mode'] : [])];
      const vals = [b.title || 'Help carrying boxes', 'Two boxes from the car to the second floor, ten minutes.', 40, false,
        b.poster, b.poster, b.status || 'open', 'in_person', b.location ?? null, b.lat ?? null, b.lng ?? null,
        b.unit ?? null, b.neighborhood ?? null, ...(hasFundingMode ? ['at_accept'] : [])];
      return one(
        `INSERT INTO public.bounties (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`,
        vals
      );
    };

    // Legacy bounty, written BEFORE the migration (old trigger computes jitter).
    const legacyBefore = await insertBounty({
      poster, location: LEGACY.address, lat: LEGACY.lat, lng: LEGACY.lng, unit: LEGACY.unit, neighborhood: 'Owings Mills',
    });
    const legacyId = legacyBefore.id;
    await c.query('SET CONSTRAINTS ALL IMMEDIATE');

    // Pre-migration definitions for the rollback round-trip.
    const defMd5 = () => one(`SELECT
        (SELECT md5(pg_get_functiondef(to_regprocedure('public.get_bounty_exact_location(uuid)')))) AS rpc,
        (SELECT md5(pg_get_functiondef(to_regprocedure('public.fn_compute_bounty_quality_score(uuid)')))) AS quality,
        (SELECT md5(pg_get_triggerdef(t.oid)) FROM pg_trigger t
          WHERE t.tgrelid='public.bounties'::regclass AND t.tgname='trg_bounties_compute_approx_location') AS approx_trigger`);
    const before = await defMd5();

    // Dry-run SQL (inlined, no functions needed) must agree with the fixture.
    const { labelFor, neighborhoodFor } = inlineLabelSql();
    for (const k of ['label', 'neighborhood']) {
      const rows = CASES[k];
      const expr = k === 'label' ? labelFor('v.raw') : neighborhoodFor('v.raw');
      const got = await q(
        `SELECT v.i, ${expr} AS out FROM unnest($1::text[]) WITH ORDINALITY AS v(raw, i) ORDER BY v.i`,
        [rows.map((r) => r.in)]
      );
      const bad = rows.filter((r, i) => (got[i].out ?? null) !== r.out).map((r, i) => ({ in: r.in, want: r.out }));
      check(`dry-run inline ${k} SQL matches shared fixture (${rows.length} cases)`, bad.length === 0, bad.length ? bad : undefined);
    }

    // --- apply ---------------------------------------------------------------
    await c.query(fs.readFileSync(MIGRATION, 'utf8'));
    check('migration applies cleanly (post-conditions inside it passed)', true);
    const backfillNotice = notices.find((n) => n.includes('backfill (applied)'));
    check('backfill reported its counts', !!backfillNotice, backfillNotice && backfillNotice.slice(0, 300));

    for (const k of ['label', 'neighborhood']) {
      const fn = k === 'label' ? 'fn_public_location_label' : 'fn_public_neighborhood';
      const rows = CASES[k];
      const got = await q(`SELECT v.i, public.${fn}(v.raw) AS out FROM unnest($1::text[]) WITH ORDINALITY AS v(raw, i) ORDER BY v.i`,
        [rows.map((r) => r.in)]);
      const bad = rows.filter((r, i) => (got[i].out ?? null) !== r.out).map((r) => ({ in: r.in, want: r.out }));
      check(`${fn} matches shared fixture`, bad.length === 0, bad.length ? bad : undefined);
    }

    const order = await q(`SELECT tgname FROM pg_trigger WHERE tgrelid='public.bounties'::regclass AND NOT tgisinternal
                           AND (tgtype & 2) = 2 AND (tgtype & 1) = 1 ORDER BY tgname`);
    check('zz_bounties_privatize_location is the last BEFORE ROW trigger', order[order.length - 1]?.tgname === 'zz_bounties_privatize_location',
      order.map((r) => r.tgname));

    // --- 1. backfill -----------------------------------------------------------
    const legacy = await one(`SELECT b.*, ST_Distance(b.geom, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography) AS geom_off_m
                              FROM public.bounties b WHERE id = $1`, [legacyId, LEGACY.lng, LEGACY.lat]);
    check('legacy: public location is the city label', legacy.location === LEGACY.label, legacy.location);
    check('legacy: latitude/longitude/unit are NULL', legacy.latitude === null && legacy.longitude === null && legacy.unit === null);
    check('legacy: geom is the approximate point (120-350 m off)', legacy.geom_off_m >= 100 && legacy.geom_off_m <= 360, Math.round(legacy.geom_off_m));
    if (legacyBefore.approx_latitude != null) {
      check('legacy: existing jitter kept (approx unchanged)',
        legacy.approx_latitude === legacyBefore.approx_latitude && legacy.approx_longitude === legacyBefore.approx_longitude);
    } else {
      check('legacy: jitter computed by backfill (no pre-migration approx on this env)', legacy.approx_latitude != null);
    }
    const legacyPriv = await one(`SELECT * FROM public.bounty_private_locations WHERE bounty_id = $1`, [legacyId]);
    check('legacy: private row holds exact address/coords/unit',
      legacyPriv && legacyPriv.address === LEGACY.address && legacyPriv.latitude === LEGACY.lat
        && legacyPriv.longitude === LEGACY.lng && legacyPriv.unit === LEGACY.unit && legacyPriv.source === 'backfill');
    const snap = await one(`SELECT * FROM public.bounty_location_backfill_snapshot WHERE bounty_id = $1`, [legacyId]);
    check('legacy: snapshot holds the pre-image', snap && snap.location === LEGACY.address && snap.latitude === LEGACY.lat);
    const global = await one(`SELECT
        count(*) FILTER (WHERE latitude IS NOT NULL OR longitude IS NOT NULL OR unit IS NOT NULL)::int AS exact_left,
        count(*) FILTER (WHERE location ~ '[0-9#]')::int AS digits_left
      FROM public.bounties`);
    check('all bounties: no exact columns, no digits in location', global.exact_left === 0 && global.digits_left === 0, global);

    // --- 2. write paths (as the poster, through RLS like PostgREST) -----------
    const created = await attempt(() => asUser(poster, () => one(
      `INSERT INTO public.bounties (title, description, amount, is_for_honor, poster_id, user_id, status, work_type,
                                    location, latitude, longitude, unit, neighborhood${hasFundingMode ? ', funding_mode' : ''})
       VALUES ('Carry boxes upstairs', 'Two boxes from the car to the second floor, ten minutes.', 40, false, $1, $1, 'open',
               'in_person', $2, $3, $4, $5, 'Pikesville'${hasFundingMode ? ", 'at_accept'" : ''})
       RETURNING *`, [poster, FRESH.address, FRESH.lat, FRESH.lng, FRESH.unit])));
    check('poster INSERT with old-client payload succeeds', created.ok, created.error && created.error.message);
    if (!created.ok) throw new Error('cannot continue without a poster-created bounty');
    const fresh = created.value;
    const freshId = fresh.id;
    check('INSERT ... RETURNING * gives the label, not the address', fresh.location === FRESH.label, fresh.location);
    check('INSERT ... RETURNING * has no exact coords/unit', fresh.latitude === null && fresh.longitude === null && fresh.unit === null);
    check('INSERT ... RETURNING * contains no address token', !JSON.stringify(fresh).includes(FRESH.token)
      && !JSON.stringify(fresh).includes(FRESH.unitToken));
    const priv = async (id) => one(`SELECT * FROM public.bounty_private_locations WHERE bounty_id = $1`, [id]);
    let p = await priv(freshId);
    check('private row written by trigger', p && p.address === FRESH.address && p.latitude === FRESH.lat && p.unit === FRESH.unit && p.source === 'write');
    const approx0 = await one(`SELECT approx_latitude, approx_longitude,
        ST_Distance(geom, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography) AS off_m FROM public.bounties WHERE id = $1`,
      [freshId, FRESH.lng, FRESH.lat]);
    check('new bounty geom is 120-350 m from the exact point', approx0.off_m >= 100 && approx0.off_m <= 360, Math.round(approx0.off_m));

    // Old client edits the title and round-trips everything it read.
    let r = await attempt(() => asUser(poster, () => one(
      `UPDATE public.bounties SET title = 'Carry two boxes upstairs', location = $2, latitude = NULL, longitude = NULL,
         unit = NULL, neighborhood = $3 WHERE id = $1 RETURNING location`, [freshId, fresh.location, fresh.neighborhood])));
    p = await priv(freshId);
    const approx1 = await one(`SELECT approx_latitude, approx_longitude FROM public.bounties WHERE id = $1`, [freshId]);
    check('round-trip update keeps private address and jitter', r.ok && p.address === FRESH.address && p.latitude === FRESH.lat
      && approx1.approx_latitude === approx0.approx_latitude, r.error && r.error.message);

    // Confirmation screen re-saves the same exact point (bountyService.updateDetails).
    r = await attempt(() => asUser(poster, () => q(
      `UPDATE public.bounties SET location = $2, latitude = $3, longitude = $4, unit = $5 WHERE id = $1`,
      [freshId, FRESH.address, FRESH.lat, FRESH.lng, FRESH.unit])));
    const approx2 = await one(`SELECT approx_latitude, approx_longitude, location, latitude FROM public.bounties WHERE id = $1`, [freshId]);
    check('re-saving the same exact point does NOT re-roll the jitter (no averaging attack)',
      r.ok && approx2.approx_latitude === approx0.approx_latitude && approx2.approx_longitude === approx0.approx_longitude
        && approx2.latitude === null && approx2.location === FRESH.label, r.error && r.error.message);

    // A client cannot set the public approximate point itself.
    r = await attempt(() => asUser(poster, () => q(
      `UPDATE public.bounties SET approx_latitude = $2, approx_longitude = $3 WHERE id = $1`, [freshId, FRESH.lat, FRESH.lng])));
    const approx3 = await one(`SELECT approx_latitude FROM public.bounties WHERE id = $1`, [freshId]);
    check('approx_latitude/approx_longitude are not client-writable', approx3.approx_latitude === approx0.approx_latitude,
      r.ok ? 'update accepted, value ignored' : r.error.message);

    // Address stuffed into neighborhood.
    r = await attempt(() => asUser(poster, () => one(
      `UPDATE public.bounties SET neighborhood = '55 Elm Street' WHERE id = $1 RETURNING neighborhood`, [freshId])));
    check('address in neighborhood is discarded', r.ok && r.value.neighborhood === null, r.ok ? r.value : r.error.message);

    // Service-role writers are privatized too (edge functions, RPCs, admin tools).
    const svc = await attempt(() => asRole('service_role', { role: 'service_role' }, () => one(
      `UPDATE public.bounties SET location = $2, latitude = $3, longitude = $4 WHERE id = $1 RETURNING location, latitude`,
      [legacyId, LEGACY.address, LEGACY.lat, LEGACY.lng])));
    check('service_role write is privatized', svc.ok && svc.value.location === LEGACY.label && svc.value.latitude === null,
      svc.ok ? svc.value : svc.error.message);

    // A scratch bounty to exercise "moved address" and "switched to online".
    const scratch = await insertBounty({ poster, location: MOVED.address, lat: MOVED.lat, lng: MOVED.lng });
    await c.query(`UPDATE public.bounties SET location = $2, latitude = $3, longitude = $4 WHERE id = $1`,
      [scratch.id, FRESH.address, FRESH.lat, FRESH.lng]);
    let sp = await priv(scratch.id);
    check('changed address replaces the private row', sp.address === FRESH.address && sp.latitude === FRESH.lat);
    await c.query(`UPDATE public.bounties SET location = '', latitude = NULL, longitude = NULL, unit = NULL WHERE id = $1`, [scratch.id]);
    sp = await priv(scratch.id);
    const sb = await one(`SELECT approx_latitude, geom FROM public.bounties WHERE id = $1`, [scratch.id]);
    check('switching to online clears every exact field and the approx point',
      sp.address === null && sp.latitude === null && sp.unit === null && sb.approx_latitude === null && sb.geom === null);
    const online = await insertBounty({ poster, location: '' });
    check('online bounty creates no private row', !(await priv(online.id)));

    // --- 3. access matrix --------------------------------------------------------
    // freshId: in_progress with `hunter` accepted. legacyId: a different bounty
    // where `unrelated` is the accepted hunter.
    await c.query(`UPDATE public.bounties SET status = 'in_progress', accepted_by = $2 WHERE id = $1`, [freshId, hunter]);
    await c.query(`UPDATE public.bounties SET status = 'in_progress', accepted_by = $2 WHERE id = $1`, [legacyId, unrelated]);
    const applied = await attempt(() => q(
      `INSERT INTO public.bounty_requests (bounty_id, hunter_id, poster_id, status) VALUES ($1, $2, $3, 'pending')`,
      [freshId, applicant, poster]));
    const logBefore = (await one(`SELECT count(*)::int n FROM public.bounty_location_access_log`)).n;

    const matrix = [
      ['anon', 'anon', { role: 'anon' }, 'denied'],
      ['ordinary signed-in user', 'authenticated', user(ordinary), 'none'],
      ['unrelated user (accepted hunter on another bounty)', 'authenticated', user(unrelated), 'none'],
      ...(applied.ok ? [['applicant (not accepted)', 'authenticated', user(applicant), 'none']] : []),
      ['admin (app_metadata.role=admin)', 'authenticated', user(admin, { app_metadata: { role: 'admin' } }), 'none'],
      ['poster', 'authenticated', user(poster), 'exact'],
      ['accepted hunter (in_progress)', 'authenticated', user(hunter), 'exact'],
      ['service_role (no auth.uid())', 'service_role', { role: 'service_role' }, 'none'],
    ];
    const matrixOut = [];
    for (const [label, role, claims, expect] of matrix) {
      const res = await exactFor(claims, role, freshId);
      const got = !res.ok ? 'denied' : res.value.length === 0 ? 'none' : res.value[0].location === FRESH.address ? 'exact' : 'other';
      matrixOut.push({ caller: label, expected: expect, got });
      check(`get_bounty_exact_location as ${label} -> ${expect}`, got === expect,
        !res.ok ? res.error.message : res.value[0] ? { location: res.value[0].location === FRESH.address ? '<exact>' : res.value[0].location } : '0 rows');
    }
    if (!applied.ok) check('applicant fixture (bounty_requests insert)', true, `skipped: ${applied.error.message}`);

    const legacyAsUnrelated = await exactFor(user(unrelated), 'authenticated', legacyId);
    check('accepted hunter of the OTHER bounty gets that one (legacy address-only path works)',
      legacyAsUnrelated.ok && legacyAsUnrelated.value[0]?.location === LEGACY.address);

    for (const [status, expect] of [['completed', 'none'], ['cancelled', 'none'], ['disputed', 'exact'], ['cancellation_requested', 'exact']]) {
      const set = await attempt(() => q(`UPDATE public.bounties SET status = $2 WHERE id = $1`, [freshId, status]));
      if (!set.ok) { check(`hunter access when status=${status}`, true, `skipped: ${set.error.message}`); continue; }
      const res = await exactFor(user(hunter), 'authenticated', freshId);
      const got = res.ok ? (res.value.length ? 'exact' : 'none') : 'denied';
      matrixOut.push({ caller: `accepted hunter (${status})`, expected: expect, got });
      check(`accepted hunter when status=${status} -> ${expect}`, got === expect);
      const posterRes = await exactFor(user(poster), 'authenticated', freshId);
      check(`poster when status=${status} -> exact`, posterRes.ok && posterRes.value.length === 1);
    }
    await c.query(`UPDATE public.bounties SET status = 'in_progress' WHERE id = $1`, [freshId]);

    const log = await q(`SELECT caller_id, granted, reason FROM public.bounty_location_access_log ORDER BY id OFFSET $1`, [logBefore]);
    const leakedGrants = log.filter((l) => l.granted && ![poster, hunter, unrelated].includes(l.caller_id));
    check('every authenticated call is logged; no grant to a non-participant', log.length > 0 && leakedGrants.length === 0,
      { logged: log.length, nonParticipantGrants: leakedGrants.length });

    // --- 4. direct table / column access ----------------------------------------
    for (const [label, role, claims] of [['anon', 'anon', { role: 'anon' }], ['ordinary', 'authenticated', user(ordinary)],
      ['poster', 'authenticated', user(poster)], ['hunter', 'authenticated', user(hunter)]]) {
      for (const t of ['bounty_private_locations', 'bounty_location_backfill_snapshot', 'location_privacy_rollback_defs']) {
        const res = await attempt(() => asRole(role, claims, () => q(`SELECT * FROM public.${t} LIMIT 1`)));
        check(`${label}: SELECT ${t} is denied`, !res.ok && /permission denied/.test(res.error.message),
          res.ok ? `${res.value.length} rows` : res.error.message);
      }
      const logRes = await attempt(() => asRole(role, claims, () => q(`SELECT * FROM public.bounty_location_access_log`)));
      check(`${label}: access log not readable`, !logRes.ok || logRes.value.length === 0,
        logRes.ok ? `${logRes.value.length} rows` : logRes.error.message);
    }
    const adminLog = await attempt(() => asUser(admin, () => q(`SELECT count(*)::int n FROM public.bounty_location_access_log`), { app_metadata: { role: 'admin' } }));
    check('admin can read the access log', adminLog.ok && adminLog.value[0].n > 0, adminLog.ok ? adminLog.value[0] : adminLog.error.message);

    const feedCols = feedSafeColumns();
    const leakScan = (rows) => {
      const s = JSON.stringify(rows);
      return [FRESH.token, LEGACY.token, FRESH.unitToken, '4Qw', String(FRESH.lat), String(FRESH.lng), String(LEGACY.lat)]
        .filter((t) => s.includes(t));
    };
    for (const [label, role, claims] of [['anon', 'anon', { role: 'anon' }], ['ordinary', 'authenticated', user(ordinary)],
      ['unrelated', 'authenticated', user(unrelated)], ['applicant', 'authenticated', user(applicant)],
      ['hunter', 'authenticated', user(hunter)], ['admin', 'authenticated', user(admin, { app_metadata: { role: 'admin' } })]]) {
      for (const [shape, sql] of [
        ['select *', `SELECT * FROM public.bounties WHERE id = ANY($1)`],
        ['feed columns', `SELECT ${feedCols.join(', ')} FROM public.bounties WHERE id = ANY($1)`],
        ['exact columns', `SELECT location, latitude, longitude, unit, geom, neighborhood FROM public.bounties WHERE id = ANY($1)`],
        ['row_to_json', `SELECT row_to_json(b) j FROM public.bounties b WHERE id = ANY($1)`],
      ]) {
        const res = await attempt(() => asRole(role, claims, () => q(sql, [[freshId, legacyId]])));
        if (!res.ok) {
          check(`${label}: ${shape} on bounties`, WITH_REVOKE || role === 'anon', `error: ${res.error.message}`);
          continue;
        }
        const hits = leakScan(res.value);
        check(`${label}: ${shape} returns no address/coords/unit (${res.value.length} rows visible)`, hits.length === 0, hits.length ? hits : undefined);
      }
    }

    // --- 5. search_bounties_nearby is not an oracle ------------------------------
    await c.query(`UPDATE public.bounties SET status = 'open', accepted_by = NULL WHERE id = $1`, [freshId]);
    const probes = [[0.01, 0], [-0.01, 0.005], [0, -0.012]].map(([dl, dg]) => [FRESH.lat + dl, FRESH.lng + dg]);
    const oracle = [];
    for (const [lat, lng] of probes) {
      const res = await attempt(() => asUser(ordinary, () => q(
        `SELECT id, distance_miles, approx_latitude, approx_longitude FROM public.search_bounties_nearby(p_lat => $1, p_lng => $2, p_radius_miles => 25, p_limit => 100)`,
        [lat, lng])));
      if (!res.ok) { oracle.push({ error: res.error.message }); continue; }
      const row = res.value.find((x) => x.id === freshId);
      const ref = await one(`SELECT
          ST_Distance(ST_SetSRID(ST_MakePoint(b.approx_longitude, b.approx_latitude), 4326)::geography,
                      ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography) / 1609.344 AS to_approx,
          ST_Distance(ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography,
                      ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography) / 1609.344 AS to_exact
        FROM public.bounties b WHERE b.id = $1`, [freshId, lng, lat, FRESH.lng, FRESH.lat]);
      oracle.push({ found: !!row, returned: row?.distance_miles, to_approx: ref.to_approx, to_exact: ref.to_exact });
    }
    check('search_bounties_nearby distances are distances to the APPROX point (trilateration recovers only the public point)',
      oracle.every((o) => o.found && Math.abs(o.returned - o.to_approx) < 1e-6),
      oracle.map((o) => (o.error ? o.error : { returned: o.returned?.toFixed(4), approx: o.to_approx?.toFixed(4), exact: o.to_exact?.toFixed(4) })));

    // --- 6. whole-database scan for copies of the new address --------------------
    const tables = await q(`SELECT n.nspname AS s, c.relname AS t FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                            WHERE c.relkind IN ('r', 'p') AND n.nspname IN ('public', 'realtime') AND NOT c.relispartition
                            ORDER BY 1, 2`);
    const found = { [FRESH.token]: [], [LEGACY.token]: [] };
    for (const { s, t } of tables) {
      for (const token of Object.keys(found)) {
        const res = await attempt(() => one(`SELECT count(*)::int n FROM ${s}.${JSON.stringify(t)} x WHERE x::text LIKE $1`, [`%${token}%`]));
        if (res.ok && res.value.n > 0) found[token].push(`${s}.${t}(${res.value.n})`);
      }
    }
    const allowed = ['public.bounty_private_locations', 'public.bounty_location_backfill_snapshot'];
    const strays = found[FRESH.token].filter((x) => !allowed.some((a) => x.startsWith(a + '(')));
    check('post-migration address exists only in private tables (notifications, events, realtime.messages, ... scanned)',
      strays.length === 0, { tables_scanned: tables.length, found: found[FRESH.token] });
    // Informational: where the PRE-migration write leaked the legacy address
    // (these are historical copies the migration does not rewrite).
    console.log(`INFO  legacy (pre-fix) address copies: ${JSON.stringify(found[LEGACY.token])}`);

    // --- 7. quality score ----------------------------------------------------------
    const qdef = await one(`SELECT pg_get_functiondef(to_regprocedure('public.fn_compute_bounty_quality_score(uuid)')) d`);
    if (qdef.d) {
      check('quality score reads the approximate point', qdef.d.includes('approx_latitude AS latitude'));
      const withLoc = (await one(`SELECT public.fn_compute_bounty_quality_score($1) s`, [freshId])).s;
      const noLoc = (await one(`SELECT public.fn_compute_bounty_quality_score($1) s`, [online.id])).s;
      check('quality score still credits a located in-person bounty', Number(withLoc) > Number(noLoc), { withLoc, noLoc });
    }

    // --- 8. grants ----------------------------------------------------------------
    const grants = await one(`SELECT
        has_function_privilege('anon', 'public.get_bounty_exact_location(uuid)', 'EXECUTE') AS anon_rpc,
        has_function_privilege('authenticated', 'public.fn_backfill_bounty_location_privacy(boolean)', 'EXECUTE') AS auth_backfill,
        has_function_privilege('anon', 'public.fn_backfill_bounty_location_privacy(boolean)', 'EXECUTE') AS anon_backfill,
        has_table_privilege('authenticated', 'public.bounty_private_locations', 'SELECT,INSERT,UPDATE,DELETE') AS auth_private`);
    check('no anon/authenticated path to private storage or backfill', !Object.values(grants).some(Boolean), grants);

    // Live functions git may not know about that read bounty coordinates. After
    // the migration those columns are NULL, so each one needs a look.
    const readers = await q(`SELECT p.proname FROM pg_proc p
      WHERE p.pronamespace = 'public'::regnamespace
        AND p.prosrc ~* '\\y(latitude|longitude)\\y' AND p.prosrc ~* '\\ybounties\\y'
        AND p.proname NOT IN ('fn_bounties_privatize_location', 'fn_backfill_bounty_location_privacy',
                              'get_bounty_exact_location', 'bounties_compute_approx_location')
      ORDER BY 1`);
    console.log(`INFO  functions mentioning bounties + latitude/longitude (review each): ${JSON.stringify(readers.map((r) => r.proname))}`);

    // --- 9. staged column revoke (optional) -----------------------------------------
    if (WITH_REVOKE) {
      await c.query(fs.readFileSync(STAGED_REVOKE, 'utf8'));
      const feedOk = await attempt(() => asUser(ordinary, () => q(`SELECT ${feedCols.join(', ')} FROM public.bounties LIMIT 1`)));
      check('[revoke] feed column list still works', feedOk.ok, feedOk.ok ? undefined : feedOk.error.message);
      const latDenied = await attempt(() => asUser(ordinary, () => q(`SELECT latitude FROM public.bounties LIMIT 1`)));
      check('[revoke] latitude is no longer selectable', !latDenied.ok);
      const starDenied = await attempt(() => asUser(ordinary, () => q(`SELECT * FROM public.bounties LIMIT 1`)));
      check('[revoke] select * fails (why old builds must be gone first)', !starDenied.ok);
    }

    // --- 10. rollback round-trip ------------------------------------------------------
    await c.query('SAVEPOINT rollback_trip');
    const downSql = fs.readFileSync(ROLLBACK, 'utf8').replace(/^\s*BEGIN;\s*$/m, '').replace(/^\s*COMMIT;\s*$/m, '');
    const down = await attempt(() => c.query(downSql));
    check('rollback script runs', down.ok, down.ok ? undefined : down.error.message);
    if (down.ok) {
      const restored = await one(`SELECT location, latitude, longitude FROM public.bounties WHERE id = $1`, [legacyId]);
      check('rollback restores exact data onto bounties', restored.location === LEGACY.address && restored.latitude === LEGACY.lat, restored.location);
      const after = await defMd5();
      check('rollback restores the captured live definitions (md5)',
        after.rpc === before.rpc && after.quality === before.quality && after.approx_trigger === before.approx_trigger, { before, after });
      const kept = await one(`SELECT to_regclass('public.bounty_private_locations') IS NOT NULL AS kept`);
      check('rollback keeps private data (non-destructive)', kept.kept);
    }
    await c.query('ROLLBACK TO SAVEPOINT rollback_trip');

    console.log('\nAccess matrix (get_bounty_exact_location):');
    console.table(matrixOut);
  } finally {
    await c.query('ROLLBACK').catch(() => {});
    await c.end();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed. Transaction rolled back.`);
  if (failed.length) {
    console.log('FAILED:');
    for (const f of failed) console.log(`  - ${f.name}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
