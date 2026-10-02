/* scripts/verify-rating-integrity.js
 *
 * DB-level test suite for
 * supabase/migrations/20261002160000_rating_reputation_integrity.sql
 * (docs/security/rating-integrity-2026-10-02.md).
 *
 * Applies the migration inside ONE transaction on staging (unless it is
 * already applied), builds fixtures, attacks ratings as the real PostgREST
 * roles, and ALWAYS rolls back. Nothing persists.
 *
 * Attacks covered: forge a rating, rate a stranger, rate before completion
 * (in progress / status flipped with no approved work / no accepted
 * application), duplicate, edit (direct, via user_ratings, as service role),
 * delete (direct, via user_ratings), manipulate aggregates (bounty columns,
 * unverified / hidden / internal rows, service-role insert, backdating).
 *
 * Usage:
 *   node scripts/verify-rating-integrity.js            # staging (.env.staging)
 *
 * Refuses production. Exits non-zero if any check fails.
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const ROOT = path.resolve(__dirname, '..');
const MIGRATION = path.join(ROOT, 'supabase/migrations/20261002160000_rating_reputation_integrity.sql');
const ROLLBACK = path.join(ROOT, 'supabase/rollbacks/staging/20261002160000_rating_reputation_integrity.down.sql');
const ENV = (process.argv.find((a) => a.startsWith('--env=')) || '--env=staging').slice(6);
if (ENV !== 'staging') {
  console.error('verify-rating-integrity only runs against staging (it applies DDL inside a transaction).');
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

async function main() {
  const c = await connect();
  const q = async (sql, params) => (await c.query(sql, params)).rows;
  const one = async (sql, params) => (await q(sql, params))[0];
  let sp = 0;
  // Run fn in a savepoint. keep=true releases it on success (effects stay for
  // later checks); failures always roll back to it. Returns {ok, rows|code, msg}.
  const attempt = async (fn, { keep = false } = {}) => {
    const name = `sp_${++sp}`;
    await c.query(`SAVEPOINT ${name}`);
    try {
      const rows = await fn();
      if (keep) await c.query(`RELEASE SAVEPOINT ${name}`);
      else await c.query(`ROLLBACK TO SAVEPOINT ${name}`);
      return { ok: true, rows };
    } catch (err) {
      await c.query(`ROLLBACK TO SAVEPOINT ${name}`);
      return { ok: false, code: err.code, msg: err.message };
    }
  };
  // SET LOCAL inside a savepoint is undone by ROLLBACK TO SAVEPOINT, and a
  // RELEASEd one keeps it -- so always reset explicitly on the success path.
  const as = (role, uid, fn, extraClaims = {}) => async () => {
    await c.query(`SET LOCAL ROLE ${role}`);
    await c.query(`SELECT set_config('request.jwt.claims', $1, true)`,
      [JSON.stringify(uid ? { sub: uid, role, ...extraClaims } : { role, ...extraClaims })]);
    const rows = await fn();
    await c.query('RESET ROLE');
    await c.query(`SELECT set_config('request.jwt.claims', '', true)`);
    return rows;
  };
  const insertRating = (uid, { bounty, from, to, rating = 5, comment = null, createdAt = null }) =>
    as('authenticated', uid, () => q(
      `INSERT INTO public.ratings (bounty_id, from_user_id, to_user_id, rating, comment${createdAt ? ', created_at' : ''})
       VALUES ($1, $2, $3, $4, $5${createdAt ? ', $6' : ''}) RETURNING *`,
      createdAt ? [bounty, from, to, rating, comment, createdAt] : [bounty, from, to, rating, comment]));
  const denied = (r) => !r.ok && ['42501', '23514', '23505'].includes(r.code);

  try {
    await c.query('BEGIN');
    await c.query("SET LOCAL statement_timeout = '300s'");

    const applied = await one(`SELECT to_regprocedure('public.fn_rating_counts_toward_reputation(timestamptz,timestamptz,uuid,uuid,uuid)') IS NOT NULL AS ok`);
    const preRows = (await one(`SELECT count(*)::int n FROM public.ratings`)).n;
    if (!applied.ok) {
      const sql = fs.readFileSync(MIGRATION, 'utf8').replace(/^\s*BEGIN;\s*$/m, '').replace(/^\s*COMMIT;\s*$/m, '');
      await c.query(sql);
      check('migration applies cleanly (inside this transaction)', true);
    } else {
      console.log('(migration already applied on staging -- testing the live objects)');
    }
    const legacyUntouched = await one(`SELECT count(*)::int n FROM public.ratings WHERE verification_source IS DISTINCT FROM 'legacy_backfill' AND verified_at IS NOT NULL AND created_at < now() - interval '1 minute'`);
    if (!applied.ok) {
      check('existing rows are not verified by the migration itself (no silent backfill)', legacyUntouched.n === 0, legacyUntouched);
    }

    // Fixture plumbing only: escrow/funding/posting-fee triggers are not under test.
    for (const t of ['trg_bounties_reserve_escrow', 'trg_bounties_enforce_funding_before_work', 'trg_bounties_consume_posting_checkout',
      'trg_bounties_enforce_posting_policy', 'trg_bounties_enforce_posting_policy_on_update',
      'trg_bounty_request_require_id_verified', 'trg_bounty_request_require_open']) {
      const exists = await one(`SELECT 1 AS x FROM pg_trigger WHERE tgname = $1 AND NOT tgisinternal`, [t]);
      if (exists) await c.query(`ALTER TABLE ${t.startsWith('trg_bounty_request') ? 'public.bounty_requests' : 'public.bounties'} DISABLE TRIGGER ${t}`);
    }
    await c.query(`SELECT set_config('app.bypass_profile_guard', 'on', true)`);

    // --- fixtures -----------------------------------------------------------
    const stamp = Date.now();
    const mkUser = async (label, { internal = false, status = 'active' } = {}) => (await one(`WITH u AS (
        INSERT INTO auth.users (id, aud, role, email, created_at, updated_at)
        VALUES (gen_random_uuid(), 'authenticated', 'authenticated', $1, now(), now()) RETURNING id)
      INSERT INTO public.profiles (id, username, is_internal, account_status)
      SELECT id, $2, $3, $4 FROM u RETURNING id`,
      [`ratings+${label}+${stamp}@example.test`, `rt_${label}_${stamp % 1e7}`, internal, status])).id;

    // stage: 'open' | 'in_progress' | 'completed' | 'flipped' (completed, no approved work)
    //        | 'no_application' (completed + approved, accepted_by never applied) | 'archived' | 'deleted'
    const mkBounty = async (poster, hunter, stage) => {
      const b = (await one(`INSERT INTO public.bounties (title, description, amount, is_for_honor, poster_id, user_id, status, work_type)
        VALUES ($1, 'Ratings integrity fixture', 0, true, $2, $2, 'open', 'online') RETURNING id`, [`rt ${stage} ${stamp}`, poster])).id;
      if (stage === 'open') return b;
      let reqId = null;
      if (stage !== 'no_application') {
        reqId = (await one(`INSERT INTO public.bounty_requests (bounty_id, hunter_id, poster_id, status)
          VALUES ($1, $2, $3, 'accepted') RETURNING id`, [b, hunter, poster])).id;
      }
      await c.query(`UPDATE public.bounties SET accepted_by = $2, accepted_request_id = $3, status = 'in_progress' WHERE id = $1`, [b, hunter, reqId]);
      if (stage === 'in_progress') return b;
      if (stage !== 'flipped') {
        await c.query(`INSERT INTO public.completion_submissions (bounty_id, hunter_id, message, status) VALUES ($1, $2, 'done', 'approved')`, [b, hunter]);
      }
      await c.query(`UPDATE public.bounties SET status = 'completed' WHERE id = $1`, [b]);
      if (stage === 'archived' || stage === 'deleted') await c.query(`UPDATE public.bounties SET status = $2 WHERE id = $1`, [b, stage]);
      return b;
    };

    const P = await mkUser('poster');
    const H = await mkUser('hunter');
    const S = await mkUser('stranger');
    const SUSP = await mkUser('suspended');
    const I1 = await mkUser('internal1', { internal: true });
    const I2 = await mkUser('internal2', { internal: true });

    const bDone = await mkBounty(P, H, 'completed');
    const bProgress = await mkBounty(P, H, 'in_progress');
    const bFlipped = await mkBounty(P, H, 'flipped');
    const bNoApp = await mkBounty(P, S, 'no_application');
    const bOpen = await mkBounty(P, H, 'open');
    const bArchived = await mkBounty(P, H, 'archived');
    const bSusp = await mkBounty(P, SUSP, 'completed');
    const bInternal = await mkBounty(I1, I2, 'completed');
    const bLegacy = await mkBounty(P, S, 'completed');
    // Suspended after the fact: the transaction is real, the account is not active.
    await c.query(`UPDATE public.profiles SET account_status = 'suspended' WHERE id = $1`, [SUSP]);

    const stats = async (uid) => one(`SELECT rating_avg::float8 avg, rating_count n FROM public.get_profile_activity_stats($1)`, [uid]);
    const batch = async (uid) => one(`SELECT rating_avg::float8 avg, rating_count n FROM public.get_profile_activity_stats_batch(ARRAY[$1::uuid])`, [uid]);
    const reviews = async (uid) => q(`SELECT * FROM public.get_user_reviews($1, 50, 0)`, [uid]);

    // --- legitimate ratings -------------------------------------------------
    let r = await attempt(insertRating(P, { bounty: bDone, from: P, to: H, rating: 4, comment: '  Great work  ', createdAt: '2020-01-01T00:00:00Z' }), { keep: true });
    check('poster rates accepted hunter after completion', r.ok, r.msg);
    const pr = r.ok ? r.rows[0] : {};
    check('server stamps rater_role=poster / verified_at / source=transaction_guard', pr.rater_role === 'poster' && pr.verified_at && pr.verification_source === 'transaction_guard', pr);
    check('client-supplied created_at (2020) is ignored -> now()', pr.created_at && new Date(pr.created_at).getUTCFullYear() >= 2026, pr.created_at);
    check('comment trimmed', pr.comment === 'Great work', pr.comment);

    r = await attempt(insertRating(H, { bounty: bDone, from: H, to: P, rating: 5 }), { keep: true });
    check('hunter rates poster after completion (hunter -> poster flow)', r.ok && r.rows[0].rater_role === 'hunter', r.ok ? r.rows[0].rater_role : r.msg);
    check('star-only rating stored with NULL comment', r.ok && r.rows[0].comment === null);

    r = await attempt(insertRating(P, { bounty: bArchived, from: P, to: H, rating: 3 }), { keep: true });
    check('rating allowed on archived-after-completion bounty', r.ok, r.msg);

    // --- forge ----------------------------------------------------------------
    r = await attempt(insertRating(P, { bounty: bDone, from: H, to: S, rating: 5 }));
    check('FORGE: write a rating in someone else\'s name -> denied', denied(r), r.code + ' ' + (r.msg || ''));
    r = await attempt(insertRating(S, { bounty: null, from: S, to: H, rating: 5 }));
    check('FORGE: rating with no bounty -> denied', denied(r), r.code);
    r = await attempt(as('service_role', null, () => q(`INSERT INTO public.ratings (bounty_id, from_user_id, to_user_id, rating) VALUES ($1, $2, $3, 5)`, [bOpen, S, H])));
    check('FORGE: service_role insert without a transaction -> denied by trigger', !r.ok && /rating_requires_completed_transaction/.test(r.msg), r.msg);
    r = await attempt(as('anon', null, () => q(`INSERT INTO public.ratings (bounty_id, from_user_id, to_user_id, rating) VALUES ($1, $2, $3, 5)`, [bDone, P, H])));
    check('FORGE: anon insert -> denied', denied(r), r.code);
    r = await attempt(insertRating(SUSP, { bounty: bSusp, from: SUSP, to: P, rating: 1 }));
    check('suspended account cannot rate even its own completed transaction', denied(r), r.code);

    // --- strangers -------------------------------------------------------------
    r = await attempt(insertRating(S, { bounty: bDone, from: S, to: H, rating: 1 }));
    check('STRANGER: non-participant rates the hunter -> denied', denied(r), r.code);
    r = await attempt(insertRating(P, { bounty: bDone, from: P, to: S, rating: 1 }));
    check('STRANGER: poster rates someone who was not the hunter -> denied', denied(r), r.code);
    r = await attempt(insertRating(P, { bounty: bDone, from: P, to: P, rating: 5 }));
    check('SELF: poster rates self -> denied', denied(r), r.code);
    r = await attempt(insertRating(P, { bounty: bNoApp, from: P, to: S, rating: 5 }));
    check('STRANGER: accepted_by never applied (no accepted application) -> denied', denied(r), r.code);

    // --- before completion ----------------------------------------------------
    r = await attempt(insertRating(P, { bounty: bOpen, from: P, to: H, rating: 5 }));
    check('BEFORE COMPLETION: open bounty -> denied', denied(r), r.code);
    r = await attempt(insertRating(P, { bounty: bProgress, from: P, to: H, rating: 1 }));
    check('BEFORE COMPLETION: in_progress bounty -> denied', denied(r), r.code);
    r = await attempt(insertRating(H, { bounty: bProgress, from: H, to: P, rating: 1 }));
    check('BEFORE COMPLETION: hunter on in_progress bounty -> denied', denied(r), r.code);
    r = await attempt(insertRating(P, { bounty: bFlipped, from: P, to: H, rating: 1 }));
    check('BEFORE COMPLETION: status flipped to completed with no approved work -> denied', denied(r), r.code);

    // --- score range ------------------------------------------------------------
    for (const bad of [0, 6, -1, 4.5]) {
      r = await attempt(insertRating(H, { bounty: bArchived, from: H, to: P, rating: bad }));
      check(`score ${bad} rejected`, !r.ok, r.code);
    }

    // --- duplicate ----------------------------------------------------------------
    r = await attempt(insertRating(P, { bounty: bDone, from: P, to: H, rating: 1 }));
    check('DUPLICATE: second rating for the same (bounty, rater, ratee) -> 23505', !r.ok && r.code === '23505', r.code);

    // --- edit ---------------------------------------------------------------------
    r = await attempt(as('authenticated', P, () => q(`UPDATE public.ratings SET rating = 1 WHERE id = $1 RETURNING id`, [pr.id])));
    check('EDIT: rater UPDATE -> denied', !r.ok && r.code === '42501', r.code);
    r = await attempt(as('authenticated', P, () => q(`UPDATE public.ratings SET hidden_at = now() WHERE id = $1 RETURNING id`, [pr.id])));
    check('EDIT: ratee/rater cannot hide a rating', !r.ok, r.code);
    const hasView = await one(`SELECT to_regclass('public.user_ratings') IS NOT NULL AS ok`);
    if (hasView.ok) {
      r = await attempt(as('authenticated', P, () => q(`UPDATE public.user_ratings SET score = 1 WHERE id = $1 RETURNING id`, [pr.id])));
      check('EDIT: via user_ratings (staging view bypass) -> denied', !r.ok && r.code === '42501', r.code);
      r = await attempt(as('anon', null, () => q(`INSERT INTO public.user_ratings (id) VALUES (gen_random_uuid())`)));
      check('FORGE: anon insert via user_ratings -> denied', !r.ok && r.code === '42501', r.code);
    }
    r = await attempt(as('service_role', null, () => q(`UPDATE public.ratings SET rating = 1 WHERE id = $1`, [pr.id])));
    check('EDIT: even service_role cannot change a rating\'s score', !r.ok && /ratings_are_immutable/.test(r.msg), r.msg);
    r = await attempt(as('service_role', null, () => q(`UPDATE public.ratings SET comment = 'edited' WHERE id = $1`, [pr.id])));
    check('EDIT: even service_role cannot change a review\'s text', !r.ok && /ratings_are_immutable/.test(r.msg), r.msg);
    r = await attempt(as('service_role', null, () => q(`UPDATE public.ratings SET to_user_id = $2 WHERE id = $1`, [pr.id, S])));
    check('EDIT: service_role cannot re-point a rating at another user', !r.ok && /ratings_are_immutable/.test(r.msg), r.msg);
    r = await attempt(as('service_role', null, () => q(`UPDATE public.ratings SET verified_at = NULL, verification_source = NULL, rater_role = NULL WHERE id = $1`, [pr.id])));
    check('a transaction_guard verification cannot be removed', !r.ok && /rating_verification_is_immutable/.test(r.msg), r.msg);

    // --- delete -------------------------------------------------------------------
    r = await attempt(as('authenticated', P, () => q(`DELETE FROM public.ratings WHERE id = $1 RETURNING id`, [pr.id])));
    check('DELETE: rater -> denied', !r.ok && r.code === '42501', r.code);
    r = await attempt(as('authenticated', H, () => q(`DELETE FROM public.ratings WHERE id = $1 RETURNING id`, [pr.id])));
    check('DELETE: ratee -> denied', !r.ok && r.code === '42501', r.code);
    if (hasView.ok) {
      r = await attempt(as('anon', null, () => q(`DELETE FROM public.user_ratings WHERE id = $1`, [pr.id])));
      check('DELETE: anon via user_ratings -> denied', !r.ok && r.code === '42501', r.code);
    }
    check('rating still present after all edit/delete attempts', (await one(`SELECT rating::int r, comment FROM public.ratings WHERE id = $1`, [pr.id]))?.r === 4);

    // --- aggregates -----------------------------------------------------------------
    let s = await stats(H);
    let rv = await reviews(H);
    check('stats: hunter has 2 verified ratings (4 + 3)', s.n === 2 && Math.abs(s.avg - 3.5) < 1e-9, s);
    check('batch stats agree with single stats', JSON.stringify(await batch(H)) === JSON.stringify(s));
    check('get_user_reviews lists exactly the counted ratings', rv.length === s.n, rv.length);
    check('review carries its transaction: bounty, rater, role, completion', rv.every((x) => x.bounty_id && x.rater_id === P && x.rater_role === 'poster'), rv.map((x) => [x.bounty_title, x.rater_role]));
    s = await stats(P);
    rv = await reviews(P);
    check('poster reputation: 1 rating from the hunter, listed even though star-only', s.n === 1 && rv.length === 1 && rv[0].comment === null && rv[0].rater_role === 'hunter', { s, rv: rv.map((x) => x.comment) });

    r = await attempt(as('authenticated', P, () => q(`UPDATE public.bounties SET average_rating = 5, rating_count = 99 WHERE id = $1 RETURNING id`, [bOpen])));
    check('AGGREGATE: poster cannot store a rating on their bounty row', !r.ok && r.code === '23514', r.code);

    // A legacy-style unverified rating (simulated: guard bypassed as the table owner).
    await c.query(`ALTER TABLE public.ratings DISABLE TRIGGER trg_ratings_guard`);
    const legacyId = (await one(`INSERT INTO public.ratings (bounty_id, from_user_id, to_user_id, rating, comment) VALUES (NULL, $1, $2, 5, 'synthetic') RETURNING id`, [S, H])).id;
    const legacyGood = (await one(`INSERT INTO public.ratings (bounty_id, from_user_id, to_user_id, rating) VALUES ($1, $2, $3, 2) RETURNING id`, [bLegacy, P, S])).id;
    await c.query(`ALTER TABLE public.ratings ENABLE TRIGGER trg_ratings_guard`);
    s = await stats(H);
    check('AGGREGATE: unattached legacy rating does not count', s.n === 2 && Math.abs(s.avg - 3.5) < 1e-9, s);
    r = await attempt(as('authenticated', P, () => q(`SELECT id FROM public.ratings WHERE id = $1`, [legacyId])));
    check('unattached rating invisible to other users (SELECT policy)', r.ok && r.rows.length === 0, r.rows?.length);
    r = await attempt(as('anon', null, () => q(`SELECT id FROM public.ratings WHERE id = $1`, [legacyId])));
    check('unattached rating invisible to anon', r.ok && r.rows.length === 0, r.rows?.length);
    r = await attempt(as('authenticated', S, () => q(`SELECT id FROM public.ratings WHERE id = $1`, [legacyId])));
    check('rater still sees their own unverified rating', r.ok && r.rows.length === 1, r.rows?.length);
    r = await attempt(as('authenticated', S, () => q(`SELECT id FROM public.ratings WHERE id = $1`, [pr.id])));
    check('verified reputation rating visible to everyone', r.ok && r.rows.length === 1);

    // Old shipped clients average whatever SELECT returns -- that now equals the RPC.
    // (Viewer with no ratings of their own: a rater also sees their own rows.)
    r = await attempt(as('authenticated', I1, () => q(`SELECT count(*)::int n, avg(rating)::float8 a FROM public.ratings WHERE to_user_id = $1`, [H])));
    check('AGGREGATE: a shipped client averaging raw rows gets the same figure as the RPC', r.ok && r.rows[0].n === 2 && Math.abs(r.rows[0].a - 3.5) < 1e-9, r.rows?.[0]);

    r = await attempt(insertRating(I1, { bounty: bInternal, from: I1, to: I2, rating: 5 }), { keep: true });
    check('internal pair can rate (it is a real transaction)', r.ok, r.msg);
    s = await stats(I2);
    check('AGGREGATE: internal<->internal rating excluded from reputation', s.n === 0 && s.avg === null, s);

    r = await attempt(as('service_role', null, () => q(`UPDATE public.ratings SET hidden_at = now(), hidden_reason = 'test' WHERE id = $1`, [pr.id])), { keep: true });
    check('admin (service_role) can hide a review', r.ok, r.msg);
    s = await stats(H);
    check('AGGREGATE: hidden review drops out of count and list', s.n === 1 && (await reviews(H)).length === 1, s);

    // --- caller rating status ------------------------------------------------------------
    const status = async (uid, b) => (await attempt(as('authenticated', uid, () => q(`SELECT * FROM public.get_my_rating_status($1)`, [b])))).rows || [];
    let st = await status(H, bArchived);
    check('status: hunter on completed bounty -> eligible, not yet rated, ratee = poster', st.length === 1 && st[0].rater_role === 'hunter' && st[0].eligible && !st[0].already_rated && st[0].ratee_id === P, st);
    st = await status(H, bDone);
    check('status: hunter already rated -> already_rated', st.length === 1 && st[0].already_rated, st);
    st = await status(H, bProgress);
    check('status: in progress -> not eligible', st.length === 1 && !st[0].eligible, st);
    st = await status(S, bDone);
    check('status: stranger -> no row', st.length === 0, st);
    r = await attempt(as('anon', null, () => q(`SELECT * FROM public.get_my_rating_status($1)`, [bDone])));
    check('status RPC not executable by anon', !r.ok && r.code === '42501', r.code);
    r = await attempt(as('authenticated', S, () => q(`SELECT * FROM public.admin_verify_legacy_ratings(true)`)));
    check('legacy backfill not executable by authenticated', !r.ok && r.code === '42501', r.code);

    // --- legacy treatment ------------------------------------------------------------------
    const before = await one(`SELECT md5(string_agg(id::text || rating::text || coalesce(comment,'') || coalesce(bounty_id::text,'') || coalesce(from_user_id::text,'') || to_user_id::text || created_at::text, ',' ORDER BY id)) h FROM public.ratings`);
    const dry = await q(`SELECT * FROM public.admin_verify_legacy_ratings(true)`);
    const dryWrote = await one(`SELECT count(*)::int n FROM public.ratings WHERE verification_source = 'legacy_backfill'`);
    check('legacy dry run writes nothing', dryWrote.n === 0 && dry.every((x) => !x.applied), dryWrote);
    const byOutcome = dry.reduce((m, x) => ({ ...m, [x.outcome]: (m[x.outcome] || 0) + 1 }), {});
    console.log('      dry-run outcomes (staging rows + fixtures):', JSON.stringify(byOutcome));
    check('dry run: fixture legacy row on a completed transaction -> verify', dry.find((x) => x.rating_id === legacyGood)?.outcome === 'verify');
    check('dry run: fixture with no bounty -> exclude:no_bounty', dry.find((x) => x.rating_id === legacyId)?.outcome === 'exclude:no_bounty');
    const real = await q(`SELECT * FROM public.admin_verify_legacy_ratings(false)`);
    const stampedN = real.filter((x) => x.applied).length;
    check('apply stamps exactly the verify rows', stampedN === dry.filter((x) => x.outcome === 'verify').length, stampedN);
    s = await stats(S);
    check('verified legacy rating now counts', s.n === 1, s);
    const after = await one(`SELECT md5(string_agg(id::text || rating::text || coalesce(comment,'') || coalesce(bounty_id::text,'') || coalesce(from_user_id::text,'') || to_user_id::text || created_at::text, ',' ORDER BY id)) h FROM public.ratings`);
    check('legacy treatment changes no rating content (md5 of content columns)', before.h === after.h);
    const reverted = (await one(`SELECT public.admin_revert_legacy_rating_verification() n`)).n;
    check('revert clears exactly the legacy stamps', reverted === stampedN && (await stats(S)).n === 0, reverted);
    check('revert leaves transaction_guard ratings verified', (await stats(H)).n === 1);
    check('row count unchanged by the whole suite except fixtures', (await one(`SELECT count(*)::int n FROM public.ratings`)).n === preRows + 6);
  } catch (err) {
    check('suite ran to completion', false, err.message + (err.where ? ` @ ${err.where}` : ''));
  }

  // --- rollback round-trip (only meaningful when the migration was applied here) --
  try {
    await c.query('ROLLBACK');
    await c.query('BEGIN');
    const applied = await one(`SELECT to_regprocedure('public.fn_rating_counts_toward_reputation(timestamptz,timestamptz,uuid,uuid,uuid)') IS NOT NULL AS ok`);
    const fingerprint = async () => one(`SELECT
        (SELECT jsonb_agg(jsonb_build_array(policyname, cmd, roles::text, qual, with_check) ORDER BY policyname) FROM pg_policies WHERE tablename IN ('ratings','user_ratings')) policies,
        (SELECT jsonb_agg(grantee || ':' || privilege_type ORDER BY grantee, privilege_type) FROM information_schema.role_table_grants WHERE table_name IN ('ratings','user_ratings') AND grantee IN ('anon','authenticated')) grants,
        (SELECT jsonb_agg(conname ORDER BY conname) FROM pg_constraint WHERE conrelid IN ('public.ratings'::regclass, 'public.bounties'::regclass) AND conname LIKE ANY (ARRAY['ratings_%','bounties_no_stored_rating'])) cons,
        (SELECT jsonb_agg(column_name ORDER BY column_name) FROM information_schema.columns WHERE table_schema='public' AND table_name='ratings') cols,
        (SELECT jsonb_agg(tgname ORDER BY tgname) FROM pg_trigger WHERE tgrelid='public.ratings'::regclass AND NOT tgisinternal) trg,
        (SELECT jsonb_agg(md5(pg_get_functiondef(p.oid)) ORDER BY p.proname) FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname IN ('get_profile_activity_stats','get_profile_activity_stats_batch')) fns`);
    const migrationSql = fs.readFileSync(MIGRATION, 'utf8').replace(/^\s*BEGIN;\s*$/m, '').replace(/^\s*COMMIT;\s*$/m, '');
    const rollbackSql = fs.readFileSync(ROLLBACK, 'utf8').replace(/^\s*BEGIN;\s*$/m, '').replace(/^\s*COMMIT;\s*$/m, '');
    if (applied.ok) {
      // live = post-migration: rollback, re-apply, compare with live
      const live = await fingerprint();
      await c.query(rollbackSql);
      const down = await fingerprint();
      check('rollback removes the migration objects', JSON.stringify(down) !== JSON.stringify(live));
      await c.query(migrationSql);
      const up = await fingerprint();
      const diff = Object.keys(live).filter((k) => JSON.stringify(live[k]) !== JSON.stringify(up[k]));
      check('rollback -> re-apply returns to the live state exactly', diff.length === 0, diff);
    } else {
      const before = await fingerprint();
      await c.query(migrationSql);
      const during = await fingerprint();
      check('migration changes the fingerprint', JSON.stringify(during) !== JSON.stringify(before));
      await c.query(rollbackSql);
      const after = await fingerprint();
      const diff = Object.keys(before).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
      check('migrate -> rollback restores policies, grants, constraints, columns, triggers, stats fns exactly',
        diff.length === 0, diff.length ? diff.map((k) => ({ k, before: before[k], after: after[k] })) : 'identical');
    }
  } catch (err) {
    check('rollback round-trip', false, err.message + (err.where ? ` @ ${err.where}` : ''));
  } finally {
    await c.query('ROLLBACK').catch(() => {});
    await c.end();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed (rolled back; nothing persisted)`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
