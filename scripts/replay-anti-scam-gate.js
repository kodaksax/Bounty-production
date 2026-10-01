/* scripts/replay-anti-scam-gate.js
 *
 * READ-ONLY counterfactual replay of migration 20261001140000 against real
 * listings: "had the anti-scam gate and rules been live, what would have
 * happened?"
 *
 *   1. Every historical liquidity escalation ("Still looking for someone" /
 *      "This job still needs a hunter"), plus the audit's scam IDs: would the
 *      escalation gate have allowed the push at the moment it was sent?
 *   2. Every completed external bounty (false-positive check): new-rule hits,
 *      would it have been auto-flagged (hidden), and would its escalation /
 *      nearby push have been allowed?
 *   3. Every non-internal listing in the window: which new rules fire.
 *   4. Live impact on deploy: open listings that would be held from the feed.
 *
 * The scanner patterns are read verbatim from the migration file, so the
 * replay cannot drift from what ships. The gate is re-implemented as one
 * SELECT because a read-only transaction cannot create functions.
 *
 * Approximations: ID verification is the current value, funding counts if a
 * funding row existed before the push, behavioural sweep signals are ignored
 * (all err towards ALLOWING). Content is the listing's current text. Poster
 * account status is the CURRENT value, which errs towards BLOCKING for
 * accounts banned after the fact, so the escalation summary also reports the
 * result with account status excluded.
 *
 * Usage:
 *   node scripts/replay-anti-scam-gate.js --env staging|production [--days 90] [--json out.json]
 *
 * Runs inside BEGIN READ ONLY and refuses to continue unless Postgres
 * confirms the transaction is read-only. Writes nothing.
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const ROOT = path.resolve(__dirname, '..');
const MIGRATION = path.join(ROOT, 'supabase/migrations/20261001140000_anti_scam_distribution_gate.sql');
const opt = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : dflt;
};
const ENV = opt('--env');
const DAYS = Number(opt('--days', '90'));
const JSON_OUT = opt('--json');
// Escalated scam listings named in docs/trust-spine-audit-2026-09-30.md (T1),
// plus 1bf6eaeb (title now NULL) and the one legitimate escalation, 11af999b.
const AUDIT_SCAMS = ['0b9e1e8a', '2f98b41e', 'c1c869bb', '68bc744d', 'd97dd373', '22dd1d10', '4554d92a'];
const AUDIT_OTHER = { '1bf6eaeb': 'escalated, title now NULL', '11af999b': 'legitimate escalation (Run to the store)' };

if (!['staging', 'production'].includes(ENV)) {
  console.error('usage: node scripts/replay-anti-scam-gate.js --env staging|production [--days 90] [--json out.json]');
  process.exit(2);
}

function candidateUrls() {
  const env = fs.readFileSync(path.join(ROOT, `.env.${ENV}`), 'utf8');
  const raw = env.match(/^\s*DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m)[1].trim();
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

/** The VALUES list inside moderation_scan_content, verbatim from the migration. */
function scannerRulesSql() {
  const src = fs.readFileSync(MIGRATION, 'utf8');
  const start = src.indexOf('SELECT * FROM (VALUES');
  const end = src.indexOf(') AS t(signal_type, severity, weight, pattern)', start);
  if (start < 0 || end < 0) throw new Error('could not locate the scanner rules in the migration');
  return src.slice(start + 'SELECT * FROM ('.length, end).replace(/^\s*--.*$/gm, '');
}
const NEW_TYPES = ['payment_proxy', 'purchase_on_behalf', 'off_platform_channel', 'off_platform_payment',
  'employment_offer', 'recurring_pay_rate', 'details_withheld', 'details_in_attachment'];

async function main() {
  let client;
  let lastErr;
  for (const cs of candidateUrls()) {
    client = new Client({ connectionString: cs, ssl: { rejectUnauthorized: false } });
    try { await client.connect(); lastErr = null; break; } catch (e) { lastErr = e; await client.end().catch(() => {}); }
  }
  if (lastErr) throw lastErr;

  try {
    await client.query('BEGIN READ ONLY');
    const ro = (await client.query(`SELECT current_setting('transaction_read_only') v`)).rows[0].v;
    if (ro !== 'on') throw new Error('refusing to run: transaction is not read-only');

    const has = async (rel) => (await client.query(`SELECT to_regclass($1) IS NOT NULL ok`, [rel])).rows[0].ok;
    const hasPav = (await client.query(`SELECT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='bounties' AND column_name='payment_architecture_version') ok`)).rows[0].ok;
    const v2 = await has('public.bounty_payments');
    const v3 = await has('public.bounty_v3_funding');
    const pav = hasPav ? 'COALESCE(b.payment_architecture_version, 1)' : '1';

    // Gate evaluated "as of" t for listing b (poster = b.poster). Mirrors
    // fn_bounty_distribution_gate + fn_bounty_credibility_signals.
    const evalSql = `
      WITH rules(signal_type, severity, weight, pattern) AS (${scannerRulesSql()}),
      target AS (SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(bounty_id uuid, t timestamptz, cohort text, recipients int)),
      base AS (
        SELECT tg.cohort, tg.recipients, tg.t, b.id, b.title, b.status::text AS status, b.created_at,
               COALESCE(b.poster_id, b.user_id) AS poster, p.is_internal, p.account_status, p.deleted_at,
               p.created_at AS poster_created,
               (p.stripe_identity_status = 'verified' OR p.id_verification_status = 'verified') AS id_verified,
               lower(coalesce(b.title, '') || '  ' || coalesce(b.description, '')) AS txt,
               length(btrim(coalesce(b.description, ''))) AS desc_len,
               GREATEST(
                 CASE jsonb_typeof(b.attachments) WHEN 'array' THEN jsonb_array_length(b.attachments) ELSE 0 END,
                 CASE jsonb_typeof(b.attachments_json) WHEN 'array' THEN jsonb_array_length(b.attachments_json)
                      WHEN 'string' THEN CASE WHEN (b.attachments_json #>> '{}') ~ '^\\s*\\[\\s*\\{' THEN 1 ELSE 0 END
                      ELSE 0 END) AS n_attach,
               ${pav} AS pav
        FROM target tg JOIN public.bounties b ON b.id = tg.bounty_id
        LEFT JOIN public.profiles p ON p.id = COALESCE(b.poster_id, b.user_id)
      ),
      scanned AS (
        SELECT bs.*,
          COALESCE((SELECT jsonb_agg(jsonb_build_object('type', r.signal_type, 'weight', r.weight,
                      'match', substring(bs.txt from r.pattern)) ORDER BY r.weight DESC)
                    FROM rules r WHERE bs.txt ~* r.pattern), '[]'::jsonb)
          || CASE WHEN bs.n_attach > 0 AND bs.desc_len < 40
                  THEN jsonb_build_array(jsonb_build_object('type', 'details_in_attachment', 'weight', 1, 'match', 'attachments only'))
                  ELSE '[]'::jsonb END AS signals,
          (SELECT e.to_state FROM public.bounty_moderation_events e
            WHERE e.bounty_id = bs.id AND e.created_at <= bs.t ORDER BY e.created_at DESC LIMIT 1) AS state_at_t,
          (SELECT m.state FROM public.bounty_moderation m WHERE m.bounty_id = bs.id) AS state_now,
          EXISTS (SELECT 1 FROM public.reports r
                   WHERE r.content_type = 'bounty' AND r.content_id = bs.id
                     AND (r.created_at AT TIME ZONE 'UTC') <= bs.t
                     AND (r.status = 'pending' OR r.reviewed_at > bs.t)) AS report_bounty,
          EXISTS (SELECT 1 FROM public.reports r
                   WHERE (r.created_at AT TIME ZONE 'UTC') <= bs.t
                     AND (r.status = 'pending' OR r.reviewed_at > bs.t)
                     AND ((r.content_type = 'profile' AND r.content_id = bs.poster)
                       OR (r.content_type = 'bounty' AND r.content_id <> bs.id AND r.content_id IN (
                             SELECT o.id FROM public.bounties o WHERE COALESCE(o.poster_id, o.user_id) = bs.poster)))) AS report_poster,
          EXISTS (SELECT 1 FROM public.bounties c
                   WHERE c.status::text = 'completed' AND NOT COALESCE(c.is_test, false)
                     AND c.accepted_by IS NOT NULL AND c.accepted_by IS DISTINCT FROM COALESCE(c.poster_id, c.user_id)
                     AND (COALESCE(c.poster_id, c.user_id) = bs.poster OR c.accepted_by = bs.poster)
                     AND c.id <> bs.id AND c.updated_at <= bs.t) AS completed_tx,
          ((bs.pav = 1 AND EXISTS (SELECT 1 FROM public.wallet_transactions wt WHERE wt.bounty_id = bs.id
                                     AND wt.type = 'escrow' AND wt.status = 'completed' AND wt.created_at <= bs.t)
                       AND NOT EXISTS (SELECT 1 FROM public.wallet_transactions wt WHERE wt.bounty_id = bs.id
                                     AND wt.type IN ('refund', 'release') AND wt.status = 'completed' AND wt.created_at <= bs.t))
           ${v2 ? `OR (bs.pav = 2 AND EXISTS (SELECT 1 FROM public.bounty_payments bp WHERE bp.bounty_id = bs.id AND bp.created_at <= bs.t
                         AND bp.status IN ('authorized','captured','release_pending','released','refund_pending','refunded')))` : ''}
           ${v3 ? `OR (bs.pav = 3 AND EXISTS (SELECT 1 FROM public.bounty_v3_funding bf WHERE bf.bounty_id = bs.id AND bf.created_at <= bs.t
                         AND bf.state IN ('authorized','awaiting_hunter_onboarding','capturing','released','canceled','expired')))` : ''}
          ) AS escrow_funded
        FROM base bs
      )
      SELECT s.*,
        (SELECT COALESCE(sum((x ->> 'weight')::numeric), 0) FROM jsonb_array_elements(s.signals) x) AS score
      FROM scanned s`;

    const run = async (targets) => {
      if (targets.length === 0) return [];
      const rows = (await client.query(evalSql, [JSON.stringify(targets)])).rows;
      return rows.map((r) => {
        const score = Number(r.score);
        // Moderation state the listing would have had at t under the new rules.
        let state = r.state_at_t;
        if (state !== 'approved' && score >= 5 && (state === null || state === 'active')) state = 'flagged';
        const safety = [];
        if (!r.poster || r.deleted_at) safety.push('poster_missing');
        else if ((r.account_status || 'active') !== 'active') safety.push(`poster_account_${r.account_status}`);
        if (['flagged', 'under_review', 'hidden', 'removed'].includes(state)) safety.push(`moderation_${state}`);
        else if (state !== 'approved' && score >= 2) safety.push('unresolved_signals');
        if (r.report_bounty) safety.push('pending_report_on_bounty');
        if (r.report_poster) safety.push('pending_report_on_poster');
        const credibility = [
          r.completed_tx && 'completed_transaction',
          r.id_verified && 'id_verified',
          r.escrow_funded && 'escrow_funded',
          state === 'approved' && 'human_approved',
        ].filter(Boolean);
        const escalation = [...safety, ...(credibility.length ? [] : ['no_credibility_signal'])];
        return {
          id: r.id, short: r.id.slice(0, 8), cohort: r.cohort, recipients: r.recipients, t: r.t,
          title: r.title, status: r.status, state_now: r.state_now, is_internal: r.is_internal,
          poster_age_days_at_t: r.poster_created ? Math.floor((new Date(r.t) - new Date(r.poster_created)) / 864e5) : null,
          score, signals: r.signals, would_hide_from_feed: ['flagged', 'under_review', 'hidden', 'removed'].includes(state),
          escalation_allowed: escalation.length === 0, escalation_reasons: escalation,
          nearby_push_allowed: safety.length === 0, nearby_reasons: safety, credibility,
        };
      });
    };

    // 1. escalations
    const esc = (await client.query(`
      SELECT o.bounty_id::uuid AS bounty_id, min(o.created_at) AS t,
             sum(jsonb_array_length(o.recipients))::int AS recipients
        FROM public.notifications_outbox o
       WHERE o.title IN ('Still looking for someone', 'This job still needs a hunter')
         AND o.bounty_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         AND (o.created_at > now() - make_interval(days => $1)
              OR left(o.bounty_id, 8) = ANY ($2))
       GROUP BY 1`, [DAYS, [...AUDIT_SCAMS, ...Object.keys(AUDIT_OTHER)]])).rows;
    const escalations = await run(esc.map((r) => ({ ...r, cohort: 'escalated' })));
    const found = new Set(escalations.map((e) => e.short));
    const missing = [...AUDIT_SCAMS, ...Object.keys(AUDIT_OTHER)].filter((s) => !found.has(s));
    // Audit IDs with no outbox row (e.g. pruned): evaluate as of 2h after creation.
    const extra = missing.length ? (await client.query(
      `SELECT id AS bounty_id, created_at + interval '2 hours' AS t, NULL::int AS recipients FROM public.bounties WHERE left(id::text, 8) = ANY ($1)`,
      [missing])).rows : [];
    escalations.push(...(await run(extra.map((r) => ({ ...r, cohort: 'audit_id_no_outbox' })))));

    // 2. completed external bounties (false-positive cohort)
    const completed = (await client.query(`
      SELECT b.id AS bounty_id, b.created_at + interval '2 hours' AS t
        FROM public.bounties b JOIN public.profiles p ON p.id = COALESCE(b.poster_id, b.user_id)
       WHERE b.status::text = 'completed' AND NOT COALESCE(b.is_test, false) AND NOT COALESCE(p.is_internal, false)
         AND b.accepted_by IS NOT NULL AND b.accepted_by IS DISTINCT FROM COALESCE(b.poster_id, b.user_id)`)).rows;
    const legit = await run(completed.map((r) => ({ ...r, cohort: 'completed_external' })));

    // 3. all non-internal listings in the window
    const recent = (await client.query(`
      SELECT b.id AS bounty_id, b.created_at AS t
        FROM public.bounties b JOIN public.profiles p ON p.id = COALESCE(b.poster_id, b.user_id)
       WHERE NOT COALESCE(p.is_internal, false) AND NOT COALESCE(b.is_test, false)
         AND b.created_at > now() - make_interval(days => $1)`, [DAYS])).rows;
    const listings = await run(recent.map((r) => ({ ...r, cohort: 'recent_listing' })));

    // 4. live impact: open listings that would be held on deploy
    const open = (await client.query(`
      SELECT b.id AS bounty_id, now() AS t FROM public.bounties b
       WHERE b.status::text IN ('open', 'in_progress') AND NOT COALESCE(b.is_test, false)`)).rows;
    const live = await run(open.map((r) => ({ ...r, cohort: 'open_now' })));

    await client.query('ROLLBACK');

    // --- report -----------------------------------------------------------
    const fmt = (e) => `${e.short}  ${(e.title || '(no title)').slice(0, 48).padEnd(48)}  `;
    const newHits = (e) => e.signals.filter((s) => NEW_TYPES.includes(s.type)).map((s) => `${s.type}(${s.weight})`);
    console.log(`\n=== Replay against ${ENV} (read-only), window ${DAYS}d ===`);

    console.log(`\n1. Escalations (${escalations.length})`);
    for (const e of escalations.sort((a, b) => new Date(a.t) - new Date(b.t))) {
      const tag = AUDIT_SCAMS.includes(e.short) ? 'AUDIT-SCAM' : (AUDIT_OTHER[e.short] ? 'AUDIT' : '');
      console.log(`  ${e.escalation_allowed ? 'ALLOW' : 'BLOCK'}  ${fmt(e)}${String(e.recipients ?? '-').padStart(3)} reached  ${tag.padEnd(10)} ${e.escalation_reasons.join(',') || 'credibility: ' + e.credibility.join(',')}${newHits(e).length ? '  [' + newHits(e).join(' ') + ']' : ''}`);
    }
    const auditRows = escalations.filter((e) => AUDIT_SCAMS.includes(e.short));
    console.log(`  -> audit scam IDs found: ${auditRows.length}/${AUDIT_SCAMS.length}; distributed under the gate: ${auditRows.filter((e) => e.escalation_allowed).length}`);
    const withoutStatus = (e) => e.escalation_reasons.filter((r) => !r.startsWith('poster_account_'));
    const contentOnly = (e) => e.nearby_reasons.filter((r) => !r.startsWith('poster_account_') && !r.startsWith('pending_report'));
    console.log(`  -> ignoring current account status: distributed ${auditRows.filter((e) => withoutStatus(e).length === 0).length}/${auditRows.length}; blocked by content signals alone ${auditRows.filter((e) => contentOnly(e).length > 0).length}/${auditRows.length}`);
    const laterRemoved = escalations.filter((e) => ['removed', 'hidden'].includes(e.state_now));
    console.log(`  -> escalations later removed/hidden by moderation: ${laterRemoved.length}; would still have escalated: ${laterRemoved.filter((e) => e.escalation_allowed).length}`);

    console.log(`\n2. Completed external bounties (false-positive check, ${legit.length})`);
    for (const e of legit) {
      console.log(`  ${e.would_hide_from_feed ? 'HIDDEN' : 'shown '}  esc:${e.escalation_allowed ? 'allow' : 'skip '}  near:${e.nearby_push_allowed ? 'allow' : 'skip '}  ${fmt(e)}${e.escalation_reasons.join(',')}${newHits(e).length ? '  [' + newHits(e).join(' ') + ']' : ''}`);
    }
    const fpContent = legit.filter((e) => e.signals.some((s) => NEW_TYPES.includes(s.type) && Number(s.weight) >= 2));
    console.log(`  -> new-rule content hits (weight >= 2): ${fpContent.length}/${legit.length}; would be hidden: ${legit.filter((e) => e.would_hide_from_feed).length}; nearby push blocked: ${legit.filter((e) => !e.nearby_push_allowed).length}; escalation skipped: ${legit.filter((e) => !e.escalation_allowed).length}`);

    console.log(`\n3. Non-internal listings in window (${listings.length}) with a new-rule hit`);
    for (const e of listings.filter((x) => newHits(x).length)) {
      console.log(`  ${e.would_hide_from_feed ? 'HIDDEN' : 'shown '}  ${fmt(e)}state_now=${e.state_now ?? '-'}  [${newHits(e).join(' ')}]`);
    }
    const reasonCounts = {};
    for (const e of listings) for (const r of e.escalation_reasons) reasonCounts[r] = (reasonCounts[r] || 0) + 1;
    console.log(`  -> escalation skip reasons across all ${listings.length} listings: ${JSON.stringify(reasonCounts)}`);

    console.log(`\n4. Open listings now (${live.length}) that the deploy would hold from the feed`);
    for (const e of live.filter((x) => x.would_hide_from_feed)) {
      console.log(`  HOLD  ${fmt(e)}state_now=${e.state_now ?? '-'}  score=${e.score}  [${e.signals.map((s) => s.type).join(' ')}]`);
    }

    if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify({ env: ENV, days: DAYS, escalations, legit, listings, live }, null, 1));
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    await client.end();
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
