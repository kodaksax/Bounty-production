/* scripts/verify-liquidity-board.js
 *
 * DB-level test suite for admin_liquidity_board() (BNTY-10).
 *
 * Applies supabase/migrations/20260919120000_admin_liquidity_board.sql inside
 * a single transaction (after the Command Center migration it depends on, if
 * this environment doesn't already have it), exercises one fixture per bucket
 * against the real schema, checks the anon/authenticated grant and the admin
 * guard, and ALWAYS rolls back. Nothing it does persists. Mirrors
 * scripts/verify-command-center-migration.js.
 *
 * Usage:
 *   node scripts/verify-liquidity-board.js
 *   PG_POOLER_HOST=aws-1-us-east-2.pooler.supabase.com node scripts/...
 *
 * Reads DATABASE_URL from .env.production. Exits non-zero if any check fails.
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const ROOT = path.resolve(__dirname, '..');
const COMMAND_CENTER_MIGRATION = path.join(
  ROOT,
  'supabase/migrations/20260828130000_bounty_events_command_center.sql'
);
const LIQUIDITY_BOARD_MIGRATION = path.join(
  ROOT,
  'supabase/migrations/20260919120000_admin_liquidity_board.sql'
);

function dbUrl() {
  const env = fs.readFileSync(path.join(ROOT, '.env.production'), 'utf8');
  const m = env.match(/^\s*DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m);
  if (!m) throw new Error('DATABASE_URL not found in .env.production');
  const raw = m[1].trim();
  const u = new URL(raw);
  const ref = u.hostname.replace(/^db\./, '').replace(/\.supabase\.co$/, '');
  const hosts = process.env.PG_POOLER_HOST
    ? [process.env.PG_POOLER_HOST]
    : ['aws-1-us-east-2.pooler.supabase.com', 'aws-0-us-east-2.pooler.supabase.com'];
  return hosts.map((host) => `postgresql://postgres.${ref}:${u.password}@${host}:5432${u.pathname}`);
}

async function connect() {
  let lastError;
  for (const connectionString of dbUrl()) {
    const candidate = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
    try {
      await candidate.connect();
      return candidate;
    } catch (err) {
      lastError = err;
      await candidate.end().catch(() => {});
    }
  }
  throw lastError;
}

const results = [];
function record(name, ok, info) {
  results.push({ name, ok, info });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  -- ' + info : ''}`);
}

async function main() {
  const client = await connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL statement_timeout = '600s'");

    // admin_liquidity_board() depends on admin_assert_role() and reads
    // bounties/bounty_requests/profiles directly (not bounty_events), but the
    // Command Center migration is the one that (re-)declares admin_assert_role
    // on a fresh environment; apply it first if it is not already live, same
    // ordering constraint as the ticket calls out.
    const hasGuard = await client.query(
      "SELECT to_regprocedure('public.admin_assert_role()') IS NOT NULL AS ok"
    );
    if (!hasGuard.rows[0].ok) {
      await client.query(fs.readFileSync(COMMAND_CENTER_MIGRATION, 'utf8'));
      record('Command Center migration applied as a prerequisite (was missing)', true);
    } else {
      record('admin_assert_role() already present -- Command Center migration not re-applied', true);
    }

    await client.query(fs.readFileSync(LIQUIDITY_BOARD_MIGRATION, 'utf8'));
    record('liquidity board migration applies cleanly', true);

    await client.query(
      "SET LOCAL request.jwt.claims = '" +
        JSON.stringify({ app_metadata: { role: 'admin' }, sub: '00000000-0000-0000-0000-000000000000' }) +
        "'"
    );

    // The fixture poster MUST NOT have profiles.is_internal = true: a BEFORE
    // INSERT trigger (fn_bounties_default_is_test) defaults every bounty they
    // post to is_test = true, which the board deliberately excludes -- every
    // "should be flagged" assertion below would silently vanish instead of
    // failing loudly. Picking the highest-balance profile without that check
    // (as scripts/verify-command-center-migration.js does) landed on a QA
    // seed account on 2026-09-19 and produced exactly that silent-miss.
    const poster = (await client.query(
      `SELECT id FROM profiles
       WHERE deleted_at IS NULL AND COALESCE(is_internal, false) = false
       ORDER BY COALESCE(balance,0) DESC LIMIT 1`
    )).rows[0].id;
    const hunter = (await client.query(
      `SELECT id FROM profiles
       WHERE deleted_at IS NULL AND id <> $1 AND COALESCE(is_internal, false) = false
       ORDER BY created_at LIMIT 1`,
      [poster]
    )).rows[0].id;

    // $5 is the live posting minimum (fn_bounties_enforce_posting_policy,
    // 20260909000000_gate_honor_posts_and_minimum_amount.sql).
    const AMOUNT = 5.0;

    // funding_mode is decided server-side by fn_bounties_normalize_funding_mode
    // (BEFORE INSERT) and CANNOT be set by the client/INSERT -- deferred
    // funding (pay-at-accept) is the unconditional default for a non-honor v1
    // bounty at this amount, so every plain fixture below lands funding_mode
    // = 'at_accept' regardless of what is passed. To get a genuine at_post
    // control, force it via payment_architecture_version = 2 (v2 is always
    // at_post) rather than fighting the trigger. See
    // deferred-funding-rollout-state memory.
    async function makeBounty(overrides = {}) {
      const { title = 'LB verification bounty', createdHoursAgo = 0, v2 = false } = overrides;
      const row = (await client.query(
        `INSERT INTO bounties
           (title, description, amount, is_for_honor, poster_id, user_id, status, work_type,
            created_at, updated_at, payment_architecture_version)
         VALUES ($1,'rolled back',$2,false,$3,$3,'open','online',
                 now() - ($4 || ' hours')::interval, now() - ($4 || ' hours')::interval, $5)
         RETURNING id`,
        [title, AMOUNT, poster, String(createdHoursAgo), v2 ? 2 : 1]
      )).rows[0].id;
      return row;
    }

    async function bucketFor(bountyId) {
      const r = await client.query(
        'SELECT bucket FROM admin_liquidity_board(2000) WHERE bounty_id = $1', [bountyId]
      );
      return r.rows.map((x) => x.bucket);
    }

    // ── Fixture 1: no_geom ────────────────────────────────────────────────
    const bNoGeom = await makeBounty({ title: 'LB no geom', createdHoursAgo: 1 });
    record('open bounty with no geom is flagged no_geom',
      (await bucketFor(bNoGeom)).includes('no_geom'));

    // geom is derived from latitude/longitude by a BEFORE trigger
    // (fn_bounties_sync_geom) -- it cannot be set directly, an UPDATE ...
    // SET geom = ... gets silently overwritten back to NULL. Setting
    // latitude/longitude is the only real way to get a geom, but doing so
    // fires trg_bounties_notify_radius_matched /
    // trg_bounties_notify_radius_on_location_added, which as of 2026-09-19
    // calls a function with a signature that does not exist in this database
    // (fn_score_and_dispatch_bounty_notification(uuid, uuid[], integer,
    // unknown, text, jsonb) -- 42883) and throws. That is a live, unrelated
    // bug (see the note this script's caller should have surfaced alongside
    // it) that currently means EVERY open, non-test production bounty has
    // geom = NULL (verified 2026-09-19: 11/11). Disabling these two triggers
    // for this transaction only (rolled back below either way) is the only
    // way to fixture the positive "has a geom" control until that bug is fixed.
    await client.query('ALTER TABLE public.bounties DISABLE TRIGGER trg_bounties_notify_radius_matched');
    await client.query('ALTER TABLE public.bounties DISABLE TRIGGER trg_bounties_notify_radius_on_location_added');
    const bWithGeom = await makeBounty({ title: 'LB has geom', createdHoursAgo: 1 });
    await client.query('UPDATE bounties SET latitude = $2, longitude = $3 WHERE id = $1',
      [bWithGeom, 37.7749, -122.4194]);
    const geomLanded = (await client.query('SELECT geom IS NOT NULL AS ok FROM bounties WHERE id = $1', [bWithGeom])).rows[0].ok;
    record('fixture: latitude/longitude actually produced a geom', geomLanded === true);
    record('open bounty with a geom is NOT flagged no_geom',
      !(await bucketFor(bWithGeom)).includes('no_geom'));
    await client.query('ALTER TABLE public.bounties ENABLE TRIGGER trg_bounties_notify_radius_matched');
    await client.query('ALTER TABLE public.bounties ENABLE TRIGGER trg_bounties_notify_radius_on_location_added');

    // ── Fixture 2: zero_applications ─────────────────────────────────────
    const bZeroApps = await makeBounty({ title: 'LB zero apps', createdHoursAgo: 3 });
    record('open 3h with no applications is flagged zero_applications',
      (await bucketFor(bZeroApps)).includes('zero_applications'));

    const bTooFresh = await makeBounty({ title: 'LB too fresh', createdHoursAgo: 1 });
    record('open 1h with no applications is NOT flagged (under the 2h threshold)',
      !(await bucketFor(bTooFresh)).includes('zero_applications'));

    const bHasApp = await makeBounty({ title: 'LB has an app', createdHoursAgo: 3 });
    await client.query(
      `INSERT INTO bounty_requests (bounty_id, poster_id, hunter_id, status, message, created_at)
       VALUES ($1,$2,$3,'pending','hi', now())`,
      [bHasApp, poster, hunter]
    );
    record('open 3h with an application is NOT flagged zero_applications',
      !(await bucketFor(bHasApp)).includes('zero_applications'));

    // ── Fixture 3: unopened_applications ────────────────────────────────
    const bStaleUnopened = await makeBounty({ title: 'LB stale unopened app', createdHoursAgo: 30 });
    await client.query(
      `INSERT INTO bounty_requests (bounty_id, poster_id, hunter_id, status, message, created_at, poster_interacted_at)
       VALUES ($1,$2,$3,'pending','hi', now() - interval '30 hours', NULL)`,
      [bStaleUnopened, poster, hunter]
    );
    record('a 30h-old pending application the poster never opened is flagged unopened_applications',
      (await bucketFor(bStaleUnopened)).includes('unopened_applications'));

    const bOpened = await makeBounty({ title: 'LB opened app', createdHoursAgo: 30 });
    await client.query(
      `INSERT INTO bounty_requests (bounty_id, poster_id, hunter_id, status, message, created_at, poster_interacted_at)
       VALUES ($1,$2,$3,'pending','hi', now() - interval '30 hours', now())`,
      [bOpened, poster, hunter]
    );
    record('a 30h-old pending application the poster DID open is NOT flagged',
      !(await bucketFor(bOpened)).includes('unopened_applications'));

    // ── Fixture 4: funding_required_no_hire ─────────────────────────────
    const bDeferredStuck = await makeBounty({ title: 'LB deferred no hire', createdHoursAgo: 25 });
    record('at_accept bounty (the default) open 25h with no hire is flagged funding_required_no_hire',
      (await bucketFor(bDeferredStuck)).includes('funding_required_no_hire'));

    // A hire requires funding first (fn_bounties_enforce_funding_before_work
    // raises bounty_not_funded otherwise) -- book the completed escrow row
    // the real accept flow (fn_accept_bounty_request ->
    // fn_reserve_escrow_for_acceptance) would have written, then transition
    // status the same way a real acceptance does.
    const bDeferredHired = await makeBounty({ title: 'LB deferred hired', createdHoursAgo: 25 });
    await client.query(
      `INSERT INTO wallet_transactions (type, amount, bounty_id, status, user_id, description)
       VALUES ('escrow', $2, $1, 'completed', $3, 'LB verify escrow')`,
      [bDeferredHired, -AMOUNT, poster]
    );
    await client.query(
      "UPDATE bounties SET accepted_by = $2, status = 'in_progress' WHERE id = $1",
      [bDeferredHired, hunter]
    );
    record('at_accept bounty that WAS hired is NOT flagged funding_required_no_hire',
      !(await bucketFor(bDeferredHired)).includes('funding_required_no_hire'));

    // v2 (Stripe-native) is always funding_mode = 'at_post', so it can never
    // match the bucket's `funding_mode = 'at_accept'` predicate.
    const bV2Control = await makeBounty({ title: 'LB v2 not deferred', createdHoursAgo: 25, v2: true });
    record('a v2 bounty (always at_post, never deferred) is NOT flagged funding_required_no_hire',
      !(await bucketFor(bV2Control)).includes('funding_required_no_hire'));

    // ── Fixture 5: poster_gone_dark ──────────────────────────────────────
    const darkPoster = (await client.query(
      `SELECT id FROM profiles
       WHERE deleted_at IS NULL AND id NOT IN ($1,$2) AND COALESCE(is_internal, false) = false
       LIMIT 1`,
      [poster, hunter]
    )).rows[0]?.id;
    if (darkPoster) {
      const prevSeen = (await client.query('SELECT last_seen_at FROM profiles WHERE id = $1', [darkPoster])).rows[0].last_seen_at;
      await client.query("UPDATE profiles SET last_seen_at = now() - interval '72 hours' WHERE id = $1", [darkPoster]);
      const bDark = (await client.query(
        `INSERT INTO bounties (title, description, amount, is_for_honor, poster_id, user_id, status, work_type)
         VALUES ('LB gone dark poster','rolled back',$2,false,$1,$1,'open','online') RETURNING id`,
        [darkPoster, AMOUNT]
      )).rows[0].id;
      record('open bounty whose poster has not been seen in 72h is flagged poster_gone_dark',
        (await bucketFor(bDark)).includes('poster_gone_dark'));
      await client.query('UPDATE profiles SET last_seen_at = $1 WHERE id = $2', [prevSeen, darkPoster]);
    } else {
      record('poster_gone_dark fixture (skipped -- fewer than 3 non-internal profiles in this DB)', true);
    }

    record('a recently-active poster\'s open bounty is NOT flagged poster_gone_dark',
      !(await bucketFor(bZeroApps)).includes('poster_gone_dark'));

    // ── is_test exclusion ────────────────────────────────────────────────
    const bTest = await makeBounty({ title: 'LB test bounty', createdHoursAgo: 5 });
    await client.query('UPDATE bounties SET is_test = true WHERE id = $1', [bTest]);
    record('a bounty flagged is_test never appears on the board regardless of bucket',
      (await bucketFor(bTest)).length === 0);

    // ── Performance: acceptance criterion is < 2s ───────────────────────
    const t0 = Date.now();
    await client.query('SELECT * FROM admin_liquidity_board(500)');
    const elapsedMs = Date.now() - t0;
    record('admin_liquidity_board(500) returns in under 2s', elapsedMs < 2000, `${elapsedMs}ms`);

    // ── Grant / RLS: anon and authenticated (non-admin) cannot execute ──
    const grants = await client.query(
      `SELECT has_function_privilege('anon', 'public.admin_liquidity_board(integer)'::regprocedure, 'EXECUTE') AS anon_can,
              has_function_privilege('authenticated', 'public.admin_liquidity_board(integer)'::regprocedure, 'EXECUTE') AS authenticated_can`
    );
    record('anon has no EXECUTE on admin_liquidity_board', grants.rows[0].anon_can === false);
    record('authenticated (the role, independent of JWT claims) HAS EXECUTE -- the admin_assert_role() guard inside the function is the real boundary',
      grants.rows[0].authenticated_can === true);

    await client.query('SET LOCAL ROLE authenticated');
    await client.query(
      "SET LOCAL request.jwt.claims = '{\"app_metadata\":{\"role\":\"user\"},\"sub\":\"00000000-0000-0000-0000-000000000000\"}'"
    );
    await client.query('SAVEPOINT sp_guard');
    try {
      await client.query('SELECT * FROM admin_liquidity_board(5)');
      record('a non-admin authenticated user is refused (403/42501)', false, 'call succeeded');
      await client.query('RELEASE SAVEPOINT sp_guard');
    } catch (e) {
      record('a non-admin authenticated user is refused (403/42501)', e.code === '42501', e.code);
      await client.query('ROLLBACK TO SAVEPOINT sp_guard');
    }
    await client.query('RESET ROLE');
  } catch (err) {
    record('unexpected error', false, `${err.code || ''} ${err.message}`);
    if (err.position) console.log('  position:', err.position, '\n  context:', err.where || '');
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    await client.end();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main();
