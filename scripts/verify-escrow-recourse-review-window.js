/* scripts/verify-escrow-recourse-review-window.js
 *
 * DB-level test suite for the trust-spine escrow / recourse / review-window work:
 *   supabase/migrations/20261002120000_assignment_and_submission_integrity.sql
 *   supabase/migrations/20261002120100_review_window_and_recourse_queue.sql
 * on top of the already-shipped escrow gate (20261001120100 + 20261001130000).
 *
 * Applies the migrations inside ONE transaction on staging, builds fixtures,
 * exercises the real triggers / RPCs / RLS as the PostgREST roles, and ALWAYS
 * rolls back. Nothing persists. Every scenario runs in its own savepoint.
 *
 * Usage:
 *   node scripts/verify-escrow-recourse-review-window.js          # staging
 *
 * Refuses production. Exits non-zero if any check fails.
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const ROOT = path.resolve(__dirname, '..');
const MIG = (f) => path.join(ROOT, 'supabase/migrations', f);
const DOWN = (f) => path.join(ROOT, 'supabase/rollbacks/production', f);
const PRECONDITION = MIG('20261001130000_trust_spine_review_fixes.sql');
const M1 = MIG('20261002120000_assignment_and_submission_integrity.sql');
const M2 = MIG('20261002120100_review_window_and_recourse_queue.sql');
const D1 = DOWN('20261002120000_assignment_and_submission_integrity.down.sql');
const D2 = DOWN('20261002120100_review_window_and_recourse_queue.down.sql');

const ENV = (process.argv.find((a) => a.startsWith('--env=')) || '--env=staging').slice(6);
if (ENV !== 'staging') {
  console.error('This suite only runs against staging (it applies DDL inside a transaction).');
  process.exit(2);
}

function candidateUrls() {
  const env = fs.readFileSync(path.join(ROOT, `.env.${ENV}`), 'utf8');
  const m = env.match(/^\s*DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m);
  if (!m) throw new Error(`DATABASE_URL not found in .env.${ENV}`);
  const raw = m[1].trim();
  const u = new URL(raw);
  if (!u.hostname.includes('gwumwpoomwvkjyibdmpj')) throw new Error('REFUSING: .env.staging does not point at staging');
  const urls = [raw];
  const ref = u.hostname.match(/^db\.([a-z0-9]+)\.supabase\.co$/)?.[1];
  if (ref) {
    for (const host of ['aws-1-us-east-2.pooler.supabase.com', 'aws-0-us-east-2.pooler.supabase.com']) {
      urls.push(`postgresql://postgres.${ref}:${encodeURIComponent(decodeURIComponent(u.password))}@${host}:5432${u.pathname}`);
    }
  }
  return urls;
}

async function connect() {
  let lastError;
  for (const connectionString of candidateUrls()) {
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

// A migration file's own BEGIN/COMMIT would end the test transaction.
function txBody(file) {
  const sql = fs.readFileSync(file, 'utf8')
    .replace(/^\s*BEGIN;\s*$/m, '')
    .replace(/^\s*COMMIT;\s*$/m, '');
  if (/^\s*(BEGIN|COMMIT|ROLLBACK);\s*$/m.test(sql)) throw new Error(`${file}: stray transaction statement`);
  return sql;
}

// Subtypes this work adds to notifications_outbox.data.
const NEW_SUBTYPES = ['review_reminder', 'review_escalated'];

const results = [];
function check(name, ok, info) {
  results.push({ name, ok: !!ok, info });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info !== undefined ? '  -- ' + (typeof info === 'string' ? info : JSON.stringify(info)) : ''}`);
}

async function main() {
  const c = await connect();
  const warnings = new Set();
  c.on('notice', (n) => { if (n.severity === 'WARNING' && /review|trust_review|enqueue/.test(n.message)) warnings.add(n.message); });
  const q = async (sql, params) => (await c.query(sql, params)).rows;
  const one = async (sql, params) => (await q(sql, params))[0];
  let sp = 0;
  // Statement in its own savepoint: {ok, rows, rowCount, err}
  const tryq = async (sql, params) => {
    const name = `t${++sp}`;
    await c.query(`SAVEPOINT ${name}`);
    try {
      const r = await c.query(sql, params);
      await c.query(`RELEASE SAVEPOINT ${name}`);
      return { ok: true, rows: r.rows, rowCount: r.rowCount };
    } catch (e) {
      await c.query(`ROLLBACK TO SAVEPOINT ${name}`);
      return { ok: false, err: e.message, code: e.code };
    }
  };
  const as = async (who, fn) => {
    const claims = { sub: who.id, role: 'authenticated', app_metadata: who.admin ? { role: 'admin' } : {} };
    await c.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
    await c.query('SET LOCAL ROLE authenticated');
    try { return await fn(); } finally {
      await c.query('RESET ROLE').catch(() => {});
      await c.query(`SELECT set_config('request.jwt.claims', '', true)`).catch(() => {});
    }
  };
  const scenario = async (name, fn) => {
    console.log(`\n── ${name}`);
    await c.query('SAVEPOINT scenario');
    try {
      await fn();
    } catch (e) {
      check(`${name}: harness error`, false, e.message + (e.where ? ' @ ' + e.where : ''));
    } finally {
      await c.query('ROLLBACK TO SAVEPOINT scenario');
    }
  };

  // Users: poster P, hunter H, second applicant H2, stranger A, admin D.
  let U;
  const fixture = async ({ accept = true, submit = false, amount = 20, message = 'done, photos attached' } = {}) => {
    const [b] = await as(U.P, () => q(
      `INSERT INTO bounties (title, description, amount, is_for_honor, poster_id, user_id, status, work_type)
       VALUES ('REVIEW-WINDOW TEST', 'harness fixture', $1, $2, $3, $3, 'open', 'online') RETURNING id`,
      [amount, amount === 0, U.P.id]));
    const B = b.id;
    const [r1] = await as(U.H, () => q(
      `INSERT INTO bounty_requests (bounty_id, hunter_id, poster_id, status) VALUES ($1, $2, $3, 'pending') RETURNING id`,
      [B, U.H.id, U.P.id]));
    const [r2] = await as(U.H2, () => q(
      `INSERT INTO bounty_requests (bounty_id, hunter_id, poster_id, status) VALUES ($1, $2, $3, 'pending') RETURNING id`,
      [B, U.H2.id, U.P.id]));
    if (accept) await as(U.P, () => q(`SELECT * FROM fn_accept_bounty_request($1)`, [String(r1.id)]));
    let S = null;
    if (submit) {
      const [s] = await as(U.H, () => q(
        `INSERT INTO completion_submissions (bounty_id, hunter_id, message, proof_items, status)
         VALUES ($1, $2, $3, '[]'::jsonb, 'pending') RETURNING id`, [B, U.H.id, message]));
      S = s.id;
    }
    return { B, R1: r1.id, R2: r2.id, S };
  };
  // Move a submission's clock (as the migration owner, like the server would).
  const age = (S, hours) => q(
    `UPDATE completion_submissions SET submitted_at = now() - make_interval(hours => $2) WHERE id = $1`, [S, hours]);
  const setRollout = (hoursAgo) => q(
    `UPDATE completion_review_policy SET rollout_at = now() - make_interval(hours => $1)`, [hoursAgo]);
  const runCron = async () => (await one(`SELECT public.fn_process_completion_review_window() r`)).r;
  const outbox = (B) => q(
    `SELECT recipients, title, body, data FROM notifications_outbox
      WHERE (bounty_id = $1::text OR data::text LIKE '%' || $1::text || '%') AND created_at >= now()
      ORDER BY created_at, id`, [B]);
  const subtypes = (rows, who) => rows
    .filter((r) => !who || (Array.isArray(r.recipients) && r.recipients.includes(who.id)))
    .map((r) => r.data.subtype ?? r.data.type);
  const sub = (S) => one(`SELECT * FROM completion_submissions WHERE id = $1`, [S]);
  const queueFor = (B) => q(`SELECT * FROM trust_review_queue WHERE bounty_id = $1 ORDER BY opened_at`, [B]);

  try {
    await c.query('BEGIN');
    await c.query("SET LOCAL statement_timeout = '600s'");

    // ── fixtures ────────────────────────────────────────────────────────────
    const users = await q(`SELECT id FROM profiles WHERE account_status = 'active' ORDER BY created_at LIMIT 5`);
    if (users.length < 5) throw new Error('need 5 active staging profiles');
    U = { P: { id: users[0].id }, H: { id: users[1].id }, H2: { id: users[2].id }, A: { id: users[3].id }, D: { id: users[4].id, admin: true } };
    await q(`SELECT set_config('app.bypass_profile_guard', 'on', true)`);
    await q(`UPDATE profiles SET balance = 500, account_status = 'active' WHERE id = ANY($1)`, [Object.values(U).map((u) => u.id)]);

    // ── apply ───────────────────────────────────────────────────────────────
    const pre = await one(`SELECT position('bounty_resume_blocked_escrow_refunded' IN pg_get_functiondef('public.fn_bounties_guard_lifecycle'::regproc)) > 0 AS applied`);
    if (!pre.applied) await c.query(txBody(PRECONDITION));
    check('precondition 20261001130000 present (applied in-txn if staging lacks it)', true, { alreadyApplied: pre.applied });
    await c.query(txBody(M1));
    check('20261002120000 applies cleanly', true);
    await c.query(txBody(M2));
    check('20261002120100 applies cleanly', true);
    const job = await one(`SELECT schedule, command FROM cron.job WHERE jobname = 'completion-review-window'`);
    check('cron job scheduled with heartbeat', job && /record_job_heartbeat\('completion-review-window'\)/.test(job.command), job);

    // Baseline on real staging rows: the first run must not notify anyone
    // about thresholds that passed before rollout.
    const baselineBefore = await one(`SELECT count(*)::int n FROM notifications_outbox WHERE created_at >= now() AND data->>'subtype' IN ('review_reminder','review_escalated')`);
    const baseline = await runCron();
    const baselineAfter = await one(`SELECT count(*)::int n FROM notifications_outbox WHERE created_at >= now() AND data->>'subtype' IN ('review_reminder','review_escalated')`);
    check('rollout run: no user notifications for pre-rollout thresholds', baselineAfter.n === baselineBefore.n, baseline);

    // ── 1. Refund attempt after acceptance ──────────────────────────────────
    await scenario('refund gate by state', async () => {
      const f0 = await fixture({ accept: false });
      const g0 = await one(`SELECT fn_owner_refund_block_reason($1, $2) r`, [f0.B, U.P.id]);
      check('owner refund allowed before acceptance', g0.r === null, g0.r);
      const f = await fixture({ submit: false });
      const g1 = await one(`SELECT fn_owner_refund_block_reason($1, $2) r`, [f.B, U.P.id]);
      check('owner refund blocked after acceptance', g1.r === 'refund_requires_cancellation_or_dispute', g1.r);
      await as(U.H, () => q(`INSERT INTO completion_submissions (bounty_id, hunter_id, message, status) VALUES ($1, $2, 'x', 'pending')`, [f.B, U.H.id]));
      const g2 = await one(`SELECT fn_owner_refund_block_reason($1, $2) r`, [f.B, U.P.id]);
      check('owner refund blocked after submission', g2.r === 'refund_requires_cancellation_or_dispute', g2.r);
      const g3 = await one(`SELECT fn_owner_refund_block_reason($1, $2) r`, [f.B, U.A.id]);
      check('stranger refund blocked', g3.r === 'not_bounty_owner', g3.r);
      const rpc = await as(U.P, () => tryq(`SELECT fn_owner_refund_block_reason($1, $2)`, [f.B, U.P.id]));
      check('refund gate not callable by clients (edge functions only)', !rpc.ok, rpc.err);
    });

    // ── 2. Direct database mutation attempts ────────────────────────────────
    await scenario('direct mutation: bounties (shipped guard still holds)', async () => {
      const f = await fixture({ submit: true });
      for (const [label, sql, params] of [
        ['reassign accepted_by', `UPDATE bounties SET accepted_by = $2 WHERE id = $1`, [f.B, U.H2.id]],
        ['clear accepted_by + reopen', `UPDATE bounties SET accepted_by = NULL, status = 'open' WHERE id = $1`, [f.B]],
        ['cancel committed bounty', `UPDATE bounties SET status = 'cancelled' WHERE id = $1`, [f.B]],
        ['forge cancellation_requested', `UPDATE bounties SET status = 'cancellation_requested' WHERE id = $1`, [f.B]],
        ['soft-delete committed bounty', `UPDATE bounties SET status = 'deleted' WHERE id = $1`, [f.B]],
        ['hard-delete committed bounty', `DELETE FROM bounties WHERE id = $1`, [f.B]],
        ['swap accepted_request_id', `UPDATE bounties SET accepted_request_id = $2 WHERE id = $1`, [f.B, f.R2]],
      ]) {
        const r = await as(U.P, () => tryq(sql, params));
        check(`BLOCKED poster: ${label}`, !r.ok || r.rowCount === 0, r.err || r.rowCount);
      }
      const [b] = await q(`SELECT accepted_by, status FROM bounties WHERE id = $1`, [f.B]);
      check('accepted hunter unchanged after all attempts', b.accepted_by === U.H.id && b.status === 'in_progress', b);
    });

    await scenario('direct mutation: bounty_requests (new guard)', async () => {
      const f = await fixture();
      for (const [label, sql, params] of [
        ['reject the accepted request', `UPDATE bounty_requests SET status = 'rejected' WHERE id = $1`, [f.R1]],
        ['promote another applicant to accepted', `UPDATE bounty_requests SET status = 'accepted' WHERE id = $1`, [f.R2]],
        ['rewrite hunter_id on the accepted request', `UPDATE bounty_requests SET hunter_id = $2 WHERE id = $1`, [f.R1, U.H2.id]],
        ['delete the accepted request', `DELETE FROM bounty_requests WHERE id = $1`, [f.R1]],
      ]) {
        const r = await as(U.P, () => tryq(sql, params));
        check(`BLOCKED poster: ${label}`, !r.ok || r.rowCount === 0, r.err || r.rowCount);
      }
      const [r1] = await q(`SELECT status, hunter_id FROM bounty_requests WHERE id = $1`, [f.R1]);
      check('accepted request intact', r1.status === 'accepted' && r1.hunter_id === U.H.id, r1);

      // Legit: rejecting a still-pending applicant on an OPEN bounty.
      const g = await fixture({ accept: false });
      const rej = await as(U.P, () => tryq(`UPDATE bounty_requests SET status = 'rejected' WHERE id = $1`, [g.R2]));
      check('LEGIT poster rejects a pending application', rej.ok && rej.rowCount === 1, rej.err || rej.rowCount);
      const acc = await as(U.P, () => tryq(`SELECT * FROM fn_accept_bounty_request($1)`, [String(g.R1)]));
      check('LEGIT acceptance through fn_accept_bounty_request', acc.ok, acc.err);
      const wd = await fixture({ accept: false });
      const del = await as(U.H2, () => tryq(`DELETE FROM bounty_requests WHERE id = $1`, [wd.R2]));
      check('LEGIT hunter withdraws own pending application', del.ok && del.rowCount === 1, del.err || del.rowCount);
    });

    await scenario('direct mutation: completion_submissions (new guard)', async () => {
      const f = await fixture();
      const stranger = await as(U.A, () => tryq(
        `INSERT INTO completion_submissions (bounty_id, hunter_id, message, status) VALUES ($1, $2, 'fake', 'pending')`, [f.B, U.A.id]));
      check('BLOCKED stranger submits work on someone else\'s bounty', !stranger.ok, stranger.err);
      const loser = await as(U.H2, () => tryq(
        `INSERT INTO completion_submissions (bounty_id, hunter_id, message, status) VALUES ($1, $2, 'fake', 'pending')`, [f.B, U.H2.id]));
      check('BLOCKED non-selected applicant submits work', !loser.ok, loser.err);
      const approvedIns = await as(U.H, () => tryq(
        `INSERT INTO completion_submissions (bounty_id, hunter_id, message, status) VALUES ($1, $2, 'x', 'approved')`, [f.B, U.H.id]));
      check('BLOCKED hunter inserts an already-approved submission', !approvedIns.ok, approvedIns.err);
      const ins = await as(U.H, () => tryq(
        `INSERT INTO completion_submissions (bounty_id, hunter_id, message, status, submitted_at, review_escalated_at)
         VALUES ($1, $2, 'done', 'pending', now() - interval '10 days', now()) RETURNING id, submitted_at, review_escalated_at`, [f.B, U.H.id]));
      check('LEGIT accepted hunter submits', ins.ok, ins.err);
      const S = ins.rows[0].id;
      const s0 = await sub(S);
      check('submitted_at is server-stamped (backdate ignored)', Math.abs(new Date(s0.submitted_at) - new Date((await one('SELECT now() n')).n)) < 1000, s0.submitted_at);
      check('escalation stamp cannot be forged on insert', s0.review_escalated_at === null, s0.review_escalated_at);
      const dup = await as(U.H, () => tryq(
        `INSERT INTO completion_submissions (bounty_id, hunter_id, message, status) VALUES ($1, $2, 'again', 'pending')`, [f.B, U.H.id]));
      check('BLOCKED second pending submission (one clock per bounty)', !dup.ok, dup.err);

      for (const [who, label, sql, params] of [
        ['H', 'hunter backdates submitted_at', `UPDATE completion_submissions SET submitted_at = now() - interval '5 days' WHERE id = $1`, [S]],
        ['H', 'hunter approves own work', `UPDATE completion_submissions SET status = 'approved' WHERE id = $1`, [S]],
        ['H', 'hunter writes reminder stamp', `UPDATE completion_submissions SET review_reminder_24h_sent_at = now() WHERE id = $1`, [S]],
        ['P', 'poster forward-dates submitted_at', `UPDATE completion_submissions SET submitted_at = now() + interval '5 days' WHERE id = $1`, [S]],
        ['P', 'poster rewrites hunter_id', `UPDATE completion_submissions SET hunter_id = $2 WHERE id = $1`, [S, U.H2.id]],
        ['P', 'poster suppresses escalation', `UPDATE completion_submissions SET review_escalated_at = now() WHERE id = $1`, [S]],
        ['P', 'poster edits the hunter\'s proof', `UPDATE completion_submissions SET message = 'nothing done' WHERE id = $1`, [S]],
        ['A', 'stranger touches submission', `UPDATE completion_submissions SET status = 'rejected' WHERE id = $1`, [S]],
      ]) {
        const r = await as(U[who], () => tryq(sql, params));
        check(`BLOCKED ${label}`, !r.ok || r.rowCount === 0, r.err || r.rowCount);
      }
      const edit = await as(U.H, () => tryq(`UPDATE completion_submissions SET message = 'done + receipt' WHERE id = $1`, [S]));
      check('LEGIT hunter edits message of pending submission', edit.ok && edit.rowCount === 1, edit.err || edit.rowCount);

      const qw = await as(U.P, () => tryq(`INSERT INTO trust_review_queue (kind, bounty_id) VALUES ('dispute', $1)`, [f.B]));
      check('BLOCKED client writes the support queue', !qw.ok, qw.err);
      const qr = await as(U.P, () => tryq(`SELECT count(*)::int n FROM trust_review_queue`));
      check('non-admin reads nothing from the support queue', qr.ok && qr.rows[0].n === 0, qr.err || qr.rows);
      const cr = await as(U.P, () => tryq(`SELECT fn_process_completion_review_window()`));
      check('BLOCKED client runs the review cron', !cr.ok, cr.err);
      const pol = await as(U.P, () => tryq(`UPDATE completion_review_policy SET window_hours = 336`));
      check('BLOCKED client changes the review window', !pol.ok || pol.rowCount === 0, pol.err || pol.rowCount);
      const adm = await as(U.P, () => tryq(`SELECT * FROM admin_trust_review_queue()`));
      check('BLOCKED non-admin reads queue RPC', !adm.ok, adm.err);
    });

    // ── 3. Poster approves (+ duplicate approval) ───────────────────────────
    await scenario('poster approves, then approves again', async () => {
      await setRollout(24 * 30);
      const f = await fixture({ submit: true });
      await age(f.S, 30);
      const before = await sub(f.S);
      const a1 = await as(U.P, () => tryq(
        `UPDATE completion_submissions SET status = 'approved', reviewed_at = '2001-01-01' WHERE id = $1`, [f.S]));
      const s1 = await sub(f.S);
      check('LEGIT poster approves pending submission', a1.ok && a1.rowCount === 1, a1.err || a1.rowCount);
      check('reviewed_at is server time, not the client value', new Date(s1.reviewed_at).getUTCFullYear() > 2001, s1.reviewed_at);
      const done = await as(U.P, () => tryq(`UPDATE bounties SET status = 'completed', completed_at = now() WHERE id = $1`, [f.B]));
      check('LEGIT poster completes bounty after approval', done.ok && done.rowCount === 1, done.err || done.rowCount);
      const a2 = await as(U.P, () => tryq(
        `UPDATE completion_submissions SET status = 'approved', reviewed_at = now() + interval '1 day' WHERE id = $1`, [f.S]));
      const s2 = await sub(f.S);
      check('duplicate approval is an idempotent no-op', a2.ok && s2.status === 'approved', a2.err || s2.status);
      check('duplicate approval keeps the original decision time', String(s2.reviewed_at) === String(s1.reviewed_at), { first: s1.reviewed_at, second: s2.reviewed_at });
      check('submitted_at untouched by review', String(s2.submitted_at) === String(before.submitted_at));
      const rr = await as(U.P, () => tryq(`UPDATE completion_submissions SET status = 'revision_requested' WHERE id = $1`, [f.S]));
      check('BLOCKED un-approving after approval', !rr.ok || rr.rowCount === 0, rr.err || rr.rowCount);
      await age(f.S, 100);
      await runCron();
      check('approved work never escalates', (await queueFor(f.B)).length === 0);
    });

    // ── 4. Poster requests revision ─────────────────────────────────────────
    await scenario('poster requests revision, hunter resubmits', async () => {
      await setRollout(24 * 30);
      const f = await fixture({ submit: true });
      await age(f.S, 30);
      const rv = await as(U.P, () => tryq(`UPDATE completion_submissions SET status = 'revision_requested', poster_feedback = 'more photos' WHERE id = $1`, [f.S]));
      check('LEGIT poster requests revision', rv.ok && rv.rowCount === 1, rv.err || rv.rowCount);
      const ob = await outbox(f.B);
      check('hunter notified of revision (existing trigger)', subtypes(ob, U.H).includes('revision_requested'), subtypes(ob));
      const hs = await as(U.H, () => tryq(`UPDATE completion_submissions SET status = 'pending' WHERE id = $1`, [f.S]));
      check('BLOCKED hunter flips the old row back to pending', !hs.ok || hs.rowCount === 0, hs.err || hs.rowCount);
      const re = await as(U.H, () => tryq(
        `INSERT INTO completion_submissions (bounty_id, hunter_id, message, status) VALUES ($1, $2, 'redone', 'pending') RETURNING id, revision_count`, [f.B, U.H.id]));
      check('LEGIT hunter resubmits as a new row', re.ok, re.err);
      check('revision_count is server-computed (=1)', re.ok && re.rows[0].revision_count === 1, re.rows?.[0]);
      const ob2 = await outbox(f.B);
      check('poster told it is a resubmission', ob2.some((r) => /resubmitted/.test(r.title)), ob2.map((r) => r.title));
      await runCron();
      check('fresh resubmission starts a new clock (nothing escalated)', (await queueFor(f.B)).length === 0);
      await age(f.S, 200);
      await age(re.rows[0].id, 73);
      await runCron();
      const items = await queueFor(f.B);
      check('only the latest submission runs a clock', items.length === 1 && items[0].submission_id === re.rows[0].id, items.map((i) => i.submission_id));
      check('shadow rule blocks auto-release after a revision request', items[0] && !items[0].auto_release_eligible && items[0].auto_release_blockers.includes('revision_requested_before'), items[0]?.auto_release_blockers);
      const late = await as(U.P, () => tryq(`UPDATE completion_submissions SET status = 'approved' WHERE id = $1`, [f.S]));
      check('LEGIT revision_requested -> approved (accept as-is)', late.ok && late.rowCount === 1, late.err || late.rowCount);
    });

    // ── 5. Poster disappears: 24h / 48h / 72h ───────────────────────────────
    await scenario('poster disappears after submission', async () => {
      await setRollout(24 * 30);
      const f = await fixture({ submit: true });
      await age(f.S, 23);
      let r = await runCron();
      check('23h: nothing sent', (await outbox(f.B)).filter((x) => NEW_SUBTYPES.includes(x.data.subtype)).length === 0, r);
      await age(f.S, 25);
      r = await runCron();
      let ob = await outbox(f.B);
      check('24h: poster reminded once', subtypes(ob, U.P).filter((s) => s === 'review_reminder').length === 1, r);
      check('24h: reminder names the remaining 48 hours', ob.some((x) => /within 48 hours/.test(x.body || '') || /48 hours/.test(JSON.stringify(x))), ob.map((x) => x.title));
      check('24h: reminder deep-links as review_needed', ob.some((x) => x.data.type === 'review_needed' && x.data.stage === 'first'));
      check('24h: hunter not notified', ob.filter((x) => NEW_SUBTYPES.includes(x.data.subtype) && x.recipients.includes(U.H.id)).length === 0);
      r = await runCron();
      check('24h: re-run is idempotent', subtypes(await outbox(f.B), U.P).filter((s) => s === 'review_reminder').length === 1, r);
      await age(f.S, 49);
      await runCron();
      ob = await outbox(f.B);
      check('48h: final reminder sent', ob.some((x) => x.data.subtype === 'review_reminder' && x.data.stage === 'final'), ob.map((x) => x.data.stage));
      await runCron();
      check('48h: re-run is idempotent', (await outbox(f.B)).filter((x) => x.data.stage === 'final').length === 1);
      await age(f.S, 73);
      r = await runCron();
      ob = await outbox(f.B);
      const items = await queueFor(f.B);
      const s = await sub(f.S);
      check('72h: one support queue item', items.length === 1 && items[0].kind === 'completion_review_overdue' && items[0].status === 'open', items);
      check('72h: submission stamped escalated', s.review_escalated_at !== null);
      check('72h: poster told support is reviewing', subtypes(ob, U.P).includes('review_escalated'));
      check('72h: hunter told support is following up', subtypes(ob, U.H).includes('review_escalated'));
      check('72h: internal admins paged', ob.some((x) => x.data.trust_review === true && x.data.type === 'reconciliation_alert'), ob.map((x) => x.title));
      const ev = await q(`SELECT event_type, source, metadata FROM bounty_events WHERE bounty_id = $1 AND event_type = 'completion_review_overdue'`, [f.B]);
      check('72h: bounty_events completion_review_overdue recorded', ev.length === 1 && ev[0].source === 'system', ev);
      check('72h: shadow rule says eligible (clean case)', items[0]?.auto_release_eligible === true, items[0]?.auto_release_blockers);
      check('72h: facts captured for triage', items[0]?.facts?.reminders_sent === 2 && items[0]?.facts?.legacy === false, items[0]?.facts);
      const st = await one(`SELECT status FROM completion_submissions WHERE id = $1`, [f.S]);
      const bt = await one(`SELECT status FROM bounties WHERE id = $1`, [f.B]);
      const wt = await one(`SELECT count(*)::int n FROM wallet_transactions WHERE bounty_id = $1 AND type::text IN ('release','refund')`, [f.B]);
      check('Phase A: nothing approved, released or refunded', st.status === 'pending' && bt.status === 'in_progress' && wt.n === 0, { st, bt, wt });
      await runCron();
      check('72h: re-run creates no duplicate item or event',
        (await queueFor(f.B)).length === 1 &&
        (await q(`SELECT 1 FROM bounty_events WHERE bounty_id = $1 AND event_type = 'completion_review_overdue'`, [f.B])).length === 1);
      // Admin works the item, then the poster finally approves.
      const ad = await as(U.D, () => tryq(`SELECT * FROM admin_trust_review_queue()`));
      check('admin sees the item via RPC', ad.ok && ad.rows.some((x) => x.id === items[0].id), ad.err);
      const ct = await as(U.D, () => tryq(`SELECT status FROM admin_update_trust_review_item($1, 'contacted', NULL, 'emailed poster')`, [items[0].id]));
      check('admin marks contacted', ct.ok && ct.rows[0].status === 'contacted', ct.err);
      const late = await as(U.P, () => tryq(`UPDATE completion_submissions SET status = 'approved' WHERE id = $1`, [f.S]));
      check('poster can still approve after escalation', late.ok && late.rowCount === 1, late.err);
      await runCron();
      const [closed] = await queueFor(f.B);
      check('queue item auto-closes as poster_approved', closed.status === 'resolved' && closed.resolution === 'poster_approved' && closed.resolution_source === 'system', closed);
      check('admin note survives auto-close', closed.notes === 'emailed poster');
    });

    await scenario('cron outage: late run sends one reminder, not two', async () => {
      await setRollout(24 * 30);
      const f = await fixture({ submit: true });
      await age(f.S, 60);
      await runCron();
      const ob = (await outbox(f.B)).filter((x) => x.data.subtype === 'review_reminder');
      const s = await sub(f.S);
      check('only the final reminder is sent', ob.length === 1 && ob[0].data.stage === 'final', ob.map((x) => x.data.stage));
      check('both reminder stamps set', s.review_reminder_24h_sent_at && s.review_reminder_48h_sent_at);
    });

    await scenario('rollout watermark: no retroactive burst', async () => {
      await setRollout(0);
      const f = await fixture({ submit: true });
      await age(f.S, 30);
      await runCron();
      check('24h threshold before rollout: stamped, not sent',
        (await outbox(f.B)).filter((x) => x.data.subtype === 'review_reminder').length === 0 && (await sub(f.S)).review_reminder_24h_sent_at);
      const g = await fixture({ submit: true });
      await age(g.S, 24 * 40);
      await runCron();
      const items = await queueFor(g.B);
      const ob = await outbox(g.B);
      check('long-overdue legacy submission queued for support', items.length === 1 && items[0].facts.legacy === true, items.map((i) => i.facts));
      check('legacy escalation notifies neither party', ob.filter((x) => NEW_SUBTYPES.includes(x.data.subtype) && !x.data.trust_review).length === 0, subtypes(ob));
      check('legacy escalation still pages support', ob.some((x) => x.data.trust_review === true && /pre-rollout/.test(x.body || JSON.stringify(x))));
    });

    // ── 6. Poster disputes ─────────────────────────────────────────────────
    await scenario('poster raises a problem after submission', async () => {
      await setRollout(24 * 30);
      const f = await fixture({ submit: true });
      await age(f.S, 73);
      await runCron();
      const d = await as(U.P, () => tryq(
        `INSERT INTO bounty_disputes (bounty_id, initiator_id, respondent_id, reason, reason_code, status, dispute_stage)
         VALUES ($1, $2, $3, 'Work quality does not meet requirements: no photos', 'work_quality', 'open', 'review_verify') RETURNING id`,
        [f.B, U.P.id, U.H.id]));
      check('LEGIT poster opens workflow dispute with reason_code', d.ok, d.err);
      await runCron();
      const items = await queueFor(f.B);
      const review = items.find((i) => i.kind === 'completion_review_overdue');
      const disp = items.find((i) => i.kind === 'dispute');
      check('dispute becomes its own support item', disp && disp.dispute_id === d.rows[0].id && disp.reason_code === 'work_quality', items.map((i) => [i.kind, i.reason_code]));
      check('overdue-review item closes as disputed', review && review.status === 'resolved' && review.resolution === 'disputed', review);
      const g = await one(`SELECT fn_owner_refund_block_reason($1, $2) r`, [f.B, U.P.id]);
      check('refund still blocked while dispute open', g.r === 'refund_blocked_by_open_dispute', g.r);
      const bad = await as(U.P, () => tryq(
        `INSERT INTO bounty_disputes (bounty_id, initiator_id, reason, reason_code, status) VALUES ($1, $2, 'x', 'made_up', 'open')`, [f.B, U.P.id]));
      check('BLOCKED unknown reason_code', !bad.ok, bad.err);
      const ad = await as(U.D, () => tryq(
        `UPDATE bounty_disputes SET status = 'resolved_hunter_wins', winner = 'hunter', resolved_by = $2, resolved_at = now() WHERE id = $1`, [d.rows[0].id, U.D.id]));
      check('admin resolves dispute (existing path)', ad.ok && ad.rowCount === 1, ad.err);
      await runCron();
      const d2 = (await queueFor(f.B)).find((i) => i.kind === 'dispute');
      check('dispute item auto-closes with the ruling', d2.status === 'resolved' && d2.resolution === 'dispute_resolved_hunter', d2);
    });

    // ── 7. Hunter disappears ───────────────────────────────────────────────
    await scenario('hunter disappears before submitting (poster recourse)', async () => {
      const f = await fixture();
      const cancel = await as(U.P, () => tryq(`UPDATE bounties SET status = 'cancelled' WHERE id = $1`, [f.B]));
      check('poster still cannot cancel directly', !cancel.ok || cancel.rowCount === 0, cancel.err);
      const d = await as(U.P, () => tryq(
        `INSERT INTO bounty_disputes (bounty_id, initiator_id, respondent_id, reason, reason_code, status, dispute_stage)
         VALUES ($1, $2, $3, 'Hunter hasn''t responded: no reply since Monday', 'hunter_unresponsive', 'open', 'in_progress') RETURNING id`,
        [f.B, U.P.id, U.H.id]));
      check('LEGIT poster files "Hunter hasn\'t responded" without a cancellation', d.ok, d.err);
      const items = await queueFor(f.B);
      check('support queue item created immediately', items.length === 1 && items[0].kind === 'dispute' && items[0].reason_code === 'hunter_unresponsive', items);
      check('triage facts: no submissions, initiator poster', items[0]?.facts?.submissions === 0 && items[0]?.facts?.initiator_role === 'poster', items[0]?.facts);
      const ob = await outbox(f.B);
      check('internal admins paged with the hunter-unresponsive reason', ob.some((x) => x.data.trust_review === true && /hasn't responded/.test(x.title)), ob.map((x) => x.title));
      const respondentNote = ob.some((x) => Array.isArray(x.recipients) && x.recipients.includes(U.H.id));
      check('(info) hunter notification is client-side (dispute-service), not DB', true, { dbNotifiedHunter: respondentNote });
      const g = await one(`SELECT fn_owner_refund_block_reason($1, $2) r`, [f.B, U.P.id]);
      check('poster refund waits for support ruling', g.r === 'refund_blocked_by_open_dispute', g.r);
      const stranger = await as(U.A, () => tryq(
        `INSERT INTO bounty_disputes (bounty_id, initiator_id, reason, reason_code, status) VALUES ($1, $2, 'grief', 'hunter_unresponsive', 'open')`, [f.B, U.A.id]));
      check('BLOCKED stranger files hunter-unresponsive', !stranger.ok, stranger.err);
      const ad = await as(U.D, () => tryq(
        `UPDATE bounty_disputes SET status = 'resolved_poster_wins', winner = 'poster', resolved_by = $2, resolved_at = now() WHERE id = $1`, [d.rows[0].id, U.D.id]));
      const g2 = await one(`SELECT fn_owner_refund_block_reason($1, $2) r`, [f.B, U.P.id]);
      check('after admin rules for poster, refund is allowed', ad.ok && g2.r === null, ad.err || g2.r);
    });

    // ── 8. Cancellation (hunter-initiated, existing path) ──────────────────
    await scenario('hunter cancels', async () => {
      await setRollout(24 * 30);
      const f = await fixture({ submit: true });
      await age(f.S, 73);
      await runCron();
      const rc = await as(U.H, () => tryq(`SELECT request_bounty_cancellation($1, 'cannot finish')`, [f.B]));
      check('LEGIT hunter requests cancellation', rc.ok, rc.err);
      const g = await one(`SELECT fn_owner_refund_block_reason($1, $2) r`, [f.B, U.P.id]);
      check('refund allowed once the hunter asked to cancel', g.r === null, g.r);
      await runCron();
      const [item] = await queueFor(f.B);
      check('overdue-review item closes as bounty_closed', item && item.status === 'resolved' && item.resolution === 'bounty_closed', item);
      const pc = await as(U.P, () => tryq(`UPDATE bounties SET status = 'cancelled' WHERE id = $1`, [f.B]));
      check('LEGIT poster accepts the hunter\'s cancellation', pc.ok && pc.rowCount === 1, pc.err || pc.rowCount);
      const req = await one(`SELECT status FROM bounty_requests WHERE id = $1`, [f.R1]);
      check('accepted request row was not rewritten by the client', req.status === 'accepted', req);
    });

    // ── 9. Payment failure ─────────────────────────────────────────────────
    await scenario('payment failure', async () => {
      await setRollout(24 * 30);
      // a) release failed: nothing changed, the clock keeps running.
      const f = await fixture({ submit: true });
      await age(f.S, 73);
      await runCron();
      const [a] = await queueFor(f.B);
      check('release failure: work still escalates to support', a && a.status === 'open');
      // b) release succeeded but the approval write failed (client order is
      //    release -> approve). Support must see it; auto-release must not.
      const g = await fixture({ submit: true });
      const [p] = await q(`SELECT id FROM profiles WHERE id = $1`, [U.H.id]);
      await q(`INSERT INTO wallet_transactions (user_id, type, amount, bounty_id, description, status)
               VALUES ($1, 'release', 20, $2, 'harness: release landed', 'completed')`, [p.id, g.B]);
      await age(g.S, 73);
      await runCron();
      const [b] = await queueFor(g.B);
      check('released-but-unapproved is queued for support', b && b.status === 'open');
      check('shadow rule blocks it: payment_already_settled', b && !b.auto_release_eligible && b.auto_release_blockers.includes('payment_already_settled'), b?.auto_release_blockers);
    });

    // ── 10. Delayed webhook ────────────────────────────────────────────────
    await scenario('delayed webhook', async () => {
      await setRollout(24 * 30);
      const f = await fixture({ submit: true });
      await age(f.S, 70);
      await as(U.P, () => q(`UPDATE completion_submissions SET status = 'approved' WHERE id = $1`, [f.S]));
      // No release row yet: the payment webhook hasn't landed.
      await age(f.S, 80);
      await runCron();
      check('approved-but-unsettled work is not escalated by the review clock', (await queueFor(f.B)).length === 0);
      // Webhook arrives late and only touches payment rows; a late re-run stays quiet.
      await q(`INSERT INTO wallet_transactions (user_id, type, amount, bounty_id, description, status)
               VALUES ($1, 'release', 20, $2, 'harness: late webhook', 'completed')`, [U.H.id, f.B]);
      const r = await runCron();
      check('late webhook triggers nothing in the review window', (await queueFor(f.B)).length === 0, r);
    });

    // ── 11. Phase B readiness report ───────────────────────────────────────
    await scenario('Phase B readiness report', async () => {
      await setRollout(24 * 30);
      const f = await fixture({ submit: true });
      await age(f.S, 73);
      await runCron();
      await as(U.P, () => q(`UPDATE completion_submissions SET status = 'approved' WHERE id = $1`, [f.S]));
      await runCron();
      const rep = await as(U.D, () => tryq(`SELECT admin_review_window_report() r`));
      check('admin report runs', rep.ok, rep.err);
      const r = rep.rows?.[0]?.r || {};
      check('report counts the escalation and its confirmation', r.observed_escalations >= 1 && r.shadow_eligible_confirmed >= 1, r);
      const nr = await as(U.P, () => tryq(`SELECT admin_review_window_report()`));
      check('BLOCKED non-admin report', !nr.ok, nr.err);
    });

    // ── rollback round-trip ────────────────────────────────────────────────
    await scenario('rollback round-trip', async () => {
      await c.query(txBody(D2));
      await c.query(txBody(D1));
      const left = await one(`SELECT
          to_regclass('public.trust_review_queue') q, to_regclass('public.completion_review_policy') p,
          (SELECT count(*)::int FROM pg_trigger WHERE tgname IN ('trg_completion_submissions_guard','trg_bounty_requests_guard_assignment','trg_bounty_disputes_enqueue_review')) trg,
          (SELECT count(*)::int FROM information_schema.columns WHERE table_schema='public' AND table_name='completion_submissions' AND column_name IN ('review_reminder_24h_sent_at','review_reminder_48h_sent_at','review_escalated_at')) cols,
          (SELECT count(*)::int FROM information_schema.columns WHERE table_schema='public' AND table_name='bounty_disputes' AND column_name='reason_code') rc,
          (SELECT count(*)::int FROM cron.job WHERE jobname='completion-review-window') jobs`);
      check('down migrations remove every object', !left.q && !left.p && left.trg === 0 && left.cols === 0 && left.rc === 0 && left.jobs === 0, left);
      await c.query(txBody(M1));
      await c.query(txBody(M2));
      check('migrations re-apply after rollback', true);
    });
  } finally {
    await c.query('ROLLBACK').catch(() => {});
    await c.end();
  }

  if (warnings.size) {
    console.log('\nWARNINGS raised by the new functions:');
    for (const w of warnings) console.log(' -', w);
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed (transaction rolled back; nothing persisted)`);
  if (failed.length) {
    console.log('FAILED:');
    for (const f of failed) console.log(' -', f.name);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
