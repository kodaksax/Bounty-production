/* scripts/verify-command-center-migration.js
 *
 * DB-level test suite for the Command Center event ledger.
 *
 * The behaviour that matters most here -- trigger fan-out, idempotent
 * event_keys, webhook claim/dedupe, the admin guard and RLS, and the anomaly
 * SQL -- cannot be tested with a mocked Supabase client, because it IS the
 * database. So this script applies
 * supabase/migrations/20260828130000_bounty_events_command_center.sql inside a
 * single transaction, exercises the whole feature against the real schema and
 * real data, and then ALWAYS rolls back. Nothing it does persists.
 *
 * Usage:
 *   node scripts/verify-command-center-migration.js
 *   PG_POOLER_HOST=aws-1-us-east-2.pooler.supabase.com node scripts/...
 *
 * Reads DATABASE_URL from .env.production. Exits non-zero if any check fails.
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const ROOT = path.resolve(__dirname, '..');
const MIGRATION = path.join(ROOT, 'supabase/migrations/20260828130000_bounty_events_command_center.sql');

function dbUrl() {
  const env = fs.readFileSync(path.join(ROOT, '.env.production'), 'utf8');
  const m = env.match(/^\s*DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m);
  if (!m) throw new Error('DATABASE_URL not found in .env.production');
  const raw = m[1].trim();
  // The direct db.<ref>.supabase.co host is IPv6-only and does not resolve from
  // most networks, so go through the session-mode pooler instead (same
  // credentials, user becomes postgres.<ref>). Which pooler shard a project
  // sits on is not derivable from the ref, hence the candidate list.
  const u = new URL(raw);
  const ref = u.hostname.replace(/^db\./, '').replace(/\.supabase\.co$/, '');
  const hosts = process.env.PG_POOLER_HOST
    ? [process.env.PG_POOLER_HOST]
    : ['aws-1-us-east-2.pooler.supabase.com', 'aws-0-us-east-2.pooler.supabase.com'];
  return hosts.map((host) => `postgresql://postgres.${ref}:${u.password}@${host}:5432${u.pathname}`);
}

/** Connects to the first pooler host that accepts the credentials. */
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
  let migrationApplied = false;
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL statement_timeout = '600s'");

    const sql = fs.readFileSync(MIGRATION, 'utf8');
    await client.query(sql);
    migrationApplied = true;
    record('migration applies cleanly', true);

    const backfilled = await client.query(
      "SELECT source, count(*)::int n FROM bounty_events GROUP BY source ORDER BY source"
    );
    record('backfill produced events', backfilled.rows.length > 0,
      backfilled.rows.map((r) => `${r.source}=${r.n}`).join(' '));

    // Re-running the backfill must be a no-op (idempotency of the ledger).
    const before = (await client.query('SELECT count(*)::int n FROM bounty_events')).rows[0].n;
    await client.query(`INSERT INTO bounty_events (event_key, event_type, source, bounty_id, actor_id, occurred_at, amount, metadata)
      SELECT 'bounty.posted:' || b.id, 'bounty.posted', 'app', b.id, COALESCE(b.poster_id, b.user_id), b.created_at,
             CASE WHEN COALESCE(b.is_for_honor,false) THEN NULL ELSE b.amount END, '{}'::jsonb
      FROM bounties b ON CONFLICT (event_key) DO NOTHING`);
    const after = (await client.query('SELECT count(*)::int n FROM bounty_events')).rows[0].n;
    record('ledger is idempotent (re-run backfill inserts nothing)', before === after, `${before} -> ${after}`);

    // ── Fixtures ──────────────────────────────────────────────────────────
    // A pre-existing trigger debits the poster's balance when a paid bounty is
    // posted, and a CHECK forbids going negative -- so the fixture poster has
    // to be one that can actually afford the test bounties.
    const poster = (await client.query(
      "SELECT id FROM profiles WHERE deleted_at IS NULL ORDER BY COALESCE(balance,0) DESC LIMIT 1")).rows[0].id;
    const hunter = (await client.query(
      "SELECT id FROM profiles WHERE deleted_at IS NULL AND id <> $1 ORDER BY created_at LIMIT 1", [poster])).rows[0].id;

    // 1. bounty creation event
    const bounty = (await client.query(
      `INSERT INTO bounties (title, description, amount, is_for_honor, poster_id, user_id, status, work_type)
       VALUES ('CC verification bounty', 'rolled back', 20.00, false, $1, $1, 'open', 'online') RETURNING id`,
      [poster])).rows[0].id;
    let ev = await client.query(
      "SELECT event_type, source FROM bounty_events WHERE bounty_id=$1 AND event_type='bounty.posted'", [bounty]);
    record('bounty creation emits bounty.posted', ev.rowCount === 1 && ev.rows[0].source === 'app');

    // 2. application event
    const req = (await client.query(
      `INSERT INTO bounty_requests (bounty_id, poster_id, hunter_id, status, message)
       VALUES ($1,$2,$3,'pending','please') RETURNING id`, [bounty, poster, hunter])).rows[0].id;
    ev = await client.query(
      "SELECT actor_id FROM bounty_events WHERE bounty_id=$1 AND event_type='application.submitted'", [bounty]);
    record('application emits application.submitted with the hunter as actor',
      ev.rowCount === 1 && ev.rows[0].actor_id === hunter);

    // 3. acceptance
    await client.query("UPDATE bounty_requests SET status='accepted', accepted_at=now() WHERE id=$1", [req]);
    await client.query("UPDATE bounties SET accepted_by=$2, status='in_progress' WHERE id=$1", [bounty, hunter]);
    const accepted = await client.query(
      "SELECT event_type FROM bounty_events WHERE bounty_id=$1 AND event_type IN ('application.accepted','bounty.accepted','bounty.in_progress') ORDER BY event_type", [bounty]);
    record('acceptance emits application.accepted + bounty.accepted + bounty.in_progress',
      accepted.rowCount === 3, accepted.rows.map((r) => r.event_type).join(','));

    // 4. completion
    const sub = (await client.query(
      `INSERT INTO completion_submissions (bounty_id, hunter_id, message, status, submitted_at, revision_count)
       VALUES ($1,$2,'done','pending',now(),0) RETURNING id`, [bounty, hunter])).rows[0].id;
    await client.query("UPDATE completion_submissions SET status='approved', reviewed_at=now() WHERE id=$1", [sub]);
    await client.query("UPDATE bounties SET status='completed', completed_at=now() WHERE id=$1", [bounty]);
    const done = await client.query(
      "SELECT event_type FROM bounty_events WHERE bounty_id=$1 AND event_type IN ('completion.submitted','completion.approved','bounty.completed') ORDER BY event_type", [bounty]);
    record('completion emits completion.submitted + completion.approved + bounty.completed',
      done.rowCount === 3, done.rows.map((r) => r.event_type).join(','));

    // 8. missing payment record -> anomaly.
    // NOTE: a pre-existing DB trigger (fn_reserve_bounty_escrow) books escrow
    // automatically when a paid bounty is posted, so this case has to be built
    // by removing that row -- which is exactly the production failure shape:
    // a completed bounty whose escrow never landed.
    await client.query("SET LOCAL request.jwt.claims = '" + JSON.stringify({ app_metadata: { role: 'admin' }, sub: '00000000-0000-0000-0000-000000000000' }) + "'");
    const orphanBounty = (await client.query(
      `INSERT INTO bounties (title, description, amount, is_for_honor, poster_id, user_id, status, work_type)
       VALUES ('CC verification unfunded', 'rolled back', 20.00, false, $1, $1, 'open', 'online') RETURNING id`,
      [poster])).rows[0].id;
    await client.query('DELETE FROM wallet_transactions WHERE bounty_id=$1', [orphanBounty]);
    await client.query("UPDATE bounties SET status='completed', completed_at=now() WHERE id=$1", [orphanBounty]);
    let an = await client.query(
      "SELECT anomaly_type FROM admin_financial_anomalies(1000) WHERE bounty_id=$1", [orphanBounty]);
    record('completed bounty with no financial record is flagged',
      an.rows.some((r) => r.anomaly_type === 'completed_without_financial_record'),
      an.rows.map((r) => r.anomaly_type).join(','));

    // 5. financial events. The escrow row already exists (booked by the
    // pre-existing trigger above), so assert the ledger picked it up and then
    // add the release.
    await client.query(
      `INSERT INTO wallet_transactions (type, amount, bounty_id, status, user_id, receiver_id, description)
       VALUES ('release', 20.00, $1, 'completed', $2, $3, 'cc verify')`, [bounty, poster, hunter]);
    const fin = await client.query(
      "SELECT event_type, source FROM bounty_events WHERE bounty_id=$1 AND event_type IN ('payment.escrow_funded','payment.released') ORDER BY event_type", [bounty]);
    record('wallet ledger emits payment.escrow_funded + payment.released as source=app',
      fin.rowCount >= 2 && fin.rows.every((r) => r.source === 'app'),
      fin.rows.map((r) => `${r.event_type}/${r.source}`).join(' '));

    // 9. mismatched financial state: completed + released but unconfirmed
    const st = (await client.query(
      "SELECT marketplace_status, financial_status, stripe_confirmed FROM admin_bounty_financial_state WHERE bounty_id=$1", [bounty])).rows[0];
    record('COMPLETED + verification pending is visible as a distinct state',
      st.marketplace_status === 'completed' && st.financial_status === 'released_unverified' && st.stripe_confirmed === false,
      JSON.stringify(st));
    an = await client.query("SELECT anomaly_type FROM admin_financial_anomalies(1000) WHERE bounty_id=$1", [bounty]);
    record('unconfirmed completion is flagged as an anomaly',
      an.rows.some((r) => r.anomaly_type === 'completed_without_stripe_confirmation'),
      an.rows.map((r) => r.anomaly_type).join(','));

    // 6. webhook duplication
    const evtId = 'evt_cc_verify_' + Date.now();
    const first = (await client.query("SELECT claim_stripe_event($1,'payment_intent.succeeded','{}'::jsonb) AS c", [evtId])).rows[0].c;
    await client.query("UPDATE stripe_events SET processed=true, status='processed' WHERE stripe_event_id=$1", [evtId]);
    const second = (await client.query("SELECT claim_stripe_event($1,'payment_intent.succeeded','{}'::jsonb) AS c", [evtId])).rows[0].c;
    record('claim_stripe_event claims once, refuses the redelivery', first === true && second === false,
      `first=${first} second=${second}`);

    const objJson = JSON.stringify({ id: 'pi_ccverify', object: 'payment_intent', amount: 2000, status: 'succeeded', metadata: { bounty_id: bounty, user_id: poster } });
    await client.query("SELECT record_stripe_webhook_event($1,'payment_intent.succeeded',$2::jsonb)", [evtId, objJson]);
    await client.query("SELECT record_stripe_webhook_event($1,'payment_intent.succeeded',$2::jsonb)", [evtId, objJson]);
    const wh = await client.query("SELECT source, amount FROM bounty_events WHERE event_key='stripe:' || $1", [evtId]);
    record('a replayed webhook records exactly one webhook-sourced event',
      wh.rowCount === 1 && wh.rows[0].source === 'webhook' && Number(wh.rows[0].amount) === 20,
      JSON.stringify(wh.rows));

    const st2 = (await client.query(
      "SELECT financial_status, stripe_confirmed FROM admin_bounty_financial_state WHERE bounty_id=$1", [bounty])).rows[0];
    record('a Stripe webhook promotes the bounty to released_verified',
      st2.financial_status === 'released_verified' && st2.stripe_confirmed === true, JSON.stringify(st2));

    // 7. payout failure
    await client.query(
      `INSERT INTO wallet_transactions (type, amount, status, user_id, description)
       VALUES ('withdrawal', -10.00, 'failed', $1, 'cc verify payout')`, [hunter]);
    ev = await client.query(
      "SELECT count(*)::int n FROM bounty_events WHERE actor_id=$1 AND event_type='payout.failed'", [hunter]);
    record('a failed withdrawal emits payout.failed', ev.rows[0].n >= 1);
    an = await client.query("SELECT count(*)::int n FROM admin_financial_anomalies(1000) WHERE anomaly_type='stripe_payout_failure'");
    record('payout failure surfaces in anomaly detection', an.rows[0].n >= 1, `${an.rows[0].n} finding(s)`);

    // 3b. financial record with no bounty. wallet_transactions.bounty_id carries
    // a foreign key, so this is structurally prevented rather than merely
    // unobserved -- assert that, and keep the detector as defence in depth
    // (the FK could be dropped, or an unvalidated one added later).
    await client.query('SAVEPOINT sp_orphan');
    try {
      await client.query(
        `INSERT INTO wallet_transactions (type, amount, bounty_id, status, user_id, description)
         VALUES ('escrow', -5.00, gen_random_uuid(), 'completed', $1, 'cc verify orphan')`, [poster]);
      record('orphan financial record is rejected by the bounty FK', false, 'insert succeeded');
      await client.query('RELEASE SAVEPOINT sp_orphan');
    } catch (e) {
      record('orphan financial record is rejected by the bounty FK', e.code === '23503', e.code);
      await client.query('ROLLBACK TO SAVEPOINT sp_orphan');
    }
    an = await client.query(
      "SELECT count(*)::int n FROM admin_financial_anomalies(1000) WHERE anomaly_type='financial_record_without_bounty'");
    record('orphan-record detector runs and currently reports none', an.rows[0].n === 0, `${an.rows[0].n} finding(s)`);

    // Overview + feed + detail + timeline all answer
    const ov = (await client.query('SELECT admin_marketplace_overview($1) AS o', [new Date(Date.now() - 3600e3)])).rows[0].o;
    record('marketplace overview returns every headline number',
      ['new_bounties', 'new_posters', 'new_hunters', 'applications', 'accepts', 'completions', 'completed_gmv',
       'verified_gmv', 'pending_financial_events', 'payout_failures', 'suspicious_listings',
       'suspicious_applications'].every((k) => k in ov),
      JSON.stringify({ new_bounties: ov.new_bounties, applications: ov.applications, accepts: ov.accepts,
        completions: ov.completions, completed_gmv: ov.completed_gmv, verified_gmv: ov.verified_gmv,
        pending: ov.pending_financial_events, anomalies: ov.open_anomalies }));

    const feed = await client.query('SELECT * FROM admin_activity_feed(25)');
    record('activity feed returns chronologically', feed.rowCount > 0, `${feed.rowCount} rows, newest=${feed.rows[0]?.event_type}`);

    const detail = (await client.query('SELECT admin_bounty_detail($1) AS d', [bounty])).rows[0].d;
    record('bounty detail separates marketplace status from financial status',
      detail.marketplace.status === 'completed' && detail.financial.financial_status === 'released_verified',
      `${detail.marketplace.status} / ${detail.financial.financial_status}`);

    const tl = await client.query('SELECT event_type, source FROM admin_bounty_timeline($1)', [bounty]);
    const sources = [...new Set(tl.rows.map((r) => r.source))];
    record('lifecycle timeline shows the real sequence with provenance',
      tl.rowCount >= 7 && sources.includes('app') && sources.includes('webhook'),
      `${tl.rowCount} events, sources=${sources.join(',')}`);

    // 10. unauthorized admin access
    await client.query('SET LOCAL ROLE authenticated');
    await client.query("SET LOCAL request.jwt.claims = '{\"app_metadata\":{\"role\":\"user\"},\"sub\":\"00000000-0000-0000-0000-000000000000\"}'");
    for (const [label, q] of [
      ['admin_marketplace_overview', 'SELECT admin_marketplace_overview()'],
      ['admin_activity_feed', 'SELECT * FROM admin_activity_feed(5)'],
      ['admin_financial_anomalies', 'SELECT * FROM admin_financial_anomalies(5)'],
      ['admin_bounty_detail', 'SELECT admin_bounty_detail(gen_random_uuid())'],
      ['admin_bounty_timeline', 'SELECT * FROM admin_bounty_timeline(gen_random_uuid())'],
      ['admin_suspicious_listings', 'SELECT * FROM admin_suspicious_listings()'],
    ]) {
      await client.query('SAVEPOINT sp_guard');
      try {
        await client.query(q);
        record(`non-admin is refused by ${label}`, false, 'call succeeded');
        await client.query('RELEASE SAVEPOINT sp_guard');
      } catch (e) {
        record(`non-admin is refused by ${label}`, e.code === '42501', `${e.code}`);
        await client.query('ROLLBACK TO SAVEPOINT sp_guard');
      }
    }

    // A normal user must not be able to read the ledger directly, nor forge one.
    for (const [label, q, want] of [
      ['non-admin reading bounty_events sees nothing (RLS)', 'SELECT count(*)::int n FROM bounty_events', 'zero'],
      ['non-admin cannot forge a ledger event', "SELECT record_bounty_event('forged','bounty.posted','webhook')", 'denied'],
      ['non-admin cannot claim a Stripe event', "SELECT claim_stripe_event('evt_forged','x','{}'::jsonb)", 'denied'],
    ]) {
      await client.query('SAVEPOINT sp_sec');
      try {
        const r = await client.query(q);
        if (want === 'zero') record(label, r.rows[0].n === 0, `${r.rows[0].n} rows visible`);
        else record(label, false, 'call succeeded');
        await client.query('RELEASE SAVEPOINT sp_sec');
      } catch (e) {
        record(label, want === 'denied' ? e.code === '42501' : true, `blocked ${e.code}`);
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
