/* scripts/verify-anti-scam-gate.js
 *
 * DB-level test suite for supabase/migrations/20261001140000_anti_scam_distribution_gate.sql
 * (escalation trust gate, scam rules, report-driven review, visibility hold,
 * alert delivery watermark, report_submitted feed).
 *
 * Applies the migration inside ONE transaction on staging, builds fixtures,
 * exercises the real triggers / functions / RLS as the PostgREST roles, and
 * ALWAYS rolls back. Nothing persists.
 *
 * Usage:
 *   node scripts/verify-anti-scam-gate.js            # staging (.env.staging)
 *
 * Refuses production. Exits non-zero if any check fails.
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const ROOT = path.resolve(__dirname, '..');
const MIGRATION = path.join(ROOT, 'supabase/migrations/20261001140000_anti_scam_distribution_gate.sql');
const ROLLBACK = path.join(ROOT, 'supabase/rollbacks/production/20261001140000_anti_scam_distribution_gate.down.sql');
// Production's live definitions on 2026-10-01 (md5 of pg_get_functiondef).
const PROD_FUNCTION_MD5 = {
  'fn_escalate_stale_bounty_liquidity()': 'a4525bae5000c7107e534e575fad5996',
  'fn_notify_radius_matched_bounty()': '75e0a4dd383f4138282463fe5f0244fe',
  'fn_notify_service_area_matched_bounty()': '7d0c5cef63603ffe53283631ac6ac649',
  'fn_notify_zip_matched_bounty()': '5e75dc8b8d900c6611332b9cb883753a',
  'moderation_apply_signals(p_bounty_id uuid, p_signals jsonb, p_source text)': 'df3a781d63dd5fd21a865a1fb314b048',
  'moderation_scan_content(p_title text, p_description text)': '3092e95048f46a3fc064aa3a5b9624ae',
  'moderation_transition_allowed(p_from text, p_to text, p_actor text)': 'd4574b470f1f48655a07242337b60196',
  'run_moderation_sweep()': 'd2a4a8462e77074c7b55c4c42a582383',
};
const TOUCHED_FUNCTIONS = [
  'fn_escalate_stale_bounty_liquidity', 'fn_notify_radius_matched_bounty', 'fn_notify_service_area_matched_bounty',
  'fn_notify_zip_matched_bounty', 'moderation_apply_signals', 'moderation_scan_content', 'moderation_transition_allowed',
  'run_moderation_sweep', 'trg_moderation_scan_bounty', 'moderation_attachment_count', 'moderation_scan_attachments',
  'fn_bounty_moderation_visible', 'fn_bounty_credibility_signals', 'fn_bounty_distribution_gate',
  'trg_fn_reports_moderation_action', 'moderation_report_events_pending', 'moderation_mark_report_events_captured',
];
const ENV = (process.argv.find((a) => a.startsWith('--env=')) || '--env=staging').slice(6);
if (ENV !== 'staging') {
  console.error('verify-anti-scam-gate only runs against staging (it applies DDL inside a transaction).');
  process.exit(2);
}

function candidateUrls() {
  const env = fs.readFileSync(path.join(ROOT, `.env.${ENV}`), 'utf8');
  const m = env.match(/^\s*DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m);
  if (!m) throw new Error(`DATABASE_URL not found in .env.${ENV}`);
  const raw = m[1].trim();
  const u = new URL(raw);
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

const results = [];
function check(name, ok, info) {
  results.push({ name, ok: !!ok, info });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info !== undefined ? '  -- ' + (typeof info === 'string' ? info : JSON.stringify(info)) : ''}`);
}

// --- content corpus ---------------------------------------------------------
// Scam texts: reconstructed from the quotes in docs/trust-spine-audit-2026-09-30.md
// and the 2026-09-25 audit notes (production text is replayed separately by
// scripts/replay-anti-scam-gate.js).
const SCAMS = [
  ['payment proxy (0b9e1e8a quote)', 'I need someone to help complete an online purchase',
    'Pay for a birthday gift order on bommergifts for me. I can explain further in the dms.'],
  ['KYC (8e46ee32 shape)', 'Account verification help', 'Need someone to verify my account, quick KYC, takes 5 minutes.'],
  ['card testing (c1c869bb shape)', 'Payment testing task', 'Help with card testing for my store using your own card, reimbursed same day.'],
  ['employment (651dffe4 shape)', 'Part-Time Remote Personal Assistant', '$25/hr, weekly pay, no experience needed. Contact me on Signal.'],
  ['details in image', 'Easy task', 'See attached image for details'],
  ['off-platform payment', 'Quick errand', 'I will pay you via Zelle once done, very easy job for anyone nearby'],
  ['package reshipping', 'Receive packages', 'Receive packages for my business at your address and reship packages weekly.'],
];
const LEGIT = [
  ['Run to the store', 'Pick up milk and eggs from Safeway and drop them at my door.'],
  ['Take photos', 'Take a few photos of my storefront in good daylight.'],
  ['Walk my dog', '30 minute walk around the block, leash provided.'],
  ['Cut my hair at my place', 'Simple trim, I have clippers.'],
  ['Hold my spot in the merch line', ''],
  ['Take lecture notes for me', ''],
  ['What Would You Buy for $1?', 'Just curious what people would buy.'],
  ['Help me move a couch', 'Two flights of stairs, about an hour, think $25/hr.'],
  ['Pick up my online order from Target', 'It is already paid, just collect it at the counter.'],
  ['Help my grandma set up her new phone', 'Transfer contacts and photos, show her how to video call.'],
  ['Mow my lawn', 'Front and back yard this Saturday morning.'],
  ['Photograph my event', 'Birthday party, about two hours. See you there!'],
  ['Deliver flowers', 'Bring the bouquet to my mom at the hospital, I will share the room number in the app chat.'],
  ['Grocery run', 'I will send you the list in the chat once I accept you.'],
  ['Assemble IKEA desk', 'Bring your own tools please, should take an hour.'],
  ['Wait for a delivery', 'Sit at my place until the fridge is delivered and sign for it.'],
  ['Clean my yard', 'Rake leaves and bag them. DM for more details'], // existing contact rule fires (pre-existing)
];
const NEW_TYPES = ['payment_proxy', 'purchase_on_behalf', 'off_platform_channel', 'off_platform_payment',
  'employment_offer', 'recurring_pay_rate', 'details_withheld', 'details_in_attachment'];

async function main() {
  const c = await connect();
  const warnings = [];
  c.on('notice', (n) => { if (n.severity === 'WARNING') warnings.push(n.message); });
  const q = async (sql, params) => (await c.query(sql, params)).rows;
  const one = async (sql, params) => (await q(sql, params))[0];
  const savepoint = async (name, fn) => {
    await c.query(`SAVEPOINT ${name}`);
    try { return await fn(); } finally { await c.query(`ROLLBACK TO SAVEPOINT ${name}`); }
  };
  const asRole = async (role, claims, fn) => {
    await c.query(`SET LOCAL ROLE ${role}`);
    await c.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
    try { return await fn(); } finally {
      // In an aborted transaction these fail; the caller's savepoint rollback
      // restores the role, so don't let them mask the original error.
      await c.query('RESET ROLE').catch(() => {});
      await c.query(`SELECT set_config('request.jwt.claims', '', true)`).catch(() => {});
    }
  };

  try {
    await c.query('BEGIN');
    await c.query("SET LOCAL statement_timeout = '600s'");

    // Staging lags production on two escalator prerequisites (20260901140000,
    // 20260919120000). Install test-only stand-ins inside this transaction so
    // the production escalator body can run here.
    await c.query(`ALTER TABLE public.bounties ADD COLUMN IF NOT EXISTS liquidity_location_nudged_at timestamptz`);
    const hasRrf = await one(`SELECT to_regprocedure('public.record_reconciliation_finding(text,text,uuid,jsonb)') IS NOT NULL AS ok`);
    if (!hasRrf.ok) {
      await c.query(`CREATE FUNCTION public.record_reconciliation_finding(text, text, uuid, jsonb) RETURNS void
                     LANGUAGE sql AS $$ SELECT NULL::void $$`);
    }
    const dispatcher = await one(`SELECT pg_get_function_result('public.fn_score_and_dispatch_bounty_notification'::regproc) r`);
    if (dispatcher.r === 'void') {
      const src = fs.readFileSync(path.join(ROOT, 'supabase/migrations/20260919120000_liquidity_escalation_requires_candidates.sql'), 'utf8');
      const m = src.match(/DROP FUNCTION IF EXISTS public\.fn_score_and_dispatch_bounty_notification[\s\S]*?\r?\n\$\$;/);
      if (!m) throw new Error('could not extract the production dispatcher from 20260919120000');
      await c.query(m[0]);
    }

    // Fixture bounties must start unfunded so the credibility checks mean
    // something; staging's normaliser would otherwise reserve escrow from a
    // zero balance. Only escrow reservation is switched off (rolled back).
    await c.query(`ALTER TABLE public.bounties DISABLE TRIGGER trg_bounties_reserve_escrow`);
    // Fixture-only edits to protected profile columns (identity, account status).
    await c.query(`SELECT set_config('app.bypass_profile_guard', 'on', true)`);

    const preAlerts = await one(`SELECT count(*)::int n FROM public.moderation_alerts`);
    const preReports = await one(`SELECT count(*)::int n FROM public.reports`);

    // --- apply migration ----------------------------------------------------
    const sql = fs.readFileSync(MIGRATION, 'utf8').replace(/^\s*BEGIN;\s*$/m, '').replace(/^\s*COMMIT;\s*$/m, '');
    await c.query(sql);
    check('migration applies cleanly', true);

    const watermark = await one(`SELECT
        (SELECT count(*) FROM public.moderation_alerts WHERE fanned_out_at IS NULL)::int alerts_undelivered,
        (SELECT count(*) FROM public.reports WHERE analytics_captured_at IS NULL)::int reports_uncaptured`);
    check('existing alerts/reports count as delivered/captured (no retroactive burst)',
      watermark.alerts_undelivered === 0 && watermark.reports_uncaptured === 0,
      { ...watermark, preAlerts: preAlerts.n, preReports: preReports.n });

    // --- 1. scanner ---------------------------------------------------------
    const scan = async (t, d) => (await one(`SELECT public.moderation_scan_content($1, $2) s`, [t, d])).s;
    const score = (sigs) => sigs.reduce((a, s) => a + Number(s.weight), 0);
    for (const [label, t, d] of SCAMS) {
      const sigs = await scan(t, d);
      const fresh = sigs.filter((s) => NEW_TYPES.includes(s.type));
      check(`scam detected: ${label}`, fresh.length > 0 && score(sigs) >= 2,
        sigs.map((s) => `${s.type}(${s.weight}) "${s.evidence.match}"`).join('; '));
    }
    const s0 = await scan(SCAMS[0][1], SCAMS[0][2]);
    check('payment-proxy scam reaches the auto-flag score (>= 5) on content alone', score(s0) >= 5, score(s0));
    for (const [t, d] of LEGIT) {
      const sigs = await scan(t, d);
      const fresh = sigs.filter((s) => NEW_TYPES.includes(s.type));
      const blocking = fresh.filter((s) => Number(s.weight) >= 2);
      check(`legit not blocked by new rules: ${t}`, blocking.length === 0,
        sigs.length ? sigs.map((s) => `${s.type}(${s.weight}) "${s.evidence.match}"`).join('; ') : 'no signals');
    }
    const att = (await one(`SELECT public.moderation_scan_attachments('', '[]'::jsonb, to_jsonb('[{"id":"a"}]'::text)) s`)).s;
    check('attachment-only listing (string-encoded attachments_json) gives weight-1 signal',
      att.length === 1 && att[0].type === 'details_in_attachment' && Number(att[0].weight) === 1, att);
    const att2 = (await one(`SELECT public.moderation_scan_attachments('Full description of a real job that is long enough', '[{"id":"a"}]'::jsonb, NULL) s`)).s;
    check('attachment with a real description gives no signal', att2.length === 0, att2);

    // --- fixtures -----------------------------------------------------------
    const mkUser = async (label, { ageDays = 0, status = 'active', identity = null, zip = null } = {}) => {
      const r = await one(`WITH u AS (
          INSERT INTO auth.users (id, aud, role, email, created_at, updated_at)
          VALUES (gen_random_uuid(), 'authenticated', 'authenticated', $1, now(), now()) RETURNING id)
        INSERT INTO public.profiles (id, username, created_at, account_status, stripe_identity_status, zip_code)
        SELECT id, $2, now() - make_interval(days => $3), $4, $5, $6 FROM u RETURNING id`,
        [`antiscam+${label}+${Date.now()}@example.test`, `antiscam_${label}_${Date.now() % 1e7}`, ageDays, status, identity, zip]);
      return r.id;
    };
    const mkBounty = async (poster, { title = 'Help me carry boxes', description = 'Two boxes from the car to the second floor, ten minutes.',
      workType = 'online', zip = null, lat = null, lng = null, status = 'open', isTest = false, attachmentsJson = null } = {}) => {
      const r = await one(`INSERT INTO public.bounties
          (title, description, amount, is_for_honor, poster_id, user_id, status, work_type, zip_code, latitude, longitude, is_test, attachments_json, funding_mode)
        VALUES ($1, $2, 40, false, $3, $3, $4, $5, $6, $7, $8, $9, $10, 'at_accept') RETURNING id`,
        [title, description, poster, status, workType, zip, lat, lng, isTest, attachmentsJson]);
      return r.id;
    };
    const gate = async (id, pathName, cred) =>
      (await one(`SELECT public.fn_bounty_distribution_gate($1, $2, 2::smallint, $3) g`, [id, pathName, cred])).g;
    const modState = async (id) => (await one(`SELECT state FROM public.bounty_moderation WHERE bounty_id = $1`, [id]))?.state ?? null;

    const pNew = await mkUser('pnew', { ageDays: 1 });
    const pOld = await mkUser('pold', { ageDays: 60 });
    const pDone = await mkUser('pdone', { ageDays: 90 });
    const pVerified = await mkUser('pver', { ageDays: 2, identity: 'verified' });
    const pSusp = await mkUser('psusp', { ageDays: 90, status: 'suspended' });
    const h1 = await mkUser('h1', { ageDays: 30, zip: '99001' });
    const h2 = await mkUser('h2', { ageDays: 30 });
    const h3 = await mkUser('h3', { ageDays: 30 });

    // pDone has one real completed transaction with h1.
    const done = await mkBounty(pDone, { title: 'Old finished job' });
    await c.query(`UPDATE public.bounties SET accepted_by = $2, status = 'completed' WHERE id = $1`, [done, h1]);

    // --- 2. gate ------------------------------------------------------------
    const bNew = await mkBounty(pNew);
    let g = await gate(bNew, 'escalation', true);
    check('gate: clean bounty from new poster -> escalation skipped (no credibility only)',
      !g.allowed && JSON.stringify(g.reasons) === '["no_credibility_signal"]', g);
    g = await gate(bNew, 'radius', false);
    check('gate: same bounty -> insert-time nearby push allowed (new-poster liquidity kept)', g.allowed, g);

    const bDone = await mkBounty(pDone);
    g = await gate(bDone, 'escalation', true);
    check('gate: poster with completed transaction -> allowed', g.allowed && g.credibility.includes('completed_transaction'), g);

    const bVer = await mkBounty(pVerified);
    g = await gate(bVer, 'escalation', true);
    check('gate: ID-verified poster -> allowed', g.allowed && g.credibility.includes('id_verified'), g);

    const bScamTrusted = await mkBounty(pDone, { title: SCAMS[0][1], description: SCAMS[0][2] });
    g = await gate(bScamTrusted, 'escalation', true);
    check('gate: scam text from a credible poster -> skipped (auto-flagged at insert)',
      !g.allowed && g.reasons.includes('moderation_flagged'), g);
    check('scam bounty auto-flagged by insert trigger', (await modState(bScamTrusted)) === 'flagged');

    const bMid = await mkBounty(pDone, { title: 'Part-Time Remote Personal Assistant', description: 'Organise my calendar and emails.' });
    g = await gate(bMid, 'escalation', true);
    check('gate: sub-threshold signals (score >= 2, not flagged) -> skipped as unresolved',
      !g.allowed && g.reasons.includes('unresolved_signals'), g);

    const bSusp = await mkBounty(pDone);
    await c.query(`UPDATE public.profiles SET account_status = 'suspended' WHERE id = $1`, [pDone]);
    g = await gate(bSusp, 'escalation', true);
    check('gate: suspended poster -> skipped', !g.allowed && g.reasons.includes('poster_account_suspended'), g);
    await c.query(`UPDATE public.profiles SET account_status = 'active' WHERE id = $1`, [pDone]);

    const bRep = await mkBounty(pOld);
    await c.query(`INSERT INTO public.reports (reporter_id, content_type, content_id, reason, status) VALUES ($1, 'bounty', $2, 'fraud', 'pending')`, [h2, bRep]);
    await c.query(`UPDATE public.profiles SET stripe_identity_status = 'verified' WHERE id = $1`, [pOld]);
    g = await gate(bRep, 'escalation', true);
    check('gate: pending report on bounty -> skipped even with credibility', !g.allowed && g.reasons.includes('pending_report_on_bounty'), g);
    const bRepSibling = await mkBounty(pOld);
    g = await gate(bRepSibling, 'escalation', true);
    check('gate: pending report on another of the poster\'s bounties -> skipped', !g.allowed && g.reasons.includes('pending_report_on_poster'), g);
    await c.query(`UPDATE public.profiles SET stripe_identity_status = NULL WHERE id = $1`, [pOld]);

    // Escrow funded (v1 ledger row).
    const bFunded = await mkBounty(pNew, { title: 'Funded errand' });
    const funded = await savepoint('sp_escrow_probe', async () => {
      try {
        await c.query(`INSERT INTO public.wallet_transactions (user_id, bounty_id, type, amount, status) VALUES ($1, $2, 'escrow', 40, 'completed')`, [pNew, bFunded]);
        return await gate(bFunded, 'escalation', true);
      } catch (e) { return { error: e.message }; }
    });
    check('gate: escrow held on the bounty -> allowed', funded.allowed && funded.credibility.includes('escrow_funded'), funded);

    // Human approval.
    await asRole('authenticated', { sub: h2, role: 'authenticated', app_metadata: { role: 'admin' } }, async () => {
      await c.query(`SELECT public.admin_moderation_transition($1, 'approved', 'first-bounty review')`, [bNew]);
    });
    g = await gate(bNew, 'escalation', true);
    check('gate: human-approved bounty from new poster -> allowed', g.allowed && g.credibility.includes('human_approved'), g);

    const dec = await q(`SELECT path, decision, reasons, eval_count FROM public.bounty_distribution_decisions WHERE bounty_id = $1 ORDER BY path, decision`, [bNew]);
    check('decisions recorded with reasons (skipped and later allowed both kept)',
      dec.some((d) => d.path === 'escalation' && d.decision === 'skipped' && d.reasons.includes('no_credibility_signal'))
      && dec.some((d) => d.path === 'escalation' && d.decision === 'allowed'), dec);

    // --- 3. escalator end-to-end -------------------------------------------
    await savepoint('sp_escalate', async () => {
      const bE1 = await mkBounty(pNew, { title: 'Escalation: new poster clean' });
      const bE2 = await mkBounty(pDone, { title: 'Escalation: credible poster clean' });
      const bE3 = await mkBounty(pDone, { title: SCAMS[0][1], description: SCAMS[0][2] });
      const ids = [bE1, bE2, bE3];
      await c.query(`UPDATE public.bounties SET liquidity_stage = 1, created_at = now() - interval '3 hours', liquidity_last_escalated_at = NULL WHERE id = ANY($1)`, [ids]);
      await c.query(`SELECT public.fn_escalate_stale_bounty_liquidity()`);
      const sent = await q(`SELECT bounty_id, count(*)::int n FROM public.bounty_hunter_notifications WHERE bounty_id = ANY($1) AND stage = 2 GROUP BY 1`, [ids]);
      const n = (id) => sent.find((r) => r.bounty_id === id)?.n ?? 0;
      check('escalator: credible clean bounty pushed', n(bE2) > 0, { pushed: n(bE2) });
      check('escalator: scam from credible poster NOT pushed', n(bE3) === 0, { pushed: n(bE3) });
      check('escalator: new-poster clean bounty NOT pushed (awaits review)', n(bE1) === 0, { pushed: n(bE1) });
      const st = await q(`SELECT id, liquidity_stage, liquidity_last_escalated_at IS NOT NULL stamped FROM public.bounties WHERE id = ANY($1)`, [ids]);
      const s1 = st.find((r) => r.id === bE1);
      check('escalator: skipped bounty not advanced or stamped (re-evaluated next run)', s1.liquidity_stage === 1 && !s1.stamped, s1);
      const alert = await one(`SELECT threshold_key, severity, fanned_out_at FROM public.moderation_alerts WHERE alert_key = $1`, [`escalation_review:${bE1}`]);
      check('escalator: escalation_review alert raised for the clean new-poster bounty', alert && alert.fanned_out_at === null, alert);
      const noAlert = await one(`SELECT count(*)::int n FROM public.moderation_alerts WHERE alert_key = $1`, [`escalation_review:${bE3}`]);
      check('escalator: no review alert for a listing skipped on safety grounds', noAlert.n === 0, noAlert);
      // Approve, then the next run pushes it.
      await asRole('authenticated', { sub: h2, role: 'authenticated', app_metadata: { role: 'admin' } }, async () => {
        await c.query(`SELECT public.admin_moderation_transition($1, 'approved', 'first-bounty review')`, [bE1]);
      });
      await c.query(`SELECT public.fn_escalate_stale_bounty_liquidity()`);
      const after = await one(`SELECT count(*)::int n FROM public.bounty_hunter_notifications WHERE bounty_id = $1 AND stage = 2`, [bE1]);
      check('escalator: approved bounty escalates on the next run', after.n > 0, after);
      const reasons = await q(`SELECT b.title, d.decision, d.reasons FROM public.bounty_distribution_decisions d JOIN public.bounties b ON b.id = d.bounty_id
                               WHERE d.bounty_id = ANY($1) AND d.path = 'escalation' ORDER BY b.title, d.decision`, [ids]);
      console.log('      escalation decisions:', JSON.stringify(reasons));
    });

    // --- 4. insert-time pushes ---------------------------------------------
    await savepoint('sp_insert_push', async () => {
      const clean = await mkBounty(pNew, { title: 'Zip clean', workType: 'in_person', zip: '99001' });
      const scam = await mkBounty(pNew, { title: SCAMS[0][1], description: SCAMS[0][2], workType: 'in_person', zip: '99001' });
      const ob = await q(`SELECT bounty_id FROM public.notifications_outbox WHERE bounty_id = ANY($1)`, [[clean, scam]]);
      check('zip push: clean new-poster bounty notifies the matching hunter', ob.some((r) => r.bounty_id === clean), ob);
      check('zip push: scam suppressed at insert', !ob.some((r) => r.bounty_id === scam), ob);
      const d = await one(`SELECT decision, reasons FROM public.bounty_distribution_decisions WHERE bounty_id = $1 AND path = 'zip'`, [scam]);
      check('zip push: skip recorded with reason', d && d.decision === 'skipped' && d.reasons.includes('moderation_flagged'), d);
      const geoScam = await mkBounty(pNew, { title: SCAMS[3][1], description: SCAMS[3][2] + ' ' + SCAMS[5][2], workType: 'in_person', lat: 37.79, lng: -122.4 });
      const rd = await q(`SELECT path, decision, reasons FROM public.bounty_distribution_decisions WHERE bounty_id = $1 ORDER BY path`, [geoScam]);
      check('radius + service-area pushes: scam skipped on both paths',
        rd.filter((r) => ['radius', 'service_area'].includes(r.path) && r.decision === 'skipped').length === 2, rd);
      const testB = await mkBounty(pNew, { title: 'is_test bounty', zip: '99001', isTest: true });
      const td = await one(`SELECT count(*)::int n FROM public.bounty_distribution_decisions WHERE bounty_id = $1`, [testB]);
      check('is_test bounty short-circuits before the gate (unchanged)', td.n === 0, td);
    });

    // --- 5. reports ---------------------------------------------------------
    const insertReportAs = async (reporter, type, id, reason = 'fraud', createdAt = null) =>
      asRole('authenticated', { sub: reporter, role: 'authenticated' }, async () =>
        (await one(`INSERT INTO public.reports (reporter_id, content_type, content_id, reason, status${createdAt ? ', created_at' : ''})
                    VALUES ($1, $2, $3, $4, 'pending'${createdAt ? ', $5' : ''}) RETURNING id`,
          createdAt ? [reporter, type, id, reason, createdAt] : [reporter, type, id, reason])).id);

    const rNew = await mkBounty(pNew, { title: 'Reported, new poster' });
    await c.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: h3, role: 'authenticated' })]);
    await c.query(`INSERT INTO public.bounty_requests (bounty_id, poster_id, hunter_id, status) VALUES ($1, $2, $3, 'pending')`, [rNew, pNew, h3]);
    await c.query(`SELECT set_config('request.jwt.claims', '', true)`);
    const rid1 = await insertReportAs(h1, 'bounty', rNew);
    check('report (as authenticated client) on a <7d poster -> under_review', (await modState(rNew)) === 'under_review');
    const ev = await one(`SELECT actor, reason, metadata FROM public.bounty_moderation_events WHERE bounty_id = $1 AND to_state = 'under_review'`, [rNew]);
    check('under_review event recorded with rule', ev && ev.actor === 'system' && ev.metadata.rule === 'report_on_new_poster', ev);
    const ra = await one(`SELECT threshold_key, fanned_out_at FROM public.moderation_alerts WHERE alert_key = $1`, [`report_threshold:${rNew}`]);
    check('admin alert queued for report-driven review', ra && ra.fanned_out_at === null, ra);

    // Visibility as each role.
    const visible = async (who, claims) => asRole('authenticated', claims, async () =>
      (await q(`SELECT id FROM public.bounties WHERE id = $1`, [rNew])).length === 1);
    check('feed hold: random hunter cannot see the reviewed listing', !(await visible('h2', { sub: h2, role: 'authenticated' })));
    check('feed hold: reporter cannot see it either', !(await visible('h1', { sub: h1, role: 'authenticated' })));
    check('feed hold: poster still sees own listing', await visible('poster', { sub: pNew, role: 'authenticated' }));
    check('feed hold: existing applicant still sees it', await visible('h3', { sub: h3, role: 'authenticated' }));
    check('feed hold: admin sees it', await visible('admin', { sub: h2, role: 'authenticated', app_metadata: { role: 'admin' } }));
    const pendingApps = await one(`SELECT count(*)::int n FROM public.bounty_requests WHERE bounty_id = $1 AND status = 'pending'`, [rNew]);
    check('under_review does NOT auto-reject pending applications (unlike archive)', pendingApps.n === 1, pendingApps);
    const feedAsHunter = await asRole('authenticated', { sub: h2, role: 'authenticated' }, async () =>
      q(`SELECT id FROM public.bounties WHERE status = 'open' AND id = ANY($1)`, [[rNew, bDone, bScamTrusted, bMid]]));
    const feedIds = feedAsHunter.map((r) => r.id);
    check('feed hold: hunter feed keeps clean + sub-threshold listings, drops flagged and under_review',
      feedIds.includes(bDone) && feedIds.includes(bMid) && !feedIds.includes(bScamTrusted) && !feedIds.includes(rNew), feedIds.length);

    const rOld = await mkBounty(pOld, { title: 'Reported, established poster' });
    await insertReportAs(h1, 'bounty', rOld);
    check('1 report on an established poster -> stays visible', (await modState(rOld)) === null);
    await insertReportAs(h1, 'bounty', rOld, 'spam');
    check('same reporter twice -> still visible', (await modState(rOld)) === null);
    await insertReportAs(h2, 'bounty', rOld);
    check('2 distinct reporters -> under_review', (await modState(rOld)) === 'under_review');

    const selfB = await mkBounty(pNew, { title: 'Self-reported' });
    await insertReportAs(pNew, 'bounty', selfB);
    check('poster reporting own listing is ignored', (await modState(selfB)) === null);

    const pNew2 = await mkUser('pnew2', { ageDays: 3 });
    const pb1 = await mkBounty(pNew2, { title: 'Profile report A' });
    const pb2 = await mkBounty(pNew2, { title: 'Profile report B' });
    await insertReportAs(h2, 'profile', pNew2, 'harassment');
    check('report on a new poster\'s profile -> all their live listings under_review',
      (await modState(pb1)) === 'under_review' && (await modState(pb2)) === 'under_review');

    // Approval sticks against pre-approval reports; new reports re-open it.
    const pOld2 = await mkUser('pold2', { ageDays: 45 });
    const apB = await mkBounty(pOld2, { title: 'Approved after reports' });
    await insertReportAs(h1, 'bounty', apB, 'fraud', new Date(Date.now() - 3600e3).toISOString());
    await insertReportAs(h2, 'bounty', apB, 'fraud', new Date(Date.now() - 3500e3).toISOString());
    check('pre-approval: 2 reporters -> under_review', (await modState(apB)) === 'under_review');
    await asRole('authenticated', { sub: h2, role: 'authenticated', app_metadata: { role: 'admin' } }, async () => {
      await c.query(`SELECT public.admin_moderation_transition($1, 'approved', 'reviewed, legitimate')`, [apB]);
    });
    g = await gate(apB, 'escalation', true);
    check('gate: approval clears reports filed before it', g.allowed, g);
    await insertReportAs(h3, 'bounty', apB, 'fraud', new Date(Date.now() + 60e3).toISOString());
    check('after approval: 1 new report on an established poster -> stays approved', (await modState(apB)) === 'approved');
    const h4 = await mkUser('h4', { ageDays: 30 });
    await insertReportAs(h4, 'bounty', apB, 'fraud', new Date(Date.now() + 120e3).toISOString());
    check('after approval: 2 new distinct reporters -> under_review again', (await modState(apB)) === 'under_review');

    // --- 6. approval stickiness in moderation_apply_signals -----------------
    const flaggedThenApproved = bScamTrusted;
    await asRole('authenticated', { sub: h2, role: 'authenticated', app_metadata: { role: 'admin' } }, async () => {
      await c.query(`SELECT public.admin_moderation_transition($1, 'approved', 'false positive')`, [flaggedThenApproved]);
    });
    await c.query(`SELECT public.moderation_apply_signals($1, public.moderation_scan_content($2, $3), 'sweep')`,
      [flaggedThenApproved, SCAMS[0][1], SCAMS[0][2]]);
    check('approved listing is NOT re-flagged when the sweep re-applies the same signals', (await modState(flaggedThenApproved)) === 'approved');
    await c.query(`SELECT public.moderation_apply_signals($1, $2::jsonb, 'sweep')`, [flaggedThenApproved,
      JSON.stringify([...(await scan(SCAMS[0][1], SCAMS[0][2])), { type: 'off_platform_payment', severity: 'high', weight: 3, evidence: {} }])]);
    check('approved listing IS re-flagged when a new signal type appears', (await modState(flaggedThenApproved)) === 'flagged');

    const lowB = await mkBounty(pDone, { title: 'Approved then low signal' });
    await asRole('authenticated', { sub: h2, role: 'authenticated', app_metadata: { role: 'admin' } }, async () => {
      await c.query(`SELECT public.admin_moderation_transition($1, 'approved', 'ok')`, [lowB]);
    });
    await c.query(`SELECT public.moderation_apply_signals($1, $2::jsonb, 'sweep')`, [lowB,
      JSON.stringify([{ type: 'employment_offer', severity: 'high', weight: 3, evidence: {} }])]);
    check('new sub-threshold signal after approval -> back to active (gate re-weighs it)', (await modState(lowB)) === 'active');

    // --- 7. sweep delivers alerts raised outside it, once ------------------
    const sweep1 = await q(`SELECT alert_key FROM public.run_moderation_sweep()`);
    const keys1 = sweep1.map((r) => r.alert_key);
    check('sweep returns report/escalation alerts raised outside the sweep',
      keys1.includes(`report_threshold:${rNew}`), keys1.filter((k) => /report_threshold|escalation_review|signal_score/.test(k)).length);
    const sweep2 = await q(`SELECT alert_key FROM public.run_moderation_sweep()`);
    check('sweep does not re-deliver alerts', !sweep2.some((r) => r.alert_key === `report_threshold:${rNew}`), sweep2.length);
    const preexisting = sweep1.filter((r) => !/:/.test(r.alert_key)).length;
    check('sweep sends no pre-migration backlog', preexisting === 0);
    const lastRun = await one(`SELECT succeeded, error FROM public.moderation_sweep_runs ORDER BY run_at DESC LIMIT 1`);
    check('sweep run recorded as succeeded', lastRun.succeeded === true, lastRun);
    const attB = await mkBounty(pNew, { title: 'Pic job', description: 'see pic', attachmentsJson: JSON.stringify([{ id: 'a' }]) });
    const attSig = await q(`SELECT signal_type FROM public.moderation_signals WHERE bounty_id = $1`, [attB]);
    check('insert trigger records details_in_attachment (+ details_withheld)',
      attSig.some((r) => r.signal_type === 'details_in_attachment'), attSig.map((r) => r.signal_type));

    // --- 8. report_submitted feed -------------------------------------------
    const pend = await q(`SELECT * FROM public.moderation_report_events_pending(500)`);
    const mine = pend.find((r) => r.report_id === rid1);
    check('report_submitted feed lists new reports with server-derived properties',
      mine && mine.moved_to_review === true && mine.poster_id === pNew && mine.bounty_id === rNew && mine.poster_account_age_days === 1, mine);
    const marked = await one(`SELECT public.moderation_mark_report_events_captured($1::uuid[]) n`, [pend.map((r) => r.report_id)]);
    const pend2 = await q(`SELECT * FROM public.moderation_report_events_pending(500)`);
    check('captured reports leave the feed', marked.n === pend.length && pend2.length === 0, { marked: marked.n, left: pend2.length });

    // --- 9. privileges --------------------------------------------------------
    for (const fn of ['fn_bounty_distribution_gate(uuid,text,smallint,boolean)', 'moderation_report_events_pending(integer)',
      'moderation_mark_report_events_captured(uuid[])', 'fn_bounty_credibility_signals(uuid)']) {
      const p = await one(`SELECT has_function_privilege('authenticated', 'public.${fn}', 'EXECUTE') a,
                                  has_function_privilege('anon', 'public.${fn}', 'EXECUTE') n`);
      check(`client roles cannot execute ${fn.split('(')[0]}`, !p.a && !p.n, p);
    }
    const decRead = await asRole('authenticated', { sub: h2, role: 'authenticated' }, async () =>
      (await q(`SELECT count(*)::int n FROM public.bounty_distribution_decisions`))[0].n);
    check('non-admin cannot read distribution decisions', decRead === 0, decRead);
    const reportInsertAnon = await savepoint('sp_anon_report', async () => {
      try {
        await asRole('anon', { role: 'anon' }, async () =>
          c.query(`INSERT INTO public.reports (reporter_id, content_type, content_id, reason) VALUES ($1, 'bounty', $2, 'fraud')`, [h2, rOld]));
        return 'inserted';
      } catch (e) { return e.message; }
    });
    check('anon cannot file reports (trigger cannot be driven anonymously)', reportInsertAnon !== 'inserted', reportInsertAnon);
  } catch (err) {
    check('unexpected error', false, err.message + (err.where ? ` @ ${err.where}` : ''));
  } finally {
    await c.query('ROLLBACK').catch(() => {});
  }

  // --- 10. rollback round-trip (separate transaction) ------------------------
  // The production rollback file restores production's live definitions. Apply
  // it first to put staging's touched objects into production's exact
  // pre-migration state, fingerprint, migrate, roll back, fingerprint again.
  try {
    await c.query('BEGIN');
    const rollbackSql = fs.readFileSync(ROLLBACK, 'utf8').replace(/^\s*BEGIN;\s*$/m, '').replace(/^\s*COMMIT;\s*$/m, '');
    const migrationSql = fs.readFileSync(MIGRATION, 'utf8').replace(/^\s*BEGIN;\s*$/m, '').replace(/^\s*COMMIT;\s*$/m, '');
    const fingerprint = async () => (await c.query(`
      SELECT
        (SELECT jsonb_object_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
                                 md5(pg_get_functiondef(p.oid)) || ' ' || coalesce(p.proacl::text, 'default'))
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.proname = ANY ($1)) AS functions,
        (SELECT jsonb_agg(policyname || ' ' || permissive || ' ' || cmd || ' ' || coalesce(qual, '') ORDER BY policyname)
           FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('bounties', 'reports')) AS policies,
        (SELECT jsonb_agg(pg_get_triggerdef(t.oid) ORDER BY t.tgname) FROM pg_trigger t
          WHERE t.tgrelid IN ('public.bounties'::regclass, 'public.reports'::regclass) AND NOT t.tgisinternal) AS triggers,
        (SELECT jsonb_agg(table_name || '.' || column_name ORDER BY table_name, column_name)
           FROM information_schema.columns WHERE table_schema = 'public'
            AND table_name IN ('moderation_alerts', 'reports')) AS columns,
        (SELECT jsonb_agg(indexname ORDER BY indexname) FROM pg_indexes
          WHERE schemaname = 'public' AND tablename IN ('moderation_alerts', 'reports')) AS indexes,
        to_regclass('public.bounty_distribution_decisions') IS NOT NULL AS decisions_table`,
      [TOUCHED_FUNCTIONS])).rows[0];

    await c.query(rollbackSql);
    const before = await fingerprint();
    const prodMatch = Object.entries(PROD_FUNCTION_MD5).filter(([name, md5]) =>
      !String(before.functions[name] || '').startsWith(md5));
    check('rollback restores production\'s exact live function bodies (md5 vs prod 2026-10-01)',
      prodMatch.length === 0, prodMatch.map(([n]) => n));
    await c.query(migrationSql);
    const during = await fingerprint();
    check('migration changes the fingerprint', JSON.stringify(during) !== JSON.stringify(before));
    await c.query(rollbackSql);
    const after = await fingerprint();
    const diff = Object.keys(before).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
    check('migrate -> rollback returns functions, ACLs, policies, triggers, columns, indexes exactly',
      diff.length === 0, diff.length ? diff.map((k) => ({ k, before: before[k], after: after[k] })) : 'identical');
  } catch (err) {
    check('rollback round-trip', false, err.message + (err.where ? ` @ ${err.where}` : ''));
  } finally {
    await c.query('ROLLBACK').catch(() => {});
    await c.end();
  }

  if (warnings.length) {
    console.log(`\nPostgres warnings (${warnings.length}):\n  ` + [...new Set(warnings)].slice(0, 20).join('\n  '));
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed (rolled back; nothing persisted)`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
