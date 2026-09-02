#!/usr/bin/env node
/**
 * Provision the dedicated test accounts and marketplace state the authenticated Shoal
 * scenarios need, on a NON-PRODUCTION project.
 *
 * This exists because 11 of the 14 scenarios were blocked purely on "a poster account, a
 * hunter account, and something for them to act on". Doing that by hand is unrepeatable
 * and undocumented; doing it here makes the whole authenticated suite runnable by anyone
 * with staging credentials, and re-runnable in CI.
 *
 *   node qa/shoal/bin/seed.mjs accounts [--env staging]
 *   node qa/shoal/bin/seed.mjs bounty   [--env staging] [--count 1]
 *   node qa/shoal/bin/seed.mjs status   [--env staging]
 *
 * Everything it writes is prefixed/marked so it can be identified and removed:
 *   - accounts use the +shoal tagged addresses below
 *   - bounties are titled "[shoal] ..."
 *
 * Credentials: never hardcoded, never committed. Passwords come from
 * BOUNTY_SHOAL_TEST_PASSWORD / BOUNTY_SHOAL_HUNTER_PASSWORD, or are generated once and
 * printed for you to store. The service-role key is read from
 * BOUNTY_SHOAL_SERVICE_ROLE_KEY only -- deliberately its own variable so a shell that
 * happens to have the production key exported cannot be used by accident.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';
import {
  GuardError,
  expectedRefForAppEnv,
  loadConfig,
  resolveDatabaseTarget,
  resolveEnv,
} from './lib/env.mjs';

const argv = process.argv.slice(2);
const opt = (f, fallback) => {
  const i = argv.indexOf('--' + f);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const cmd = argv.find((a) => !a.startsWith('--'));
const COMMANDS = ['accounts', 'bounty', 'status'];
if (!cmd || !COMMANDS.includes(cmd)) {
  console.error('  Usage: node qa/shoal/bin/seed.mjs <' + COMMANDS.join('|') + '> [--env staging]');
  process.exit(1);
}

const config = loadConfig();

// --- Guards ---------------------------------------------------------------
let target;
try {
  target = resolveEnv(config, opt('env'));
} catch (err) {
  if (err instanceof GuardError) {
    console.error('\n  BLOCKED\n  ' + err.message + '\n');
    process.exit(2);
  }
  throw err;
}

const connectionString = process.env.BOUNTY_SHOAL_DATABASE_URL;
if (!connectionString) {
  console.error('\n  BOUNTY_SHOAL_DATABASE_URL is not set. See qa/shoal/README.md.\n');
  process.exit(1);
}
let dbTarget;
try {
  dbTarget = resolveDatabaseTarget(config, connectionString);
} catch (err) {
  if (err instanceof GuardError) {
    console.error('\n  BLOCKED\n  BOUNTY_SHOAL_DATABASE_URL: ' + err.message + '\n');
    process.exit(2);
  }
  throw err;
}
const expected = expectedRefForAppEnv(config.environments[target.name].appEnv);
if (expected !== dbTarget.ref) {
  console.error(
    '\n  BLOCKED\n  --env ' + target.name + ' maps to ' + expected +
      ' but the database is ' + dbTarget.ref + '.\n',
  );
  process.exit(2);
}

const POSTER_EMAIL = process.env.BOUNTY_SHOAL_TEST_EMAIL || 'qa+shoal-poster@bountyfinder.test';
const HUNTER_EMAIL = process.env.BOUNTY_SHOAL_HUNTER_EMAIL || 'qa+shoal-hunter@bountyfinder.test';

const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
await client.connect();

console.log('\n  seed: ' + cmd + '  (env=' + target.name + ', project=' + dbTarget.ref + ')\n');

/** Generated passwords are printed once; nothing is written to a tracked file. */
function newPassword() {
  return 'Shoal!' + randomBytes(12).toString('base64url');
}

/**
 * Run `fn` inside a transaction that is permitted to write protected profile columns.
 *
 * `app.bypass_profile_guard` is set with is_local = true, so it is scoped to this
 * transaction and reverts on COMMIT/ROLLBACK -- the guard stays fully armed for
 * everything else, including anything else using this same connection afterwards.
 */
async function withProfileGuardBypass(fn) {
  await client.query('begin');
  try {
    await client.query("select set_config('app.bypass_profile_guard', 'on', true)");
    const r = await fn();
    await client.query('commit');
    return r;
  } catch (err) {
    await client.query('rollback');
    throw err;
  }
}

async function ensureAccounts() {
  const serviceKey = process.env.BOUNTY_SHOAL_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    console.error(
      '  BOUNTY_SHOAL_SERVICE_ROLE_KEY is not set.\n' +
        '  Creating auth users needs the service-role key for the ' + target.name + ' project.\n' +
        '  Load it into that variable for this shell only, e.g. on bash:\n' +
        "    export BOUNTY_SHOAL_SERVICE_ROLE_KEY=$(grep '^SUPABASE_SERVICE_ROLE_KEY=' .env." +
        target.name + ' | cut -d= -f2-)\n' +
        '  It is a separate variable on purpose: a shell already holding the production\n' +
        '  service key must not be able to seed by accident.\n',
    );
    process.exit(1);
  }
  const url = 'https://' + dbTarget.ref + '.supabase.co';
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  const wanted = [
    { role: 'poster', email: POSTER_EMAIL, pwEnv: 'BOUNTY_SHOAL_TEST_PASSWORD', username: 'shoal_poster' },
    { role: 'hunter', email: HUNTER_EMAIL, pwEnv: 'BOUNTY_SHOAL_HUNTER_PASSWORD', username: 'shoal_hunter' },
  ];

  const out = [];
  for (const w of wanted) {
    const password = process.env[w.pwEnv] || newPassword();
    const generated = !process.env[w.pwEnv];

    const existing = (
      await client.query('select id from auth.users where email = $1', [w.email])
    ).rows[0];

    let userId;
    if (existing) {
      userId = existing.id;
      // Reset the password so a run is never blocked by a forgotten one.
      const { error } = await admin.auth.admin.updateUserById(userId, {
        password,
        email_confirm: true,
      });
      if (error) throw new Error('updateUserById(' + w.email + '): ' + error.message);
      console.log('  reused  ' + w.role + ' ' + w.email + ' (' + userId + ')');
    } else {
      const { data, error } = await admin.auth.admin.createUser({
        email: w.email,
        password,
        email_confirm: true,
        user_metadata: { username: w.username, shoal_test_account: true },
      });
      if (error) throw new Error('createUser(' + w.email + '): ' + error.message);
      userId = data.user.id;
      console.log('  created ' + w.role + ' ' + w.email + ' (' + userId + ')');
    }

    // The app gates on onboarding_completed; a half-onboarded account would make every
    // authenticated scenario measure onboarding instead of what it is actually for.
    //
    // profiles carries trg_prevent_client_writes_to_protected_profile_columns, which
    // rejects direct writes to protected columns. The sanctioned way through it is the
    // transaction-local GUC app.bypass_profile_guard (added by
    // 20260719120000_fix_profile_guard_blocks_trusted_writes.sql and used by
    // update_balance / withdraw_balance). Use that rather than weakening the guard --
    // it is transaction-scoped, so it cannot leak into anything else.
    await withProfileGuardBypass(async () => {
      await client.query(
        'insert into profiles (id, email, username, onboarding_completed, created_at, updated_at) ' +
          'values ($1, $2, $3, true, now(), now()) ' +
          'on conflict (id) do update set onboarding_completed = true, ' +
          '  username = coalesce(profiles.username, excluded.username), updated_at = now()',
        [userId, w.email, w.username],
      );
    });

    out.push({ ...w, userId, password, generated });
  }

  // Give the poster a balance so funding-dependent scenarios are not blocked on Stripe.
  const poster = out.find((o) => o.role === 'poster');
  await withProfileGuardBypass(async () => {
    await client.query(
      'update profiles set balance = greatest(coalesce(balance,0), 500) where id = $1',
      [poster.userId],
    );
  });
  console.log('  poster balance ensured >= 500 (test funds, staging only)');

  console.log('\n  Export these for the authenticated scenarios:\n');
  for (const o of out) {
    const v = o.role === 'poster' ? 'BOUNTY_SHOAL_TEST' : 'BOUNTY_SHOAL_HUNTER';
    console.log('    export ' + v + '_EMAIL=' + o.email);
    console.log('    export ' + v + '_PASSWORD=' + (o.generated ? o.password : '<the value you set>'));
  }
  console.log('\n    export BOUNTY_SHOAL_POSTER_ID=' + poster.userId);
  console.log(
    '\n  Passwords are shown once and stored nowhere. Put them in your shell or CI secrets.\n',
  );
}

async function seedBounty() {
  const count = Number(opt('count', '1'));
  const poster = (
    await client.query('select id from auth.users where email = $1', [POSTER_EMAIL])
  ).rows[0];
  if (!poster) {
    console.error('  No poster account yet. Run: node qa/shoal/bin/seed.mjs accounts --env ' + target.name);
    process.exit(1);
  }
  const ids = [];
  for (let i = 0; i < count; i++) {
    const id = randomUUID();
    await client.query(
      'insert into bounties (id, title, description, amount, location, poster_id, user_id, status, ' +
        'is_for_honor, created_at, updated_at) ' +
        "values ($1, $2, $3, $4, $5, $6, $6, 'open', false, now(), now())",
      [
        id,
        '[shoal] Help me move a couch ' + new Date().toISOString().slice(0, 16),
        'Seeded by qa/shoal/bin/seed.mjs for swarm testing. Two flights of stairs, about an hour. Safe to delete.',
        45,
        'Petworth',
        poster.id,
      ],
    );
    ids.push(id);
    console.log('  seeded open bounty ' + id);
  }
  console.log('\n  Race against one of them:');
  console.log('    npm run qa:shoal:race -- --bounty-id ' + ids[0] + ' --swarm 10\n');
}

async function status() {
  const rows = (
    await client.query(
      'select u.email, u.id, p.onboarding_completed, p.balance ' +
        'from auth.users u left join profiles p on p.id = u.id where u.email = any($1)',
      [[POSTER_EMAIL, HUNTER_EMAIL]],
    )
  ).rows;
  if (rows.length === 0) console.log('  no shoal test accounts exist yet');
  for (const r of rows) {
    console.log(
      '  ' + r.email + '  id=' + r.id + '  onboarded=' + r.onboarding_completed + '  balance=' + r.balance,
    );
  }
  const open = (
    await client.query("select count(*)::int n from bounties where title like '[shoal]%' and status::text = 'open'")
  ).rows[0].n;
  console.log('  open [shoal] bounties: ' + open);
}

try {
  if (cmd === 'accounts') await ensureAccounts();
  else if (cmd === 'bounty') await seedBounty();
  else await status();
} finally {
  await client.end();
}
