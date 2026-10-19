/* scripts/verify-posting-quality-rules.js
 *
 * Staging check for supabase/migrations/20261019230000_posting_quality_rules.sql
 * (SBA-03, docs/audits/shoal-behavioral-audit.md).
 *
 * Runs in ONE transaction on staging and ALWAYS rolls back. Uses Shoal pool
 * posters (qa/shoal/README.md). Inside the transaction two of them are made
 * to look like external accounts (is_internal = false) and their join date is
 * moved, so the rules apply to them; all of that rolls back. Seeded bounties
 * are online or carry no coordinates, so no nearby-hunter match runs, and any
 * notification rows the inserts enqueue roll back with everything else.
 *
 * If the migration is not applied yet, it is applied inside the transaction.
 *
 *   fresh   shoal-poster-10   joined 1 hour ago, external
 *   older   shoal-poster-11   joined 30 days ago, external
 *   staff   shoal-poster-12   joined 1 hour ago, is_internal (unchanged)
 *
 * What it proves:
 *   1. The description switch ships OFF: an in-person bounty with no
 *      description is accepted.
 *   2. With the switch ON (as a poster through RLS): in-person needs 20+
 *      trimmed characters; padding doesn't count; exactly 20 passes; online
 *      is not checked; a client-sent is_test = true is not an exemption.
 *   3. New-account cap: a day-old-or-less account gets 2 open bounties, the
 *      third is refused with the composer's copy; a non-open bounty doesn't
 *      count; once the account is 24 h old the same insert succeeds.
 *   4. The service-role relay path (api/server.js, services/api) is held to
 *      the same rules.
 *   5. Internal accounts are exempt from both.
 *   6. The paid web intake (fn_create_bounty_from_pending) is exempt from
 *      both, and clients cannot call it.
 *   7. The trigger function is not callable by clients, and its errors are
 *      check_violation with the exact copy the app maps.
 *   8. The weekly "done when" query runs.
 *
 * Usage: PGSSLROOTCERT=/path/to/supabase-ca.crt node scripts/verify-posting-quality-rules.js
 *        (staging only)
 * Exits non-zero if any check fails.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Client } = require('pg');
const { candidateUrls } = require('./lib/ro-query');

const ROOT = path.resolve(__dirname, '..');
const MIGRATION = path.join(ROOT, 'supabase/migrations/20261019230000_posting_quality_rules.sql');
const WEEKLY = path.join(ROOT, 'scripts/ops/posting-quality-weekly.sql');
const STAGING_REF = 'gwumwpoomwvkjyibdmpj';

const ENV = (process.argv.find((a) => a.startsWith('--env=')) || '--env=staging').slice(6);
if (ENV !== 'staging') {
  console.error('verify-posting-quality-rules only runs against staging (it writes inside a rolled-back transaction).');
  process.exit(2);
}

const POSTERS = {
  fresh: 'qa+shoal-poster-10@bountyfinder.test',
  older: 'qa+shoal-poster-11@bountyfinder.test',
  staff: 'qa+shoal-poster-12@bountyfinder.test',
};
const DESCRIPTION_ERROR = 'In-person bounties need a description of at least 20 characters.';
const CAP_ERROR = 'New accounts can have 2 open bounties on their first day. You can post more tomorrow.';

let failures = 0;
function check(name, ok, detail) {
  if (ok) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail !== undefined ? ` -- ${JSON.stringify(detail)}` : ''}`);
  }
}

// Supabase's pooler presents a certificate signed by its own root CA:
// PGSSLROOTCERT=/path/to/supabase-ca.crt (Dashboard > Database > SSL Configuration).
async function connect() {
  const ca = process.env.PGSSLROOTCERT;
  const ssl = ca ? { rejectUnauthorized: true, ca: fs.readFileSync(ca, 'utf8') } : { rejectUnauthorized: true };
  let lastError;
  for (const connectionString of candidateUrls('staging')) {
    const c = new Client({ connectionString, ssl, connectionTimeoutMillis: 10000 });
    try {
      await c.connect();
      return c;
    } catch (err) {
      await c.end().catch(() => {});
      if (/self[- ]signed|unable to verify|certificate/i.test(err.message)) {
        throw new Error(`${err.message}\nSet PGSSLROOTCERT to Supabase's root CA.`);
      }
      lastError = err;
    }
  }
  throw lastError;
}

async function asRole(c, role, userId) {
  await c.query(`SET LOCAL ROLE ${role}`);
  await c.query("SELECT set_config('request.jwt.claims', $1, true)", [
    JSON.stringify(userId ? { sub: userId, role } : { role }),
  ]);
}

async function asOwner(c) {
  await c.query('RESET ROLE');
  await c.query("SELECT set_config('request.jwt.claims', '', true)");
}

/** Run a statement in a savepoint so an expected error doesn't abort the transaction. */
async function attempt(c, sql, params) {
  await c.query('SAVEPOINT attempt');
  try {
    const res = await c.query(sql, params);
    await c.query('RELEASE SAVEPOINT attempt');
    return { res };
  } catch (err) {
    await c.query('ROLLBACK TO SAVEPOINT attempt');
    return { err };
  }
}

let seq = 0;
/** Insert a bounty the way the app does (direct insert through RLS). */
function insertBounty(c, posterId, { workType = 'online', description = '', isTest = false } = {}) {
  seq += 1;
  return attempt(
    c,
    `INSERT INTO public.bounties (user_id, poster_id, title, description, amount, work_type, location, is_test, status)
     VALUES ($1, $1, $2, $3, 25, $4, $5, $6, 'open') RETURNING id`,
    [
      posterId,
      `[sba03-check] ${seq} ${workType}`,
      description,
      workType,
      workType === 'in_person' ? 'Baltimore, MD' : null,
      isTest,
    ],
  );
}

const refused = (r, message) => !!r.err && r.err.code === '23514' && r.err.message === message;
const err = (r) => (r.err ? { code: r.err.code, message: r.err.message } : 'accepted');

async function main() {
  const c = await connect();
  const user = c.connectionParameters.user || '';
  const host = c.connectionParameters.host || '';
  if (!user.includes(STAGING_REF) && !host.includes(STAGING_REF)) {
    await c.end();
    throw new Error(`refusing: connection is not staging (${user}@${host})`);
  }

  try {
    await c.query('BEGIN');

    // ── accounts ────────────────────────────────────────────────────────────
    const { rows: accounts } = await c.query(
      `SELECT u.email, p.id, p.is_internal,
              (SELECT count(*)::int FROM public.bounties b
                WHERE (b.poster_id = p.id OR b.user_id = p.id) AND b.status = 'open') AS open_n
       FROM auth.users u JOIN public.profiles p ON p.id = u.id WHERE u.email = ANY($1)`,
      [Object.values(POSTERS)],
    );
    const byEmail = Object.fromEntries(accounts.map((a) => [a.email, a]));
    const missing = Object.values(POSTERS).filter((e) => !byEmail[e]);
    if (missing.length) throw new Error(`pool accounts missing on staging: ${missing.join(', ')} (run qa/shoal/bin/seed.mjs accounts)`);
    console.log('\nAccounts');
    check('every account used is an internal pool account', accounts.every((a) => a.is_internal === true), accounts);
    check('the pool posters start with no open bounties', accounts.every((a) => a.open_n === 0), accounts);
    const fresh = byEmail[POSTERS.fresh].id;
    const older = byEmail[POSTERS.older].id;
    const staff = byEmail[POSTERS.staff].id;

    // ── migration state ─────────────────────────────────────────────────────
    const { rows: trig } = await c.query(
      "SELECT count(*)::int n FROM pg_trigger WHERE tgname = 'trg_bounties_enforce_posting_quality' AND tgrelid = 'public.bounties'::regclass",
    );
    console.log('\nMigration');
    if (trig[0].n === 0) {
      await c.query(fs.readFileSync(MIGRATION, 'utf8'));
      console.log('  info not applied on staging: applied inside this transaction');
    } else {
      console.log('  info already applied on staging');
    }

    const { rows: grants } = await c.query(
      `SELECT has_function_privilege('anon', 'public.fn_bounties_enforce_posting_quality()', 'EXECUTE') AS anon_trigger,
              has_function_privilege('authenticated', 'public.fn_bounties_enforce_posting_quality()', 'EXECUTE') AS auth_trigger,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_web_intake,
              has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_web_intake,
              (SELECT require_in_person_description FROM public.posting_policy_config WHERE id) AS switch_on,
              (SELECT proconfig FROM pg_proc WHERE proname = 'fn_bounties_enforce_posting_quality') AS cfg,
              (SELECT prosecdef FROM pg_proc WHERE proname = 'fn_bounties_enforce_posting_quality') AS secdef
       FROM pg_proc p WHERE p.proname = 'fn_create_bounty_from_pending'`,
    );
    const g = grants[0];
    check('trigger function is not executable by anon or authenticated', !g.anon_trigger && !g.auth_trigger, g);
    check('trigger function is SECURITY DEFINER with a fixed search_path',
      g.secdef === true && (g.cfg || []).some((s) => s.startsWith('search_path=')), g);
    check('fn_create_bounty_from_pending (the exempt path) is not callable by clients',
      !g.auth_web_intake && !g.anon_web_intake, g);
    check('description switch ships OFF', g.switch_on === false, g);

    // Make two pool posters look external; set join dates. All rolled back.
    await c.query(
      `UPDATE public.profiles SET is_internal = false, created_at = now() - interval '1 hour' WHERE id = $1`, [fresh]);
    await c.query(
      `UPDATE public.profiles SET is_internal = false, created_at = now() - interval '30 days' WHERE id = $1`, [older]);
    await c.query(
      `UPDATE public.profiles SET created_at = now() - interval '1 hour' WHERE id = $1`, [staff]);

    // ── 1. switch off ───────────────────────────────────────────────────────
    console.log('\nDescription rule, switch off (installed builds keep posting)');
    await asRole(c, 'authenticated', older);
    let r = await insertBounty(c, older, { workType: 'in_person', description: '' });
    check('in-person with no description is accepted while the switch is off', !r.err, err(r));
    await asOwner(c);

    // ── 2. switch on ────────────────────────────────────────────────────────
    await c.query('UPDATE public.posting_policy_config SET require_in_person_description = true WHERE id');
    console.log('\nDescription rule, switch on (as the poster, through RLS)');
    await asRole(c, 'authenticated', older);
    r = await insertBounty(c, older, { workType: 'in_person', description: '' });
    check('in-person with no description is refused with the mapped copy', refused(r, DESCRIPTION_ERROR), err(r));
    if (r.err) check('error carries the hint', /what exactly needs doing/i.test(r.err.hint || ''), r.err.hint);
    r = await insertBounty(c, older, { workType: 'in_person', description: `   ${'x'.repeat(19)}\n\t ` });
    check('19 characters padded with whitespace is refused', refused(r, DESCRIPTION_ERROR), err(r));
    r = await insertBounty(c, older, { workType: 'in_person', description: 'One 30-minute walk!!' });
    check('exactly 20 characters is accepted', !r.err, err(r));
    r = await insertBounty(c, older, { workType: 'online', description: '' });
    check('online with no description is not checked', !r.err, err(r));
    r = await insertBounty(c, older, { workType: 'in_person', description: '', isTest: true });
    check('a client-sent is_test = true is not an exemption', refused(r, DESCRIPTION_ERROR), err(r));
    await asOwner(c);

    // ── 3. new-account cap ──────────────────────────────────────────────────
    console.log('\nNew-account cap (as the poster, through RLS)');
    await asRole(c, 'authenticated', fresh);
    const first = await insertBounty(c, fresh);
    const second = await insertBounty(c, fresh, { workType: 'in_person', description: 'Two boxes to the 3rd floor, Sunday 2pm' });
    check('first two open bounties are accepted', !first.err && !second.err, [err(first), err(second)]);
    r = await insertBounty(c, fresh);
    check('third open bounty in the first 24 h is refused with the composer copy', refused(r, CAP_ERROR), err(r));
    await asOwner(c);

    // A bounty that is no longer open frees a slot.
    const freed = await attempt(c, "UPDATE public.bounties SET status = 'cancelled' WHERE id = $1", [first.res.rows[0].id]);
    if (freed.err) {
      console.log(`  skip cancelled bounty frees a slot (lifecycle guard refused the setup update: ${freed.err.message})`);
    } else {
      await asRole(c, 'authenticated', fresh);
      r = await insertBounty(c, fresh);
      check('a cancelled bounty does not count toward the cap', !r.err, err(r));
      r = await insertBounty(c, fresh);
      check('...and the cap applies again at 2 open', refused(r, CAP_ERROR), err(r));
      await asOwner(c);
    }

    // ── 4. service-role relay path ──────────────────────────────────────────
    console.log('\nService-role relay (api/server.js /api/supabase/bounties, services/api)');
    await asRole(c, 'service_role');
    r = await insertBounty(c, fresh);
    check('cap holds on the service-role path', refused(r, CAP_ERROR), err(r));
    r = await insertBounty(c, older, { workType: 'in_person', description: 'short' });
    check('description rule holds on the service-role path', refused(r, DESCRIPTION_ERROR), err(r));
    await asOwner(c);

    // Account turns a day old.
    await c.query(`UPDATE public.profiles SET created_at = now() - interval '25 hours' WHERE id = $1`, [fresh]);
    await asRole(c, 'authenticated', fresh);
    r = await insertBounty(c, fresh);
    check('the same insert succeeds once the account is 24 h old', !r.err, err(r));
    await asOwner(c);
    await c.query(`UPDATE public.profiles SET created_at = now() - interval '1 hour' WHERE id = $1`, [fresh]);

    // ── 5. internal accounts ────────────────────────────────────────────────
    console.log('\nInternal accounts');
    await asRole(c, 'authenticated', staff);
    const staffRuns = [];
    for (let i = 0; i < 3; i += 1) staffRuns.push(await insertBounty(c, staff, { workType: 'in_person', description: '' }));
    check('an internal account under 24 h old posts 3 in-person bounties with no description',
      staffRuns.every((x) => !x.err), staffRuns.map(err));
    await asOwner(c);

    // ── 6. paid web intake ──────────────────────────────────────────────────
    console.log('\nPaid web intake (fn_create_bounty_from_pending, service role)');
    const { rows: openNow } = await c.query(
      "SELECT count(*)::int n FROM public.bounties WHERE (poster_id = $1 OR user_id = $1) AND status = 'open'", [fresh]);
    check('setup: the fresh poster is at the cap', openNow[0].n >= 2, openNow[0]);
    const { rows: pending } = await c.query(
      `INSERT INTO public.pending_bounties (email, title, description, amount, work_type, status, source)
       VALUES ('qa+shoal-poster-10@bountyfinder.test', '[sba03-check] web', '', 30, 'in_person', 'pending_payment', 'sba03-check')
       RETURNING id`,
    );
    const session = `cs_test_sba03_${crypto.randomBytes(6).toString('hex')}`;
    await asRole(c, 'service_role');
    r = await attempt(
      c,
      `SELECT * FROM public.fn_create_bounty_from_pending($1, $2, $3, $4, NULL, NULL, 30, 'usd', '{}'::jsonb)`,
      [pending[0].id, fresh, session, `pi_test_sba03_${crypto.randomBytes(6).toString('hex')}`],
    );
    check('a paid in-person web bounty with no description, past the cap, is created',
      !r.err && r.res.rows[0] && r.res.rows[0].created === true, r.err ? err(r) : r.res.rows);
    await asOwner(c);

    // ── 8. done-when query ──────────────────────────────────────────────────
    console.log('\nDone-when query');
    r = await attempt(c, fs.readFileSync(WEEKLY, 'utf8'));
    check('scripts/ops/posting-quality-weekly.sql runs', !r.err, err(r));
  } finally {
    await c.query('ROLLBACK').catch(() => {});
    await c.end();
  }

  console.log(failures ? `\n${failures} check(s) FAILED (rolled back)` : '\nAll checks passed (rolled back)');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
