/* scripts/verify-admin-hardening.js
 *
 * DB-level suite for the 2026-10-12 admin panel audit:
 *   supabase/migrations/20261012120000_admin_authorization_hardening.sql
 *   supabase/migrations/20261012120100_admin_financial_action_guards.sql
 *
 * Runs inside ONE transaction on staging and ALWAYS rolls back:
 *   1. reproduces the audit findings on the current (pre-migration) schema,
 *   2. applies both migrations and re-runs every probe as the real PostgREST
 *      roles (SET LOCAL ROLE authenticated + request.jwt.claims),
 *   3. applies both rollback files and checks the originals come back.
 * Every scenario runs in its own savepoint. Nothing persists.
 *
 * Usage:  node scripts/verify-admin-hardening.js        # staging only
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const ROOT = path.resolve(__dirname, '..');
const MIG = (f) => path.join(ROOT, 'supabase/migrations', f);
const DOWN = (f) => path.join(ROOT, 'supabase/rollbacks/production', f);
const M1 = MIG('20261012120000_admin_authorization_hardening.sql');
const M2 = MIG('20261012120100_admin_financial_action_guards.sql');
const D1 = DOWN('20261012120000_admin_authorization_hardening.down.sql');
const D2 = DOWN('20261012120100_admin_financial_action_guards.down.sql');

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
  if (!u.hostname.includes('gwumwpoomwvkjyibdmpj') && !u.username.includes('gwumwpoomwvkjyibdmpj')) {
    throw new Error('REFUSING: .env.staging does not point at staging');
  }
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

const results = [];
function check(name, ok, info) {
  results.push({ name, ok: !!ok, info });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info !== undefined ? '  -- ' + (typeof info === 'string' ? info : JSON.stringify(info)) : ''}`);
}
function note(name, info) {
  console.log(`NOTE  ${name}${info !== undefined ? '  -- ' + JSON.stringify(info) : ''}`);
}

async function main() {
  const c = await connect();
  const q = async (sql, params) => (await c.query(sql, params)).rows;
  const one = async (sql, params) => (await q(sql, params))[0];
  let sp = 0;
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
  // `jwtAdmin` = what the access token claims; the live auth.users row is
  // whatever the database says (that gap is exactly the revocation finding).
  const as = async (who, fn) => {
    const claims = { sub: who.id, role: 'authenticated', app_metadata: who.jwtAdmin ? { role: 'admin' } : {} };
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

  let U;
  // Bounty fixtures are created by postgres so the test controls money state
  // exactly; lifecycle triggers that key on current_user stay out of the way.
  const bounty = async ({ amount = 20, status = 'open', acceptedBy = null } = {}) => {
    const [b] = await q(
      `INSERT INTO bounties (title, description, amount, is_for_honor, poster_id, user_id, status, work_type, accepted_by)
       VALUES ('ADMIN-HARDENING TEST', 'harness fixture', $1, $2, $3, $3, $4::bounty_status_enum, 'online', $5) RETURNING id`,
      [amount, amount === 0, U.P.id, status, acceptedBy]);
    // Start from a known money state regardless of any auto-escrow trigger.
    await q(`DELETE FROM wallet_transactions WHERE bounty_id = $1`, [b.id]);
    await q(`DELETE FROM bounty_payments WHERE bounty_id = $1`, [b.id]);
    return b.id;
  };
  const ledger = (B, type, amount, userId) => q(
    `INSERT INTO wallet_transactions (user_id, bounty_id, type, amount, status, description)
     VALUES ($1, $2, $3::wallet_tx_type_enum, $4, 'completed', 'admin-hardening harness')`,
    [userId ?? U.P.id, B, type, amount]);
  const dispute = async (B) => (await one(
    `INSERT INTO bounty_disputes (bounty_id, initiator_id, status, reason) VALUES ($1, $2, 'open', 'harness') RETURNING id`,
    [B, U.P.id])).id;
  const setStatus = (who, B, status, reason) => as(who, () => tryq(
    `SELECT status FROM admin_set_bounty_status($1, $2, $3)`, [B, status, reason]));

  try {
    await c.query('BEGIN');
    await c.query("SET LOCAL statement_timeout = '600s'");

    // ── fixtures ──────────────────────────────────────────────────────────
    const admin = await one(
      `SELECT u.id FROM auth.users u JOIN profiles p ON p.id = u.id
        WHERE u.raw_app_meta_data->>'role' = 'admin' AND p.account_status = 'active' LIMIT 1`);
    if (!admin) throw new Error('need one active admin on staging');
    const users = await q(
      `SELECT p.id FROM profiles p JOIN auth.users u ON u.id = p.id
        WHERE p.account_status = 'active' AND COALESCE(u.raw_app_meta_data->>'role', '') <> 'admin'
        ORDER BY p.created_at LIMIT 4`);
    if (users.length < 4) throw new Error('need 4 active non-admin staging profiles');
    U = {
      P: { id: users[0].id },                     // poster
      H: { id: users[1].id },                     // hunter
      A: { id: users[2].id },                     // stranger
      S: { id: users[3].id, jwtAdmin: true },     // stale/forged token: claims admin, DB says no
      D: { id: admin.id, jwtAdmin: true },        // real admin
    };
    await q(`SELECT set_config('app.bypass_profile_guard', 'on', true)`);
    await q(`UPDATE profiles SET balance = 500 WHERE id = ANY($1)`, [[U.P.id, U.H.id, U.A.id, U.S.id]]);
    const hasAdjLabel = !!(await one(
      `SELECT 1 x FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'wallet_tx_type_enum' AND e.enumlabel = 'admin_adjustment'`));

    // ── 1. Reproduce the findings on the current schema ─────────────────────
    await scenario('PRE-FIX: findings reproduce on the current schema', async () => {
      const B = await bounty({ amount: 20 });
      await ledger(B, 'escrow', -20);
      const stale = await setStatus(U.S, B, 'archived', null);
      check('PRE: token claiming admin (live record says no) passes admin RPCs', stale.ok, stale.err);
      const B2 = await bounty({ amount: 20 });
      await ledger(B2, 'escrow', -20);
      const strand = await setStatus(U.D, B2, 'cancelled', null);
      check('PRE: admin can cancel a bounty whose escrow is held, with no reason', strand.ok, strand.err);
      const phish = await as(U.A, () => tryq(
        `SELECT send_system_notification($1, 'account_restricted', 'Bounty Security', 'Verify at evil.example', NULL)`, [U.H.id]));
      check('PRE: any user can send an "account_restricted" notification to anyone', phish.ok, phish.err);
      const others = await one(`SELECT count(*)::int n FROM wallet_transactions WHERE user_id <> $1`, [U.D.id]);
      const seen = await as(U.D, () => one(`SELECT count(*)::int n FROM wallet_transactions WHERE user_id <> $1`, [U.D.id]));
      check('PRE: admin console sees none of the other users\' ledger rows', others.n > 0 && seen.n === 0, { total: others.n, adminSees: seen.n });
      const aal = await as(U.D, () => one(`SELECT count(*)::int n FROM admin_action_log`));
      note('PRE: admin_action_log rows visible to admin client', aal);
    });

    // ── 2. Apply ──────────────────────────────────────────────────────────
    await c.query(txBody(M1));
    check('20261012120000 applies cleanly', true);
    await c.query(txBody(M2));
    check('20261012120100 applies cleanly', true);

    // ── 3. Revocation ─────────────────────────────────────────────────────
    await scenario('admin role: claim AND live record required', async () => {
      const B = await bounty({ amount: 5 });
      const real = await as(U.D, () => one(`SELECT public.is_admin() v`));
      check('real admin: is_admin() true', real.v === true);
      const stale = await setStatus(U.S, B, 'archived', 'harness');
      check('token claiming admin without the live role is refused', !stale.ok && stale.code === '42501', stale.err);
      const plain = await setStatus(U.A, B, 'archived', 'harness');
      check('plain user refused', !plain.ok && plain.code === '42501', plain.err);
      await q(`UPDATE auth.users SET raw_app_meta_data = raw_app_meta_data - 'role' WHERE id = $1`, [U.D.id]);
      const revoked = await setStatus(U.D, B, 'archived', 'harness');
      check('revoked admin is refused immediately, even with an unexpired admin token', !revoked.ok && revoked.code === '42501', revoked.err);
      const anonExec = await one(`SELECT has_function_privilege('anon', 'public.is_admin()', 'EXECUTE') v`);
      check('anon cannot execute is_admin()', anonExec.v === false);
    });

    // ── 4. Visibility ─────────────────────────────────────────────────────
    await scenario('admin read access (and nobody else\'s)', async () => {
      const B = await bounty({ amount: 20 });
      await ledger(B, 'escrow', -20);
      await q(`INSERT INTO bounty_requests (bounty_id, hunter_id, poster_id, status) VALUES ($1, $2, $3, 'pending')`, [B, U.H.id, U.P.id]);
      await q(`INSERT INTO admin_action_log (admin_user_id, action_type, target_user_id, reason, result)
               VALUES ($1, 'account_status_change', $2, 'harness', 'success')`, [U.D.id, U.A.id]);
      const total = await one(`SELECT count(*)::int n FROM wallet_transactions`);
      const adminWt = await as(U.D, () => one(`SELECT count(*)::int n FROM wallet_transactions`));
      check('admin sees every ledger row', adminWt.n === total.n, { total: total.n, admin: adminWt.n });
      const userWt = await as(U.A, () => one(`SELECT count(*)::int n FROM wallet_transactions WHERE bounty_id = $1`, [B]));
      check('stranger still sees none of another user\'s ledger rows', userWt.n === 0, userWt);
      const staleWt = await as(U.S, () => one(`SELECT count(*)::int n FROM wallet_transactions WHERE bounty_id = $1`, [B]));
      check('forged admin token sees none either', staleWt.n === 0, staleWt);
      for (const t of ['admin_action_log', 'payout_audit_log', 'bounty_requests', 'completion_submissions', 'dispute_evidence', 'bounty_cancellations']) {
        const all = await one(`SELECT count(*)::int n FROM ${t}`);
        const adminSees = await as(U.D, () => one(`SELECT count(*)::int n FROM ${t}`));
        check(`admin sees all of ${t}`, adminSees.n === all.n, { all: all.n, admin: adminSees.n });
      }
      const aalUser = await as(U.A, () => one(`SELECT count(*)::int n FROM admin_action_log`));
      check('non-admin sees no admin_action_log rows', aalUser.n === 0, aalUser);
    });

    // ── 5. Dispute admin policies ─────────────────────────────────────────
    await scenario('dispute admin policies now match real admins', async () => {
      const B = await bounty({ amount: 5 });
      const DI = await dispute(B);
      const internal = await as(U.D, () => tryq(
        `INSERT INTO dispute_comments (dispute_id, user_id, comment, is_internal) VALUES ($1, $2, 'admin note', true)`, [DI, U.D.id]));
      check('admin can post an internal dispute note', internal.ok, internal.err);
      const forged = await as(U.P, () => tryq(
        `INSERT INTO dispute_comments (dispute_id, user_id, comment, is_internal) VALUES ($1, $2, 'fake', true)`, [DI, U.P.id]));
      check('party cannot post an internal note', !forged.ok, forged.err);
      const partySees = await as(U.P, () => one(`SELECT count(*)::int n FROM dispute_comments WHERE dispute_id = $1 AND is_internal`, [DI]));
      check('party cannot read internal notes', partySees.n === 0, partySees);
      const adminSees = await as(U.D, () => one(`SELECT count(*)::int n FROM dispute_comments WHERE dispute_id = $1`, [DI]));
      check('admin reads internal notes', adminSees.n >= 1, adminSees);
      const res = await as(U.D, () => tryq(
        `INSERT INTO dispute_resolutions (dispute_id, admin_id, outcome, rationale) VALUES ($1, $2, 'refund', 'harness')`, [DI, U.D.id]));
      const resUser = await as(U.P, () => tryq(
        `INSERT INTO dispute_resolutions (dispute_id, admin_id, outcome, rationale) VALUES ($1, $2, 'refund', 'harness')`, [DI, U.P.id]));
      check('party cannot record a resolution', !resUser.ok, resUser.err);
      if (res.ok) check('admin can record a resolution', true);
      else note('admin resolution insert rejected by a non-policy constraint (outcome value?)', res.err);
      check('admin resolution not blocked by RLS', res.ok || !/row-level security/.test(res.err), res.err);
    });

    // ── 6. Audit log is append-only ───────────────────────────────────────
    await scenario('admin_action_log append-only', async () => {
      const [row] = await q(`INSERT INTO admin_action_log (admin_user_id, action_type, target_user_id, reason, result)
                             VALUES ($1, 'id_verification_review', $2, 'harness', 'success') RETURNING id`, [U.D.id, U.A.id]);
      check('id_verification_review is an allowed action_type', !!row);
      const upd = await tryq(`UPDATE admin_action_log SET reason = 'tampered' WHERE id = $1`, [row.id]);
      check('UPDATE refused even for the table owner', !upd.ok, upd.err);
      const del = await tryq(`DELETE FROM admin_action_log WHERE id = $1`, [row.id]);
      check('DELETE refused even for the table owner', !del.ok, del.err);
      const trunc = await tryq(`TRUNCATE admin_action_log`);
      check('TRUNCATE refused', !trunc.ok, trunc.err);
    });

    // ── 7. send_system_notification ───────────────────────────────────────
    await scenario('send_system_notification caller rules', async () => {
      const B = await bounty({ amount: 20, status: 'in_progress', acceptedBy: U.H.id });
      const quiet = await bounty({ amount: 20, status: 'in_progress', acceptedBy: U.H.id });
      await dispute(B);
      const phish = await as(U.A, () => tryq(
        `SELECT send_system_notification($1, 'account_restricted', 'Bounty Security', 'Verify at evil.example', NULL)`, [U.H.id]));
      check('stranger: account_restricted refused', !phish.ok && phish.code === '42501', phish.err);
      const forgedToken = await as(U.S, () => tryq(
        `SELECT send_system_notification($1, 'account_warning', 'x', 'y', NULL)`, [U.H.id]));
      check('forged admin token: staff type refused', !forgedToken.ok, forgedToken.err);
      const outsider = await as(U.A, () => tryq(
        `SELECT send_system_notification($1, 'dispute_created', 'x', 'y', jsonb_build_object('bountyId', $2::text))`, [U.H.id, B]));
      check('non-party sender refused', !outsider.ok, outsider.err);
      const toOutsider = await as(U.P, () => tryq(
        `SELECT send_system_notification($1, 'dispute_created', 'x', 'y', jsonb_build_object('bountyId', $2::text))`, [U.A.id, B]));
      check('party -> non-party recipient refused', !toOutsider.ok, toOutsider.err);
      const noDispute = await as(U.P, () => tryq(
        `SELECT send_system_notification($1, 'dispute_created', 'x', 'y', jsonb_build_object('bountyId', $2::text))`, [U.H.id, quiet]));
      check('bounty without a dispute refused', !noDispute.ok, noDispute.err);
      const legit = await as(U.P, () => tryq(
        `SELECT send_system_notification($1, 'dispute_created', 'URGENT: account locked', 'go to evil.example',
                jsonb_build_object('bountyId', $2::text, 'disputeId', 1, 'link', 'https://evil.example'))`, [U.H.id, B]));
      check('party -> party dispute notification allowed', legit.ok, legit.err);
      const stored = await one(
        `SELECT title, body, data FROM notifications WHERE user_id = $1 AND type = 'dispute_created' ORDER BY created_at DESC LIMIT 1`, [U.H.id]);
      check('caller-supplied text replaced by server copy', stored && stored.title === 'Dispute opened' && !/evil/.test(stored.body), stored);
      check('caller-supplied extra data keys dropped', stored && stored.data && stored.data.link === undefined, stored && stored.data);
      const adminSend = await as(U.D, () => tryq(
        `SELECT send_system_notification($1, 'account_warning', 'Custom staff title', 'Custom body', NULL)`, [U.A.id]));
      check('admin keeps full control', adminSend.ok, adminSend.err);
      const backend = await tryq(`SELECT send_system_notification($1, 'verification_verified', 'ok', 'ok', NULL)`, [U.A.id]);
      check('backend context (no end-user JWT) unchanged', backend.ok, backend.err);
    });

    // ── 8. Grants ─────────────────────────────────────────────────────────
    await scenario('backend-only functions are not client-callable', async () => {
      for (const fn of [
        'public.record_reconciliation_finding(text,text,uuid,jsonb,boolean)',
        'public.increment_withdrawal_counter(uuid,timestamptz)',
        'public.fn_bounty_unsettled_escrow_reason(uuid)',
        'public.admin_apply_balance_adjustment(uuid,uuid,numeric,text,text,uuid)',
      ]) {
        const g = await one(`SELECT has_function_privilege('anon', $1, 'EXECUTE') a, has_function_privilege('authenticated', $1, 'EXECUTE') u`, [fn]);
        check(`${fn.replace('public.', '').split('(')[0]}: no anon/authenticated EXECUTE`, !g.a && !g.u, g);
      }
    });

    // ── 9. Escrow guard on admin status changes ───────────────────────────
    await scenario('admin status change cannot strand or skip escrow', async () => {
      const honor = await bounty({ amount: 5 });
      const noReason = await setStatus(U.D, honor, 'archived', '  ');
      check('reason required', !noReason.ok && noReason.code === '22023', noReason.err);
      const ok = await setStatus(U.D, honor, 'archived', 'spam listing');
      check('bounty with no escrow: archive with reason allowed', ok.ok, ok.err);
      const ev = await one(`SELECT metadata->>'reason' r FROM bounty_events WHERE bounty_id = $1 AND event_type = 'admin.status_changed'`, [honor]);
      check('reason recorded on the bounty_events audit row', ev && ev.r === 'spam listing', ev);

      const open = await bounty({ amount: 20 });
      await ledger(open, 'escrow', -20);
      for (const target of ['cancelled', 'archived']) {
        const r = await setStatus(U.D, open, target, 'harness');
        check(`open + wallet escrow held -> ${target} refused`, !r.ok && r.code === '55000' && /wallet_escrow_held/.test(r.err), r.err);
      }
      const start = await setStatus(U.D, open, 'in_progress', 'harness');
      check('open -> in_progress allowed (escrow stays put)', start.ok, start.err);
      const done = await setStatus(U.D, open, 'completed', 'harness');
      check('in_progress + escrow held -> completed refused (hunter unpaid)', !done.ok && done.code === '55000', done.err);
      await ledger(open, 'release', 20, U.H.id);
      const paid = await setStatus(U.D, open, 'completed', 'harness');
      check('after a recorded release -> completed allowed', paid.ok, paid.err);

      const refunded = await bounty({ amount: 20 });
      await ledger(refunded, 'escrow', -20);
      await ledger(refunded, 'refund', 20);
      const cancel = await setStatus(U.D, refunded, 'cancelled', 'harness');
      check('after a recorded refund -> cancelled allowed', cancel.ok, cancel.err);

      const stripe = await bounty({ amount: 35 });
      await q(`INSERT INTO bounty_payments (bounty_id, poster_id, amount, status) VALUES ($1, $2, 35, 'captured')`, [stripe, U.P.id]);
      const s1 = await setStatus(U.D, stripe, 'cancelled', 'harness');
      check('captured Stripe payment -> cancelled refused (the 5e96aaed case)', !s1.ok && /stripe_payment_captured/.test(s1.err), s1.err);
      await q(`UPDATE bounty_payments SET status = 'refunded' WHERE bounty_id = $1`, [stripe]);
      const s2 = await setStatus(U.D, stripe, 'cancelled', 'harness');
      check('refunded Stripe payment -> cancelled allowed', s2.ok, s2.err);

      const idem = await setStatus(U.D, stripe, 'cancelled', null);
      check('same-status call stays an idempotent no-op (no reason needed)', idem.ok, idem.err);
    });

    // ── 10. Manual balance adjustment ─────────────────────────────────────
    await scenario('admin_apply_balance_adjustment', async () => {
      const call = (admin, user, amount, reason, key) => tryq(
        `SELECT * FROM admin_apply_balance_adjustment($1, $2, $3, $4, $5, NULL)`, [admin, user, amount, reason, key]);
      const self = await call(U.D.id, U.D.id, 10, 'harness', 'key-self-0001');
      check('self-adjustment refused', !self.ok && self.code === '42501', self.err);
      const noReason = await call(U.D.id, U.A.id, 10, ' ', 'key-noreason-01');
      check('reason required', !noReason.ok && noReason.code === '22023', noReason.err);
      const badKey = await call(U.D.id, U.A.id, 10, 'harness', 'short');
      check('idempotency key required', !badKey.ok && badKey.code === '22023', badKey.err);
      const cents = await call(U.D.id, U.A.id, 10.005, 'harness', 'key-cents-0001');
      check('fractional cents refused', !cents.ok, cents.err);
      const big = await call(U.D.id, U.A.id, 10001, 'harness', 'key-big-00001');
      check('over-cap amount refused', !big.ok, big.err);
      if (!hasAdjLabel) {
        note('SKIPPED functional adjustment checks: staging wallet_tx_type_enum has no admin_adjustment label (prod does); covered by scripts/verify-admin-adjustment-pglite.js');
        return;
      }
      const before = await one(`SELECT balance FROM profiles WHERE id = $1`, [U.A.id]);
      const first = await call(U.D.id, U.A.id, 12.5, 'harness credit', 'key-credit-0001');
      check('adjustment applied', first.ok && first.rows[0].replayed === false, first.err || first.rows);
      const again = await call(U.D.id, U.A.id, 12.5, 'harness credit', 'key-credit-0001');
      check('retry with same key is a replay, not a second credit', again.ok && again.rows[0].replayed === true, again.err || again.rows);
      const after = await one(`SELECT balance FROM profiles WHERE id = $1`, [U.A.id]);
      check('balance moved exactly once', Number(after.balance) - Number(before.balance) === 12.5, { before, after });
      const rows = await one(`SELECT count(*)::int n FROM wallet_transactions WHERE user_id = $1 AND type = 'admin_adjustment'`, [U.A.id]);
      check('exactly one ledger row', rows.n === 1, rows);
      const audit = await one(`SELECT count(*)::int n FROM admin_action_log WHERE target_user_id = $1 AND action_type = 'manual_balance_adjustment'`, [U.A.id]);
      check('exactly one audit row', audit.n === 1, audit);
    });

    // ── 11. RLS deploy gate ───────────────────────────────────────────────
    // Same snapshot queries and analyze() as scripts/check-rls-policies.js,
    // taken inside this transaction so the gate sees the migrated schema.
    await scenario('RLS manifest gate passes on the migrated schema', async () => {
      const { analyze } = require('./rls-policy-check/rules');
      const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'supabase/security/rls-manifest.json'), 'utf8'));
      manifest.baseline = manifest.baseline[ENV];
      const snap = {
        policies: await q(`SELECT tablename, policyname, permissive, cmd, roles::text AS roles, qual, with_check
                             FROM pg_policies WHERE schemaname = 'public'`),
        grants: await q(`SELECT table_name, grantee, privilege_type FROM information_schema.role_table_grants
                          WHERE table_schema = 'public' AND grantee IN ('anon', 'authenticated')`),
        triggers: await q(`SELECT c.relname AS table_name, t.tgname, t.tgenabled::text AS enabled
                             FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
                             JOIN pg_namespace n ON n.oid = c.relnamespace
                            WHERE n.nspname = 'public' AND NOT t.tgisinternal`),
        columns: await q(`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`),
        tables: await q(`SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled
                           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                          WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')`),
        column_grants: await q(`SELECT c.relname AS table_name, a.attname AS column_name,
                                       x.grantee::regrole::text AS grantee, x.privilege_type
                                  FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
                                  JOIN pg_namespace n ON n.oid = c.relnamespace
                                  CROSS JOIN LATERAL aclexplode(a.attacl) x
                                 WHERE n.nspname = 'public' AND a.attacl IS NOT NULL AND NOT a.attisdropped
                                   AND x.grantee::regrole::text IN ('anon', 'authenticated')`),
        functions: await q(`SELECT p.oid::regprocedure::text AS signature,
                                   array(SELECT x.grantee::regrole::text
                                           FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                                          WHERE x.privilege_type = 'EXECUTE' AND x.grantee <> 0) AS grantees,
                                   EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                                            WHERE x.privilege_type = 'EXECUTE' AND x.grantee = 0) AS public_execute
                              FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                             WHERE n.nspname = 'public'`),
      };
      for (const f of snap.functions) if (f.public_execute) f.grantees.push('anon', 'authenticated', 'PUBLIC');
      const { errors } = analyze(snap, manifest);
      check('no RLS gate errors after both migrations (edge deploys stay unblocked)', errors.length === 0, errors);
    });

    // ── 12. Rollback files ────────────────────────────────────────────────
    await scenario('rollback files restore the originals', async () => {
      await c.query(txBody(D2));
      await c.query(txBody(D1));
      const fn = await one(`SELECT to_regprocedure('public.is_admin()') a, to_regprocedure('public.admin_apply_balance_adjustment(uuid,uuid,numeric,text,text,uuid)') b`);
      check('rollbacks apply cleanly and remove new functions', fn.a === null && fn.b === null, fn);
      const B = await bounty({ amount: 20 });
      await ledger(B, 'escrow', -20);
      const r = await setStatus(U.D, B, 'cancelled', null);
      check('after rollback admin_set_bounty_status behaves as before', r.ok, r.err);
    });
  } finally {
    await c.query('ROLLBACK').catch(() => {});
    await c.end();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed. Transaction rolled back; nothing persisted.`);
  if (failed.length) {
    for (const f of failed) console.log(`  FAILED: ${f.name}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
