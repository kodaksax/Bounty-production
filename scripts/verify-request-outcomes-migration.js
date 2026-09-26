/* scripts/verify-request-outcomes-migration.js
 *
 * Applies supabase/migrations/20260925220000_request_outcomes_and_absent_poster_sweep.sql
 * and its follow-up 20260925230000_request_outcomes_review_fixes.sql, in order,
 * inside ONE transaction against the real production schema and data, runs the
 * dry-run reports plus functional checks of the real write paths, and ALWAYS
 * rolls back. Nothing persists: the migration's own BEGIN/COMMIT are stripped
 * so they cannot end the outer transaction early, and every side effect the
 * write paths trigger (notifications_outbox -> Push_noti_manager webhook via
 * pg_net, realtime broadcast) is queued transactionally and discarded with it.
 *
 * Usage:
 *   node scripts/verify-request-outcomes-migration.js
 *
 * Reads DATABASE_URL from .env.production (see verify-command-center-migration.js
 * for why it goes through the pooler). Exits non-zero if any check fails.
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const ROOT = path.resolve(__dirname, '..');
const MIGRATIONS = [
  '20260925220000_request_outcomes_and_absent_poster_sweep.sql',
  '20260925230000_request_outcomes_review_fixes.sql',
].map((f) => path.join(ROOT, 'supabase/migrations', f));

// Objects these migrations create or replace. Snapshotted before the run and
// compared after ROLLBACK, so the check holds whether or not production
// already has them (20260925220000 is live; the follow-up may not be).
const SNAPSHOT_SQL = `
  SELECT pg_get_functiondef(to_regprocedure('public.fn_sweep_absent_posters(boolean,integer)')) AS sweep,
         pg_get_functiondef(to_regprocedure('public.fn_expire_bounty_requests(boolean)'))       AS expire,
         pg_get_functiondef(to_regprocedure('public.fn_bounty_may_hold_funds(uuid)'))            AS funds,
         to_regclass('public.absent_poster_sweep_runs')::text                                    AS runs_table`;

function dbUrls() {
  const env = fs.readFileSync(path.join(ROOT, '.env.production'), 'utf8');
  const m = env.match(/^\s*DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m);
  if (!m) throw new Error('DATABASE_URL not found in .env.production');
  const u = new URL(m[1].trim());
  const ref = u.hostname.replace(/^db\./, '').replace(/\.supabase\.co$/, '');
  const hosts = process.env.PG_POOLER_HOST
    ? [process.env.PG_POOLER_HOST]
    : ['aws-1-us-east-2.pooler.supabase.com', 'aws-0-us-east-2.pooler.supabase.com'];
  return hosts.map((host) => `postgresql://postgres.${ref}:${u.password}@${host}:5432${u.pathname}`);
}

async function connect() {
  let lastError;
  for (const connectionString of dbUrls()) {
    const c = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
    try {
      await c.connect();
      return c;
    } catch (err) {
      lastError = err;
      await c.end().catch(() => {});
    }
  }
  throw lastError;
}

const results = [];
function record(name, ok, info) {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  -- ' + info : ''}`);
}

async function main() {
  const client = await connect();
  const baseline = (await client.query(SNAPSHOT_SQL)).rows[0];
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL statement_timeout = '300s'");

    for (const file of MIGRATIONS) {
      const sql = fs
        .readFileSync(file, 'utf8')
        .replace(/^BEGIN;\s*$/m, '')
        .replace(/^COMMIT;\s*$/m, '');
      await client.query(sql);
      record(`${path.basename(file)} applies cleanly`, true);
    }

    const sp = (await client.query(
      `SELECT p.proname, p.proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.prosecdef
         AND p.proname IN ('fn_expire_bounty_requests', 'fn_sweep_absent_posters',
                           'ops_relabel_system_application_events', 'trg_bounty_events_from_requests')`
    )).rows;
    record('every SECURITY DEFINER function here pins search_path to public, pg_temp',
      sp.length === 4 && sp.every((f) => (f.proconfig || []).includes('search_path=public, pg_temp')),
      JSON.stringify(sp.map((f) => [f.proname, f.proconfig])));

    // ── Reports (dry-run; these are the numbers to review before go) ──────
    const exp = await client.query(
      `SELECT count(*)::int n, count(*) FILTER (WHERE poster_interacted)::int interacted
       FROM fn_expire_bounty_requests(true)`
    );
    console.log('\nREPORT expiry dry-run (would close now):', exp.rows[0]);

    // #864: bounties that already have a worker are not expiry's to close,
    // in the preview as much as in the real run.
    const assignedInDryRun = (await client.query(
      `SELECT count(*)::int n FROM fn_expire_bounty_requests(true) e JOIN bounties b ON b.id = e.bounty_id
       WHERE b.accepted_by IS NOT NULL OR b.accepted_request_id IS NOT NULL`
    )).rows[0].n;
    record('expiry dry-run excludes bounties that already have a worker', assignedInDryRun === 0, `${assignedInDryRun} rows`);

    // v3 funding counts as funds for the sweep, whatever its state.
    const v3 = (await client.query(
      `SELECT count(*)::int n, count(*) FILTER (WHERE NOT fn_bounty_may_hold_funds(bounty_id))::int missed
       FROM bounty_v3_funding`
    )).rows[0];
    record('every bounty with a v3 funding row counts as possibly funded', v3.missed === 0, `${v3.missed}/${v3.n} missed`);

    const wm = (await client.query('SELECT request_lifecycle_enabled_at wm FROM posting_policy_config WHERE id')).rows[0].wm;
    for (const days of [14, 30]) {
      const sw = await client.query(
        `SELECT left(poster_id::text, 8) poster, poster_is_internal internal,
                poster_last_active_at::date last_active, bounty_action,
                count(DISTINCT bounty_id)::int bounties, count(*)::int requests,
                count(*) FILTER (WHERE request_created_at < $1)::int pre_watermark
         FROM fn_sweep_absent_posters(true, $2)
         GROUP BY 1, 2, 3, 4 ORDER BY requests DESC`,
        [wm, days]
      );
      console.log(`\nREPORT absent-poster sweep dry-run, N=${days} days:`);
      console.table(sw.rows);
    }

    const rel = await client.query('SELECT * FROM ops_relabel_system_application_events(true, false)');
    console.log('\nREPORT ledger relabel dry-run:');
    console.table(rel.rows);

    const oc = await client.query(
      `SELECT outcome, outcome_by, count(*)::int n FROM bounty_request_outcomes GROUP BY 1, 2 ORDER BY 3 DESC`
    );
    console.log('\nREPORT bounty_request_outcomes distribution:');
    console.table(oc.rows);

    // ── Functional checks of the real write paths (rolled back) ───────────
    const beforeRejected = (await client.query(
      `SELECT count(*)::int n FROM bounty_events WHERE event_type = 'application.rejected'`
    )).rows[0].n;

    // Expiry: age one real pending, post-watermark, non-interacted request past
    // the window and run the real function.
    const target = (await client.query(
      `SELECT br.id FROM bounty_requests br JOIN bounties b ON b.id = br.bounty_id
       WHERE br.status = 'pending' AND b.status = 'open' AND br.hunter_id IS NOT NULL
         AND br.poster_interacted_at IS NULL AND br.created_at >= $1
       ORDER BY br.created_at LIMIT 1`, [wm]
    )).rows[0];
    if (target) {
      await client.query(`UPDATE bounty_requests SET created_at = now() - interval '100 hours' WHERE id = $1`, [target.id]);
      const ran = await client.query('SELECT * FROM fn_expire_bounty_requests(false)');
      const row = (await client.query('SELECT status::text, rejection_source, rejected_at FROM bounty_requests WHERE id = $1', [target.id])).rows[0];
      record('expiry closes an overdue row as system_expiry', ran.rows.some((r) => r.request_id === target.id)
        && row.status === 'rejected' && row.rejection_source === 'system_expiry' && row.rejected_at !== null);
      const ev = (await client.query(
        `SELECT event_type, actor_id, source, metadata->>'rejection_source' src FROM bounty_events WHERE metadata->>'request_id' = $1 AND event_type <> 'application.submitted'`,
        [target.id]
      )).rows;
      record('ledger records expiry as application.closed with no actor',
        ev.length === 1 && ev[0].event_type === 'application.closed' && ev[0].actor_id === null && ev[0].src === 'system_expiry',
        JSON.stringify(ev));
      const ob = (await client.query(
        `SELECT data FROM notifications_outbox WHERE data->>'requestId' = $1 AND data->>'type' = 'application_expired'`, [target.id]
      )).rows;
      record('hunter notice enqueued with requestId + reason=no_response', ob.length === 1 && ob[0].data.reason === 'no_response');
      const body = (await client.query(
        `SELECT body FROM notifications_outbox WHERE data->>'requestId' = $1 AND data->>'type' = 'application_expired'`, [target.id]
      )).rows[0]?.body ?? '';
      record('expiry notice says no decision, not no response',
        body.includes("didn't make a decision in time") && !body.includes('respond'), body);
    } else {
      record('expiry functional check (no eligible pending row to age)', true, 'skipped');
    }

    // Write path: a pending row on an open bounty that already has a worker
    // is left alone even when it is past its window.
    const assigned = (await client.query(
      `SELECT br.id FROM bounty_requests br JOIN bounties b ON b.id = br.bounty_id
       WHERE br.status = 'pending' AND b.status = 'open' AND br.hunter_id IS NOT NULL
         AND (b.accepted_by IS NOT NULL OR b.accepted_request_id IS NOT NULL) LIMIT 1`
    )).rows[0];
    if (assigned) {
      await client.query(
        `UPDATE bounty_requests SET created_at = now() - interval '100 hours', poster_interacted_at = NULL WHERE id = $1`,
        [assigned.id]
      );
      await client.query('SELECT * FROM fn_expire_bounty_requests(false)');
      const kept = (await client.query('SELECT status::text FROM bounty_requests WHERE id = $1', [assigned.id])).rows[0];
      record('expiry leaves requests on an assigned open bounty pending', kept.status === 'pending');
    } else {
      record('assigned-bounty expiry check (no pending row on an assigned open bounty)', true, 'skipped');
    }

    // Interacted rows: no longer immune, but only after their own window.
    const inter = (await client.query(
      `SELECT br.id FROM bounty_requests br JOIN bounties b ON b.id = br.bounty_id
       WHERE br.status = 'pending' AND b.status = 'open' AND br.hunter_id IS NOT NULL
         AND br.poster_interacted_at IS NOT NULL AND br.created_at >= $1 LIMIT 1`, [wm]
    )).rows[0];
    if (inter) {
      await client.query(`UPDATE bounty_requests SET created_at = now() - interval '100 hours', poster_interacted_at = now() - interval '24 hours' WHERE id = $1`, [inter.id]);
      await client.query('SELECT * FROM fn_expire_bounty_requests(false)');
      const still = (await client.query('SELECT status::text FROM bounty_requests WHERE id = $1', [inter.id])).rows[0];
      record('interacted row inside its 168h window is NOT expired', still.status === 'pending');
      await client.query(`UPDATE bounty_requests SET poster_interacted_at = now() - interval '200 hours' WHERE id = $1`, [inter.id]);
      await client.query('SELECT * FROM fn_expire_bounty_requests(false)');
      const gone = (await client.query('SELECT status::text, rejection_source FROM bounty_requests WHERE id = $1', [inter.id])).rows[0];
      record('interacted row past its window IS expired', gone.status === 'rejected' && gone.rejection_source === 'system_expiry');
    }

    // Poster decision still labelled as a rejection by the poster.
    const decide = (await client.query(
      `SELECT br.id, br.poster_id FROM bounty_requests br JOIN bounties b ON b.id = br.bounty_id
       WHERE br.status = 'pending' AND b.status = 'open' AND br.hunter_id IS NOT NULL LIMIT 1`
    )).rows[0];
    if (decide) {
      await client.query(`UPDATE bounty_requests SET status = 'rejected' WHERE id = $1`, [decide.id]);
      const ev = (await client.query(
        `SELECT event_type, actor_id FROM bounty_events WHERE metadata->>'request_id' = $1 AND event_type LIKE 'application.re%'`, [decide.id]
      )).rows;
      record('poster decline stays application.rejected with poster actor',
        ev.length === 1 && ev[0].event_type === 'application.rejected' && ev[0].actor_id === decide.poster_id);
    }

    // Sweep real path at N=14.
    const swept = await client.query('SELECT * FROM fn_sweep_absent_posters(false, 14)');
    if (swept.rows.length > 0) {
      const ids = swept.rows.map((r) => r.request_id);
      const srcs = (await client.query(
        `SELECT rejection_source, count(*)::int n FROM bounty_requests WHERE id = ANY($1) GROUP BY 1`, [ids]
      )).rows;
      record('sweep labels every closed request system_poster_absent (not system_bounty_closed)',
        srcs.length === 1 && srcs[0].rejection_source === 'system_poster_absent', JSON.stringify(srcs));
      const archivedIds = [...new Set(swept.rows.filter((r) => r.bounty_action === 'archived').map((r) => r.bounty_id))];
      const flaggedIds = [...new Set(swept.rows.filter((r) => r.bounty_action === 'flagged_funded').map((r) => r.bounty_id))];
      const bs = (await client.query(
        `SELECT id, status::text, is_stale, stale_reason FROM bounties WHERE id = ANY($1)`, [[...archivedIds, ...flaggedIds]]
      )).rows;
      record('unfunded bounties archived + flagged, funded bounties keep their status',
        bs.every((b) => b.is_stale && b.stale_reason === 'poster_absent'
          && (archivedIds.includes(b.id) ? b.status === 'archived' : b.status === 'open')));
      const logRows = (await client.query(
        `SELECT count(*)::int n, sum(requests_closed)::int req FROM absent_poster_sweep_log WHERE sweep_id = $1`, [swept.rows[0].sweep_id]
      )).rows[0];
      record('sweep log has one row per bounty and matches request count',
        logRows.n === archivedIds.length + flaggedIds.length && logRows.req === ids.length);
      const notices = (await client.query(
        `SELECT count(*)::int n FROM notifications_outbox WHERE data->>'reason' = 'poster_absent' AND data->>'requestId' = ANY($1)`, [ids]
      )).rows[0].n;
      record('one poster_absent notice per closed request', notices === ids.length, `${notices}/${ids.length}`);
      // Each notice must name the hunter who owns the request it references,
      // and may only say the bounty closed when it was actually archived.
      const mismatched = (await client.query(
        `SELECT count(*)::int n FROM notifications_outbox o
         JOIN bounty_requests br ON br.id = (o.data->>'requestId')::uuid
         WHERE o.data->>'reason' = 'poster_absent' AND br.id = ANY($1)
           AND o.recipients <> jsonb_build_array(br.hunter_id)`, [ids]
      )).rows[0].n;
      record('every notice goes to the hunter of the request it names', mismatched === 0, `${mismatched} mismatched`);
      const wording = (await client.query(
        `SELECT (o.data->>'bountyClosed')::boolean closed_flag, b.status::text bstatus,
                o.body LIKE '%closed the bounty%' claims_closed, count(*)::int n
         FROM notifications_outbox o JOIN bounties b ON b.id = (o.data->>'bountyId')::uuid
         WHERE o.data->>'reason' = 'poster_absent' AND o.data->>'requestId' = ANY($1)
         GROUP BY 1, 2, 3`, [ids]
      )).rows;
      record('bountyClosed + copy match the bounty\'s real status',
        wording.every((w) => w.closed_flag === (w.bstatus === 'archived') && w.claims_closed === w.closed_flag),
        JSON.stringify(wording));
      const wrongLabel = (await client.query(
        `SELECT count(*)::int n FROM bounty_events WHERE event_type = 'application.rejected' AND metadata->>'request_id' = ANY($1)`, [ids]
      )).rows[0].n;
      record('no sweep closure is logged as application.rejected', wrongLabel === 0);
      const run = (await client.query(
        `SELECT finished_at, bounties_swept, requests_closed FROM absent_poster_sweep_runs WHERE sweep_id = $1`,
        [swept.rows[0].sweep_id]
      )).rows[0];
      record('sweep run row matches what the run closed',
        !!run && run.finished_at !== null && run.bounties_swept === archivedIds.length + flaggedIds.length
          && run.requests_closed === ids.length, JSON.stringify(run));
    }

    // A real run that closes nothing still leaves a run row. After the run
    // above, nothing at N=14 is left to close.
    const runsBefore = (await client.query('SELECT count(*)::int n FROM absent_poster_sweep_runs')).rows[0].n;
    const noop = await client.query('SELECT * FROM fn_sweep_absent_posters(false, 14)');
    const runsAfter = (await client.query(
      `SELECT count(*)::int n, count(*) FILTER (WHERE finished_at IS NOT NULL AND requests_closed = 0)::int empty
       FROM absent_poster_sweep_runs`
    )).rows[0];
    record('a no-op real sweep is still logged as a run',
      noop.rows.length === 0 && runsAfter.n === runsBefore + 1 && runsAfter.empty >= 1, JSON.stringify(runsAfter));

    // Relabel is reversible.
    await client.query('SELECT * FROM ops_relabel_system_application_events(false, false)');
    const leftover = (await client.query(
      `SELECT count(*)::int n FROM bounty_events e JOIN bounty_requests br ON br.id = (e.metadata->>'request_id')::uuid
       WHERE e.event_type = 'application.rejected' AND br.rejection_source LIKE 'system\\_%'`
    )).rows[0].n;
    record('relabel leaves zero system rows under application.rejected', leftover === 0);
    await client.query('SELECT * FROM ops_relabel_system_application_events(false, true)');
    const afterRevert = (await client.query(
      `SELECT count(*)::int n FROM bounty_events WHERE event_type = 'application.rejected'`
    )).rows[0].n;
    // +1 for the synthetic poster decline above; the relabel/revert pair must
    // otherwise land exactly where it started.
    record('relabel revert restores the original ledger rows', afterRevert === beforeRejected + (decide ? 1 : 0),
      `${afterRevert} vs ${beforeRejected}`);
  } catch (err) {
    record('verification run', false, err.message);
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    const after = (await client.query(SNAPSHOT_SQL)).rows[0];
    const changed = Object.keys(baseline).filter((k) => baseline[k] !== after[k]);
    record('rollback honoured (every touched object matches its pre-run state)', changed.length === 0,
      changed.length ? `changed: ${changed.join(', ')}` : '');
    await client.end();
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
