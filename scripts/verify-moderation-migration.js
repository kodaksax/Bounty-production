/* scripts/verify-moderation-migration.js
 *
 * DB-level test suite for the Bounty Moderation Queue.
 *
 * The behaviour that matters most here -- the content-scan regexes, the
 * auto-flag threshold, the state machine, RLS + the admin guard, and
 * threshold -> alert firing -- cannot be tested with a mocked Supabase client,
 * because it IS the database. So this script applies
 * supabase/migrations/20260829120000_bounty_moderation_queue.sql inside a
 * single transaction, exercises the feature against the real schema and real
 * data, and then ALWAYS rolls back. Nothing it does persists.
 *
 * Usage:
 *   node scripts/verify-moderation-migration.js
 *   PG_POOLER_HOST=aws-1-us-east-2.pooler.supabase.com node scripts/verify-moderation-migration.js
 *
 * Reads DATABASE_URL from .env.production. Exits non-zero if any check fails.
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const ROOT = path.resolve(__dirname, '..');
const MIGRATION = path.join(ROOT, 'supabase/migrations/20260829120000_bounty_moderation_queue.sql');

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

const ADMIN_CLAIMS = JSON.stringify({
  app_metadata: { role: 'admin' },
  sub: '00000000-0000-0000-0000-000000000000',
});
const USER_CLAIMS = JSON.stringify({
  app_metadata: { role: 'user' },
  sub: '00000000-0000-0000-0000-000000000000',
});

async function main() {
  const client = await connect();
  let migrationApplied = false;
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL statement_timeout = '600s'");

    await client.query(fs.readFileSync(MIGRATION, 'utf8'));
    migrationApplied = true;
    record('migration applies cleanly', true);

    // Seed thresholds landed.
    const th = await client.query('SELECT count(*)::int n FROM moderation_alert_thresholds');
    record('threshold config is seeded', th.rows[0].n >= 5, `${th.rows[0].n} rows`);

    // ── 1. content scan regexes ──────────────────────────────────────────
    const spam =
      "SELECT moderation_scan_content('Promo shoutout -- DM me on Telegram', " +
      "'Use my referral code for a crypto airdrop. Message me on https://t.me/promo, link in bio.') AS s";
    const s = (await client.query(spam)).rows[0].s;
    const types = new Set(s.map((r) => r.type));
    record(
      'content scan fires promotional / off-platform / affiliate / crypto / link signals',
      ['promotional_language', 'contact_off_platform', 'affiliate_referral', 'crypto_promotion', 'external_link'].every(
        (t) => types.has(t)
      ),
      [...types].join(',')
    );
    const score = s.reduce((acc, r) => acc + Number(r.weight), 0);
    record('spam listing scores well above the auto-flag threshold (5)', score >= 5, `score=${score}`);

    const clean = (
      await client.query(
        "SELECT moderation_scan_content('Help move a couch Saturday', " +
          "'Need two people to help carry a sofa down three flights and load a truck. Two hours of work.') AS s"
      )
    ).rows[0].s;
    record(
      'a genuine handyman listing produces no signals',
      Array.isArray(clean) && clean.length === 0,
      JSON.stringify(clean)
    );

    // ── Fixtures ─────────────────────────────────────────────────────────
    await client.query(`SET LOCAL request.jwt.claims = '${ADMIN_CLAIMS}'`);
    const poster = (
      await client.query(
        'SELECT id FROM profiles WHERE deleted_at IS NULL ORDER BY COALESCE(balance,0) DESC LIMIT 1'
      )
    ).rows[0].id;
    const hunters = (
      await client.query(
        'SELECT id FROM profiles WHERE deleted_at IS NULL AND id <> $1 ORDER BY created_at LIMIT 10',
        [poster]
      )
    ).rows.map((r) => r.id);

    // A pre-existing trigger (fn_reserve_bounty_escrow) debits the poster's
    // balance when a paid bounty is posted, and a CHECK forbids going negative.
    // Top the fixture poster up so the ~$285 of test bounties can be posted.
    // The profile write-guard trigger blocks direct balance writes; use its
    // documented transaction-local bypass (20260719120000). Rolled back with
    // everything else.
    await client.query("SELECT set_config('app.bypass_profile_guard','on',true)");
    await client.query('UPDATE profiles SET balance = COALESCE(balance,0) + 100000 WHERE id=$1', [poster]);
    await client.query("SELECT set_config('app.bypass_profile_guard','off',true)");

    // Post a benign bounty, then edit in spam -> the AFTER trigger must scan it.
    const bounty = (
      await client.query(
        `INSERT INTO bounties (title, description, amount, is_for_honor, poster_id, user_id, status, work_type)
         VALUES ('Assemble flat-pack furniture',
                 'Need help assembling a flat-pack wardrobe in my apartment this weekend, roughly two hours of work.',
                 15.00, false, $1, $1, 'open', 'online')
         RETURNING id`,
        [poster]
      )
    ).rows[0].id;

    let sig = await client.query('SELECT count(*)::int n FROM moderation_signals WHERE bounty_id=$1', [bounty]);
    record('a genuine task bounty accumulates no signals', sig.rows[0].n === 0);

    await client.query(
      `UPDATE bounties SET title='Promo shoutout -- DM me on Telegram',
         description='Use my referral code for a crypto airdrop. Message me on https://t.me/promo, link in bio.'
       WHERE id=$1`,
      [bounty]
    );

    sig = await client.query('SELECT signal_type FROM moderation_signals WHERE bounty_id=$1', [bounty]);
    record('editing spam into a listing triggers a content scan', sig.rowCount >= 4, `${sig.rowCount} signals`);

    const mod = (
      await client.query('SELECT state, auto_flagged, signal_score FROM bounty_moderation WHERE bounty_id=$1', [bounty])
    ).rows[0];
    record(
      'crossing the signal_score threshold auto-flags the listing (never further)',
      mod && mod.state === 'flagged' && mod.auto_flagged === true && Number(mod.signal_score) >= 5,
      JSON.stringify(mod)
    );

    const evt = (
      await client.query(
        "SELECT actor, to_state FROM bounty_moderation_events WHERE bounty_id=$1 AND to_state='flagged'",
        [bounty]
      )
    ).rows[0];
    record('auto-flag writes a system-actor transition event', evt && evt.actor === 'system');

    const bStatus = (await client.query('SELECT status::text FROM bounties WHERE id=$1', [bounty])).rows[0].status;
    record('auto-flag does NOT change bounties.status', bStatus === 'open', bStatus);

    const pStatus = (
      await client.query('SELECT account_status, account_restricted FROM profiles WHERE id=$1', [poster])
    ).rows[0];
    record(
      'auto-flag does NOT touch the poster account',
      pStatus.account_status === 'active' && pStatus.account_restricted === false,
      JSON.stringify(pStatus)
    );

    const alert = await client.query(
      "SELECT count(*)::int n FROM moderation_alerts WHERE bounty_id=$1 AND threshold_key='signal_score'",
      [bounty]
    );
    record('auto-flag raises exactly one founder alert', alert.rows[0].n === 1, `${alert.rows[0].n}`);

    // ── 2. admin state machine ──────────────────────────────────────────
    let r = await client.query(
      "SELECT admin_moderation_transition($1,'under_review','Taking a closer look') AS j",
      [bounty]
    );
    record('flagged -> under_review is allowed and returns the new state', r.rows[0].j.to_state === 'under_review');

    r = await client.query("SELECT admin_moderation_transition($1,'hidden','Promotional / no task') AS j", [bounty]);
    record(
      'hide records suspicious_confirmed and archives the listing',
      r.rows[0].j.resolution === 'suspicious_confirmed' && r.rows[0].j.bounty_status === 'archived',
      JSON.stringify(r.rows[0].j)
    );

    r = await client.query("SELECT admin_moderation_transition($1,'approved','False positive after review') AS j", [bounty]);
    record(
      'approve from hidden reinstates the listing (hunter_id is null) and records legitimate',
      r.rows[0].j.resolution === 'legitimate' && r.rows[0].j.bounty_status === 'open',
      JSON.stringify(r.rows[0].j)
    );

    await client.query('SAVEPOINT sp_illegal');
    try {
      await client.query("SELECT admin_moderation_transition($1,'removed','x') AS j", [bounty]); // approved -> removed OK
      await client.query("SELECT admin_moderation_transition($1,'active','x') AS j", [bounty]); // removed -> active ILLEGAL
      record('removed -> active is rejected by the state machine', false, 'call succeeded');
      await client.query('RELEASE SAVEPOINT sp_illegal');
    } catch (e) {
      record('removed -> active is rejected by the state machine', e.code === '22023', e.code);
      await client.query('ROLLBACK TO SAVEPOINT sp_illegal');
    }

    await client.query('SAVEPOINT sp_reason');
    try {
      await client.query("SELECT admin_moderation_transition($1,'flagged','') AS j", [bounty]);
      record('a transition with no reason is rejected', false, 'call succeeded');
      await client.query('RELEASE SAVEPOINT sp_reason');
    } catch (e) {
      record('a transition with no reason is rejected', e.code === '22023', e.code);
      await client.query('ROLLBACK TO SAVEPOINT sp_reason');
    }

    // ── 3. sweep: application velocity ──────────────────────────────────
    const velBounty = (
      await client.query(
        `INSERT INTO bounties (title, description, amount, is_for_honor, poster_id, user_id, status, work_type)
         VALUES ('Velocity verify', 'ordinary listing text that names no task', 10.00, false, $1, $1, 'open', 'online')
         RETURNING id`,
        [poster]
      )
    ).rows[0].id;
    for (const h of hunters.slice(0, 8)) {
      await client.query(
        `INSERT INTO bounty_requests (bounty_id, poster_id, hunter_id, status) VALUES ($1,$2,$3,'pending')`,
        [velBounty, poster, h]
      );
    }
    const swept = await client.query('SELECT * FROM run_moderation_sweep()');
    const velAlerts = swept.rows.filter(
      (a) => a.threshold_key === 'application_velocity' && a.bounty_id === velBounty
    );
    record(
      'sweep raises an application_velocity alert for a bounty with 8 apps in one window',
      velAlerts.length === 1,
      velAlerts.map((a) => a.summary).join(' | ')
    );
    const secondSweep = await client.query('SELECT * FROM run_moderation_sweep()');
    record(
      'a second sweep in the same hour does not re-alert (alert_key dedup)',
      !secondSweep.rows.some((a) => a.threshold_key === 'application_velocity' && a.bounty_id === velBounty)
    );
    const velSig = await client.query(
      "SELECT count(*)::int n FROM moderation_signals WHERE bounty_id=$1 AND signal_type='application_velocity'",
      [velBounty]
    );
    record('sweep also records the application_velocity signal on the bounty', velSig.rows[0].n === 1);

    // ── 4. sweep: new-account high value (created_at rewound, rolled back) ─
    await client.query("SELECT set_config('app.bypass_profile_guard','on',true)");
    await client.query("UPDATE profiles SET created_at = now() - interval '2 hours' WHERE id=$1", [poster]);
    await client.query("SELECT set_config('app.bypass_profile_guard','off',true)");
    const newAcctBounty = (
      await client.query(
        `INSERT INTO bounties (title, description, amount, is_for_honor, poster_id, user_id, status, work_type)
         VALUES ('Pay me to promote', 'ordinary listing text that names no task', 250.00, false, $1, $1, 'open', 'online')
         RETURNING id`,
        [poster]
      )
    ).rows[0].id;
    await client.query('SELECT run_moderation_sweep()');
    const naSig = await client.query(
      "SELECT count(*)::int n FROM moderation_signals WHERE bounty_id=$1 AND signal_type='new_account_high_value'",
      [newAcctBounty]
    );
    record('sweep flags a >=$200 listing from an account <24h old', naSig.rows[0].n === 1);

    // ── 5. notifications.type CHECK accepts the moderation type ──────────
    await client.query('SAVEPOINT sp_notif');
    try {
      await client.query(
        `INSERT INTO notifications (user_id, type, category, title, body, read)
         VALUES ($1,'moderation_alert','security','t','b',false)`,
        [poster]
      );
      await client.query(
        `INSERT INTO notifications (user_id, type, category, title, body, read)
         VALUES ($1,'message','messages','t','b',false)`,
        [poster]
      );
      record("notifications.type CHECK now allows 'moderation_alert' and still allows 'message'", true);
      await client.query('ROLLBACK TO SAVEPOINT sp_notif');
    } catch (e) {
      record("notifications.type CHECK now allows 'moderation_alert' and still allows 'message'", false, e.message);
      await client.query('ROLLBACK TO SAVEPOINT sp_notif');
    }

    // ── 6. reads answer for an admin ───────────────────────────────────
    const q = await client.query("SELECT * FROM admin_moderation_queue(NULL, 100, 0)");
    record(
      'admin_moderation_queue returns every field the brief lists',
      q.rowCount > 0 &&
        [
          'application_velocity',
          'related_listings',
          'poster_account_age_days',
          'flagged_reason',
          'signals',
          'total_count',
        ].every((k) => k in q.rows[0]),
      `${q.rowCount} rows`
    );
    const detail = (await client.query('SELECT admin_moderation_detail($1) AS d', [velBounty])).rows[0].d;
    record(
      'admin_moderation_detail assembles bounty + poster + signals + events + applications + related',
      detail &&
        detail.bounty &&
        'signals' in detail &&
        'events' in detail &&
        detail.applications &&
        'related_listings' in detail
    );
    const metrics = (await client.query('SELECT admin_moderation_metrics() AS m')).rows[0].m;
    record(
      'admin_moderation_metrics separates legitimate demand from suspicious demand',
      'legitimate_demand' in metrics && 'suspicious_demand' in metrics && 'by_state' in metrics,
      JSON.stringify({ legit: metrics.legitimate_demand, susp: metrics.suspicious_demand })
    );

    // ── 7. authorization + RLS ─────────────────────────────────────────
    await client.query('SET LOCAL ROLE authenticated');
    await client.query(`SET LOCAL request.jwt.claims = '${USER_CLAIMS}'`);
    for (const [label, sql] of [
      ['admin_moderation_queue', 'SELECT * FROM admin_moderation_queue(NULL,5,0)'],
      ['admin_moderation_detail', 'SELECT admin_moderation_detail(gen_random_uuid())'],
      ['admin_moderation_metrics', 'SELECT admin_moderation_metrics()'],
      ['admin_moderation_alerts', 'SELECT * FROM admin_moderation_alerts(false,5)'],
      ['admin_moderation_thresholds', 'SELECT * FROM admin_moderation_thresholds()'],
      ['admin_moderation_transition', "SELECT admin_moderation_transition(gen_random_uuid(),'approved','x')"],
      ['admin_update_moderation_threshold', "SELECT admin_update_moderation_threshold('signal_score', 4)"],
      ['admin_acknowledge_moderation_alert', 'SELECT admin_acknowledge_moderation_alert(gen_random_uuid())'],
    ]) {
      await client.query('SAVEPOINT sp_guard');
      try {
        await client.query(sql);
        record(`non-admin is refused by ${label}`, false, 'call succeeded');
        await client.query('RELEASE SAVEPOINT sp_guard');
      } catch (e) {
        record(`non-admin is refused by ${label}`, e.code === '42501', e.code);
        await client.query('ROLLBACK TO SAVEPOINT sp_guard');
      }
    }

    for (const [label, sql] of [
      ['bounty_moderation', 'SELECT count(*)::int n FROM bounty_moderation'],
      ['moderation_signals', 'SELECT count(*)::int n FROM moderation_signals'],
      ['moderation_alerts', 'SELECT count(*)::int n FROM moderation_alerts'],
    ]) {
      const rr = await client.query(sql);
      record(`non-admin reading ${label} sees nothing (RLS)`, rr.rows[0].n === 0, `${rr.rows[0].n} rows visible`);
    }

    for (const [label, sql] of [
      ['run_moderation_sweep', 'SELECT run_moderation_sweep()'],
      ['moderation_apply_signals', "SELECT moderation_apply_signals(gen_random_uuid(),'[]'::jsonb,'content')"],
      ['moderation_admin_recipients', 'SELECT * FROM moderation_admin_recipients()'],
    ]) {
      await client.query('SAVEPOINT sp_sec');
      try {
        await client.query(sql);
        record(`non-admin cannot call ${label}`, false, 'call succeeded');
        await client.query('RELEASE SAVEPOINT sp_sec');
      } catch (e) {
        record(`non-admin cannot call ${label}`, e.code === '42501', e.code);
        await client.query('ROLLBACK TO SAVEPOINT sp_sec');
      }
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
  console.log(`\n${results.length - failed.length}/${results.length} checks passed (migrationApplied=${migrationApplied})`);
  process.exit(failed.length ? 1 : 0);
}

main();
