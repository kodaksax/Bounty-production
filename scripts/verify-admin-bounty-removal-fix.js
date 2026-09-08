/* scripts/verify-admin-bounty-removal-fix.js
 *
 * DB-level test suite for the admin bounty-authorization fixes:
 *   - supabase/migrations/20260904010000_admin_bounty_removal_authorization_fix.sql
 *     ("Remove for violation")
 *   - supabase/migrations/20260904020000_admin_bounty_status_authorization_fix.sql
 *     ("Status actions" -- Archive/Cancel/Mark completed/Reopen), the same
 *     root-cause bug in the sibling code path on the same admin screen.
 *
 * Mirrors scripts/verify-moderation-migration.js: applies the base moderation
 * migration and both fixes inside a single transaction, exercises the real
 * scenario that was broken (an admin acting on a bounty they do not own)
 * against the real schema and RLS policies, then ALWAYS rolls back. Nothing
 * it does persists.
 *
 * Usage:
 *   node scripts/verify-admin-bounty-removal-fix.js
 *   PG_POOLER_HOST=aws-1-us-east-2.pooler.supabase.com node scripts/verify-admin-bounty-removal-fix.js
 *
 * Reads DATABASE_URL from .env.production. Exits non-zero if any check fails.
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const ROOT = path.resolve(__dirname, '..');
const BASE_MIGRATION = path.join(ROOT, 'supabase/migrations/20260829120000_bounty_moderation_queue.sql');
const FIX_MIGRATION = path.join(
  ROOT,
  'supabase/migrations/20260904010000_admin_bounty_removal_authorization_fix.sql'
);
const STATUS_FIX_MIGRATION = path.join(
  ROOT,
  'supabase/migrations/20260904020000_admin_bounty_status_authorization_fix.sql'
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

// A fake admin identity that is deliberately NOT the poster of any fixture
// bounty -- this is the exact scenario that was broken: an admin acting on a
// bounty they do not own.
const ADMIN_UUID = '00000000-0000-0000-0000-0000000000aa';
const ADMIN_CLAIMS = JSON.stringify({ app_metadata: { role: 'admin' }, sub: ADMIN_UUID });
function userClaims(sub) {
  return JSON.stringify({ app_metadata: { role: 'user' }, sub });
}

async function main() {
  const client = await connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL statement_timeout = '600s'");

    await client.query(fs.readFileSync(BASE_MIGRATION, 'utf8'));
    await client.query(fs.readFileSync(FIX_MIGRATION, 'utf8'));
    await client.query(fs.readFileSync(STATUS_FIX_MIGRATION, 'utf8'));
    record('all three migrations apply cleanly, in order', true);

    // ── Fixtures ─────────────────────────────────────────────────────────
    // Deliberately created under the connecting (superuser/table-owner) role,
    // which bypasses RLS -- exactly like the base moderation script's
    // fixtures. RLS is only actually exercised once we `SET LOCAL ROLE
    // authenticated` below, which is what PostgREST (and therefore the app)
    // runs as.
    await client.query(`SET LOCAL request.jwt.claims = '${ADMIN_CLAIMS}'`);
    const poster = (
      await client.query(
        'SELECT id FROM profiles WHERE deleted_at IS NULL ORDER BY COALESCE(balance,0) DESC LIMIT 1'
      )
    ).rows[0].id;
    record('fixture poster resolved, distinct from the fake admin identity', poster !== ADMIN_UUID, poster);
    const otherUser = (
      await client.query('SELECT id FROM profiles WHERE deleted_at IS NULL AND id <> $1 LIMIT 1', [poster])
    ).rows[0].id;

    const bounty = (
      await client.query(
        `INSERT INTO bounties (title, description, amount, is_for_honor, poster_id, user_id, status, work_type)
         VALUES ('Definitely spam -- DM me on Telegram for crypto airdrop',
                 'Use my referral code, link in bio, message me on WhatsApp.',
                 0, true, $1, $1, 'open', 'online')
         RETURNING id`,
        [poster]
      )
    ).rows[0].id;
    const ownBounty = (
      await client.query(
        `INSERT INTO bounties (title, description, amount, is_for_honor, poster_id, user_id, status, work_type)
         VALUES ('Help move a couch', 'Two hours, need two people.', 20, false, $1, $1, 'open', 'online')
         RETURNING id`,
        [poster]
      )
    ).rows[0].id;
    const statusBounty = (
      await client.query(
        `INSERT INTO bounties (title, description, amount, is_for_honor, poster_id, user_id, status, work_type)
         VALUES ('Assemble a bookshelf', 'One hour, IKEA kit provided.', 15, false, $1, $1, 'open', 'online')
         RETURNING id`,
        [poster]
      )
    ).rows[0].id;

    // From here on, run as `authenticated` -- the role PostgREST actually
    // uses, and the only role the RLS policies (`TO authenticated`) apply to.
    // The connecting role is the table owner and bypasses RLS entirely, which
    // is why fixture setup above happens before this switch.
    await client.query('SET LOCAL ROLE authenticated');
    await client.query(`SET LOCAL request.jwt.claims = '${ADMIN_CLAIMS}'`);

    // ── 1. Reproduce the reported bug exactly: the OLD code path ─────────
    // (a raw `.update({status:'archived'}).eq('id', id)` as a non-owning
    // admin) is silently dropped by the ownership-only RLS policy.
    const oldPath = await client.query(
      "UPDATE bounties SET status = 'archived', updated_at = now() WHERE id = $1 RETURNING id",
      [bounty]
    );
    record(
      'reproduces the bug: the old direct-update path returns zero rows for a non-owning admin',
      oldPath.rowCount === 0,
      `${oldPath.rowCount} rows`
    );
    const stillOpen = (await client.query('SELECT status::text FROM bounties WHERE id=$1', [bounty])).rows[0]
      .status;
    record('...and the bounty is confirmed untouched (still open), not actually removed', stillOpen === 'open');

    // ── 2. The fix: admin_moderation_transition succeeds for the same admin,
    //    the same non-owned bounty ─────────────────────────────────────────
    let r = await client.query(
      "SELECT admin_moderation_transition($1,'removed','Community guideline violation: Spam') AS j",
      [bounty]
    );
    record(
      '1,3,4. an admin who is NOT the poster removes the bounty successfully via the fixed path',
      r.rows[0].j.to_state === 'removed' && !r.rows[0].j.idempotent,
      JSON.stringify(r.rows[0].j)
    );
    const removedStatus = (await client.query('SELECT status::text FROM bounties WHERE id=$1', [bounty])).rows[0]
      .status;
    record(
      'removal actually took the bounty out of the marketplace (archived/deleted)',
      removedStatus === 'archived' || removedStatus === 'deleted',
      removedStatus
    );

    // ── 11. Audit trail ────────────────────────────────────────────────
    const events = await client.query(
      "SELECT actor, actor_id, reason FROM bounty_moderation_events WHERE bounty_id=$1 AND to_state='removed'",
      [bounty]
    );
    record(
      'the removal is recorded in the audit trail with the acting admin and reason',
      events.rowCount === 1 &&
        events.rows[0].actor === 'admin' &&
        events.rows[0].actor_id === ADMIN_UUID &&
        events.rows[0].reason.includes('Spam'),
      JSON.stringify(events.rows[0])
    );

    // ── 5, 8. Idempotency: remove an already-removed bounty ──────────────
    r = await client.query(
      "SELECT admin_moderation_transition($1,'removed','Second click') AS j",
      [bounty]
    );
    record(
      'removing an already-removed bounty is an idempotent success, not an error',
      r.rows[0].j.idempotent === true && r.rows[0].j.to_state === 'removed',
      JSON.stringify(r.rows[0].j)
    );
    const eventsAfterRepeat = await client.query(
      "SELECT count(*)::int n FROM bounty_moderation_events WHERE bounty_id=$1 AND to_state='removed'",
      [bounty]
    );
    record(
      'a repeat removal (double-click / race) does not write a second audit event',
      eventsAfterRepeat.rows[0].n === 1,
      `${eventsAfterRepeat.rows[0].n} events`
    );

    // ── 6. A genuinely nonexistent bounty ─────────────────────────────────
    await client.query('SAVEPOINT sp_missing');
    try {
      await client.query("SELECT admin_moderation_transition(gen_random_uuid(),'removed','x') AS j");
      record('a nonexistent bounty is rejected distinctly (not-found, not a permission error)', false, 'call succeeded');
      await client.query('RELEASE SAVEPOINT sp_missing');
    } catch (e) {
      record(
        'a nonexistent bounty is rejected distinctly (not-found, not a permission error)',
        e.code === 'P0002',
        e.code
      );
      await client.query('ROLLBACK TO SAVEPOINT sp_missing');
    }

    // ── 2, 12. Non-admin cannot perform the admin removal action ──────────
    await client.query(`SET LOCAL request.jwt.claims = '${userClaims(poster)}'`);
    await client.query('SAVEPOINT sp_nonadmin');
    try {
      await client.query("SELECT admin_moderation_transition($1,'removed','x') AS j", [bounty]);
      record('a non-admin (even the bounty owner) cannot call the admin removal RPC', false, 'call succeeded');
      await client.query('RELEASE SAVEPOINT sp_nonadmin');
    } catch (e) {
      record('a non-admin (even the bounty owner) cannot call the admin removal RPC', e.code === '42501', e.code);
      await client.query('ROLLBACK TO SAVEPOINT sp_nonadmin');
    }

    // ── 12. Regression: normal ownership permissions are untouched ────────
    // The poster (a genuine, non-admin user) can still update their OWN
    // bounty directly -- the ownership RLS policy was never modified.
    // (Still under request.jwt.claims = userClaims(poster) from the block above.)
    const ownUpdate = await client.query(
      "UPDATE bounties SET status = 'cancelled', updated_at = now() WHERE id = $1 RETURNING id",
      [ownBounty]
    );
    record(
      "a normal user can still update their own bounty (ownership RLS untouched)",
      ownUpdate.rowCount === 1,
      `${ownUpdate.rowCount} rows`
    );

    // A DIFFERENT normal user (not admin, not poster) still cannot touch it.
    await client.query(`SET LOCAL request.jwt.claims = '${userClaims(otherUser)}'`);
    const strangerUpdate = await client.query(
      "UPDATE bounties SET status = 'cancelled', updated_at = now() WHERE id = $1 RETURNING id",
      [ownBounty]
    );
    record(
      'a normal user still cannot update a bounty they do not own (no security regression)',
      strangerUpdate.rowCount === 0,
      `${strangerUpdate.rowCount} rows`
    );

    // ── Status-actions fix (admin_set_bounty_status): the identical bug in the
    //    sibling code path (Archive/Cancel/Mark completed/Reopen) ───────────
    await client.query(`SET LOCAL request.jwt.claims = '${ADMIN_CLAIMS}'`);

    const oldStatusPath = await client.query(
      "UPDATE bounties SET status = 'archived', updated_at = now() WHERE id = $1 RETURNING id",
      [statusBounty]
    );
    record(
      'reproduces the status-action bug too: old direct-update path returns zero rows for a non-owning admin',
      oldStatusPath.rowCount === 0,
      `${oldStatusPath.rowCount} rows`
    );

    // `SELECT * FROM fn(...)` (not `SELECT fn(...) AS x`) so `pg` expands the
    // returned `bounties` composite row into real columns instead of a raw
    // composite-literal string.
    let sr = await client.query("SELECT * FROM admin_set_bounty_status($1,'archived','Spam listing')", [
      statusBounty,
    ]);
    record(
      'an admin who is NOT the poster archives the bounty successfully via the fixed path',
      sr.rows[0].status === 'archived',
      JSON.stringify({ id: sr.rows[0].id, status: sr.rows[0].status })
    );

    sr = await client.query("SELECT * FROM admin_set_bounty_status($1,'archived','Repeat click')", [statusBounty]);
    record(
      'setting a bounty to the status it is already in is an idempotent success',
      sr.rows[0].status === 'archived',
      JSON.stringify({ id: sr.rows[0].id, status: sr.rows[0].status })
    );

    await client.query('SAVEPOINT sp_illegal_status');
    try {
      // archived -> completed is not in the transition map (archived only
      // permits -> open).
      await client.query("SELECT admin_set_bounty_status($1,'completed','x') AS b", [statusBounty]);
      record('an illegal status transition is rejected server-side, not just hidden by the UI', false, 'call succeeded');
      await client.query('RELEASE SAVEPOINT sp_illegal_status');
    } catch (e) {
      record(
        'an illegal status transition is rejected server-side, not just hidden by the UI',
        e.code === '22023',
        e.code
      );
      await client.query('ROLLBACK TO SAVEPOINT sp_illegal_status');
    }

    await client.query('SAVEPOINT sp_status_missing');
    try {
      await client.query("SELECT admin_set_bounty_status(gen_random_uuid(),'archived','x') AS b");
      record('a nonexistent bounty is rejected distinctly by admin_set_bounty_status too', false, 'call succeeded');
      await client.query('RELEASE SAVEPOINT sp_status_missing');
    } catch (e) {
      record(
        'a nonexistent bounty is rejected distinctly by admin_set_bounty_status too',
        e.code === 'P0002',
        e.code
      );
      await client.query('ROLLBACK TO SAVEPOINT sp_status_missing');
    }

    await client.query(`SET LOCAL request.jwt.claims = '${userClaims(poster)}'`);
    await client.query('SAVEPOINT sp_status_nonadmin');
    try {
      await client.query("SELECT admin_set_bounty_status($1,'open','x') AS b", [statusBounty]);
      record('a non-admin (even the bounty owner) cannot call admin_set_bounty_status', false, 'call succeeded');
      await client.query('RELEASE SAVEPOINT sp_status_nonadmin');
    } catch (e) {
      record(
        'a non-admin (even the bounty owner) cannot call admin_set_bounty_status',
        e.code === '42501',
        e.code
      );
      await client.query('ROLLBACK TO SAVEPOINT sp_status_nonadmin');
    }

    // ── admin_warnings: was silently broken for every real admin ──────────
    await client.query(`SET LOCAL request.jwt.claims = '${ADMIN_CLAIMS}'`);
    await client.query('SAVEPOINT sp_warn_admin');
    try {
      await client.query(
        `INSERT INTO admin_warnings (admin_id, user_id, bounty_id, violation_type, message)
         VALUES (NULL, $1, $2, 'spam', 'test')`,
        [poster, bounty]
      );
      record('a real admin can now insert into admin_warnings (was dead profiles.role check)', true);
      await client.query('RELEASE SAVEPOINT sp_warn_admin');
    } catch (e) {
      record(
        'a real admin can now insert into admin_warnings (was dead profiles.role check)',
        false,
        `${e.code} ${e.message}`
      );
      await client.query('ROLLBACK TO SAVEPOINT sp_warn_admin');
    }

    await client.query(`SET LOCAL request.jwt.claims = '${userClaims(otherUser)}'`);
    await client.query('SAVEPOINT sp_warn_user');
    try {
      await client.query(
        `INSERT INTO admin_warnings (admin_id, user_id, bounty_id, violation_type, message)
         VALUES ($1, $2, $3, 'spam', 'test')`,
        [otherUser, poster, bounty]
      );
      record('a non-admin cannot insert into admin_warnings', false, 'call succeeded');
      await client.query('RELEASE SAVEPOINT sp_warn_user');
    } catch (e) {
      record('a non-admin cannot insert into admin_warnings', true, e.code);
      await client.query('ROLLBACK TO SAVEPOINT sp_warn_user');
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
