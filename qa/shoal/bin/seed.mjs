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
 *   node qa/shoal/bin/seed.mjs accounts [--env staging] [--pool <n>]
 *   node qa/shoal/bin/seed.mjs bounty   [--env staging] [--count 1]
 *   node qa/shoal/bin/seed.mjs state    [--env staging] [--pool <n>]
 *   node qa/shoal/bin/seed.mjs status   [--env staging]
 *
 * `state` builds the marketplace state the later-phase scenarios need -- an applied-to
 * bounty for poster-review, an in-progress one with a completion submission for
 * completion -- ONE SET PER POSTER SLOT. Per-slot matters: now that every agent has its
 * own account, sharing one bounty between them would put the confounding straight back.
 *
 * `accounts` provisions the shared poster/hunter pair AND a pool of one account per
 * swarm slot (qa/shoal/bin/lib/accounts.mjs). The pool is what makes an authenticated
 * scenario's state observations mean anything: without it every agent in the swarm
 * signs into the same user and reads the other agents' writes as its own.
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
  loadScenarios,
  resolveDatabaseTarget,
  resolveEnv,
} from './lib/env.mjs';
import {
  POOL_ROLES,
  POOL_SECRET_ENV,
  RESERVED_SLOT,
  fullPool,
  poolAccount,
  requiredPoolSize,
  requirePoolSecret,
} from './lib/accounts.mjs';

const argv = process.argv.slice(2);
const opt = (f, fallback) => {
  const i = argv.indexOf('--' + f);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const cmd = argv.find((a) => !a.startsWith('--'));
const COMMANDS = ['accounts', 'bounty', 'state', 'status'];
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
    const userId = await upsertAccount(admin, { ...w, password });
    out.push({ ...w, userId, password, generated });
  }

  // Give the poster a balance so funding-dependent scenarios are not blocked on Stripe.
  const poster = out.find((o) => o.role === 'poster');
  await fundPoster(poster.userId);
  console.log('  poster balance ensured >= ' + POSTER_TEST_BALANCE + ' (test funds, staging only)');

  // --- The per-agent pool -------------------------------------------------
  // One account per swarm slot. Without this every agent in an authenticated swarm
  // signs into the SAME user and reads the other agents' writes as its own, which is
  // what made every state finding uninterpretable. See qa/shoal/bin/lib/accounts.mjs.
  const poolSize = Number(opt('pool', String(requiredPoolSize(loadScenarios()))));
  if (!Number.isInteger(poolSize) || poolSize < 1) {
    console.error('  --pool must be a positive integer, got "' + opt('pool') + '".');
    process.exit(1);
  }
  let secret;
  try {
    secret = requirePoolSecret();
  } catch (err) {
    console.error('\n  ' + err.message + '\n');
    process.exit(1);
  }

  console.log(
    '\n  pool: slots 01..' + String(poolSize).padStart(2, '0') + ' per role, plus reserved slot ' +
      String(RESERVED_SLOT).padStart(2, '0') + ' for manual inspection',
  );
  const pool = fullPool(secret, poolSize);
  for (const account of pool) {
    const userId = await upsertAccount(admin, account, { quiet: true });
    if (account.role === 'poster') await fundPoster(userId);
  }
  console.log(
    '  pool ready: ' + pool.length + ' accounts (' +
      pool.filter((a) => a.role === 'poster').length + ' poster / ' +
      pool.filter((a) => a.role === 'hunter').length + ' hunter), ' +
      'poster balances >= ' + POSTER_TEST_BALANCE,
  );

  console.log('\n  Export these for the authenticated scenarios:\n');
  for (const o of out) {
    const v = o.role === 'poster' ? 'BOUNTY_SHOAL_TEST' : 'BOUNTY_SHOAL_HUNTER';
    console.log('    export ' + v + '_EMAIL=' + o.email);
    console.log('    export ' + v + '_PASSWORD=' + (o.generated ? o.password : '<the value you set>'));
  }
  console.log('\n    export BOUNTY_SHOAL_POSTER_ID=' + poster.userId);
  console.log(
    '\n  Pool passwords are deliberately NOT printed: run.mjs re-derives every one of them' +
      '\n  from ' + POOL_SECRET_ENV + ', so that single secret is the only thing to keep.' +
      '\n  Keep exporting it; changing it rotates the whole pool at the next seed.' +
      '\n\n  The two passwords above are shown once and stored nowhere. Put them in your' +
      '\n  shell or CI secrets.\n',
  );
}

/** Balance handed to every poster-side test account, so funding is never Stripe-blocked. */
const POSTER_TEST_BALANCE = 500;

async function fundPoster(userId) {
  await withProfileGuardBypass(async () => {
    await client.query(
      'update profiles set balance = greatest(coalesce(balance,0), $2) where id = $1',
      [userId, POSTER_TEST_BALANCE],
    );
  });
}

/**
 * Create the auth user if it is missing, reset its password if it is not, and make sure
 * it has a fully onboarded profile. Returns the user id.
 *
 * The password is always (re)set so a run is never blocked by a forgotten or rotated one
 * -- which for the pool means that changing BOUNTY_SHOAL_POOL_SECRET rotates every pool
 * password on the next seed.
 */
async function upsertAccount(admin, { role, email, username, password }, { quiet = false } = {}) {
  const existing = (await client.query('select id from auth.users where email = $1', [email]))
    .rows[0];

  let userId;
  if (existing) {
    userId = existing.id;
    const { error } = await admin.auth.admin.updateUserById(userId, {
      password,
      email_confirm: true,
    });
    if (error) throw new Error('updateUserById(' + email + '): ' + error.message);
    if (!quiet) console.log('  reused  ' + role + ' ' + email + ' (' + userId + ')');
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { username, shoal_test_account: true },
    });
    if (error) throw new Error('createUser(' + email + '): ' + error.message);
    userId = data.user.id;
    if (!quiet) console.log('  created ' + role + ' ' + email + ' (' + userId + ')');
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
      [userId, email, username],
    );
  });

  return userId;
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

/**
 * Give every poster slot its OWN marketplace state, so the later-phase scenarios have
 * something real to act on without any two agents touching the same rows.
 *
 * Per slot:
 *   - one OPEN bounty with a pending application from the matching hunter slot
 *     -> poster-review has applicants to judge, hunter scenarios have something to browse
 *   - one IN_PROGRESS bounty accepted by that hunter, with a completion submission
 *     awaiting review -> completion has a lifecycle to carry to approval and payout
 *
 * Idempotent per slot: existing '[shoal]' rows for a slot are reused rather than
 * duplicated, so re-running before a swarm tops the state up instead of multiplying it.
 */
async function seedState() {
  const poolSize = Number(opt('pool', String(requiredPoolSize(loadScenarios()))));
  const tag = '[shoal]';
  let made = 0;
  let reused = 0;
  let repaired = 0;

  for (let slot = 1; slot <= poolSize; slot++) {
    const poster = poolAccount('poster', slot);
    const hunter = poolAccount('hunter', slot);
    const rows = await client.query(
      'select u.email, u.id from auth.users u where u.email = any($1)',
      [[poster.email, hunter.email]],
    );
    const posterId = rows.rows.find((r) => r.email === poster.email)?.id;
    const hunterId = rows.rows.find((r) => r.email === hunter.email)?.id;
    if (!posterId || !hunterId) {
      console.error(
        '  slot ' + slot + ': missing accounts. Run: node qa/shoal/bin/seed.mjs accounts --env ' +
          target.name,
      );
      process.exit(1);
    }

    const slotTag = tag + ' s' + String(slot).padStart(2, '0');

    // --- 1. open bounty with a pending application ------------------------
    const openTitle = slotTag + ' applied-to errand';
    let openId = (
      await client.query(
        "select id from bounties where poster_id = $1 and title = $2 and status::text = 'open' limit 1",
        [posterId, openTitle],
      )
    ).rows[0]?.id;
    if (openId) {
      reused++;
    } else {
      openId = randomUUID();
      await client.query(
        'insert into bounties (id, title, description, amount, location, poster_id, user_id, ' +
          "status, is_for_honor, created_at, updated_at) values ($1,$2,$3,$4,$5,$6,$6,'open',false,now(),now())",
        [
          openId,
          openTitle,
          'Seeded for swarm testing. Carry two boxes down one flight, about 30 minutes. Safe to delete.',
          40,
          'Petworth',
          posterId,
        ],
      );
      made++;
    }
    const hasReq = (
      await client.query('select 1 from bounty_requests where bounty_id = $1 and hunter_id = $2', [
        openId,
        hunterId,
      ])
    ).rows.length;
    if (!hasReq) {
      await client.query(
        'insert into bounty_requests (id, bounty_id, poster_id, hunter_id, status, message, ' +
          "created_at, updated_at) values ($1,$2,$3,$4,'pending'::request_status_enum,$5,now(),now())",
        [randomUUID(), openId, posterId, hunterId, 'I can do this today, I have a van.'],
      );
    }

    // --- 2. in-progress bounty with a completion submission to review -----
    const wipTitle = slotTag + ' work-in-progress errand';
    let wipId = (
      await client.query('select id from bounties where poster_id = $1 and title = $2 limit 1', [
        posterId,
        wipTitle,
      ])
    ).rows[0]?.id;

    // Only a COMPLETE one counts as reusable. A half-built row -- in_progress with no
    // escrow, or still open because an earlier run died between the insert and the
    // accept -- is worse than nothing here: `in_progress` with no escrow row is
    // precisely the invariant violation the completion-integrity oracle exists to
    // catch, so leaving one in place would make the seeder manufacture the oracle's
    // own failure and report it as a product defect. Rebuild instead of reusing.
    if (wipId) {
      const okState = (
        await client.query(
          "select 1 from bounties b where b.id = $1 and b.status::text = 'in_progress' " +
            'and b.accepted_by is not null ' +
            'and exists (select 1 from bounty_requests br where br.bounty_id = b.id ' +
            "  and br.status::text = 'accepted') " +
            'and exists (select 1 from wallet_transactions wt where wt.bounty_id = b.id ' +
            "  and wt.type = 'escrow' and wt.status = 'completed')",
          [wipId],
        )
      ).rows.length;
      if (!okState) {
        await client.query('delete from completion_submissions where bounty_id = $1', [wipId]);
        await client.query('delete from bounty_requests where bounty_id = $1', [wipId]);
        await client.query('delete from wallet_transactions where bounty_id = $1', [wipId]);
        await client.query('delete from bounties where id = $1', [wipId]);
        console.log('  slot ' + slot + ': rebuilt an incomplete work-in-progress bounty');
        wipId = undefined;
        repaired++;
      }
    }

    if (wipId) {
      reused++;
    } else {
      wipId = randomUUID();
      const reqId = randomUUID();
      // Walk the real lifecycle rather than writing the end state directly:
      // trg_bounty_request_require_open (enforce_bounty_request_target_open) rejects an
      // application against a bounty that is not open, which is exactly the validation
      // added in 5a1f268c. Seeding has to respect it, or it is seeding a state the
      // product itself would never produce.
      await client.query(
        'insert into bounties (id, title, description, amount, location, poster_id, user_id, ' +
          "status, is_for_honor, created_at, updated_at) " +
          "values ($1,$2,$3,$4,$5,$6,$6,'open',false,now(),now())",
        [
          wipId,
          wipTitle,
          'Seeded for swarm testing. Already accepted and worked on; awaiting review. Safe to delete.',
          55,
          'Petworth',
          posterId,
        ],
      );
      await client.query(
        'insert into bounty_requests (id, bounty_id, poster_id, hunter_id, status, message, ' +
          "created_at, updated_at) values ($1,$2,$3,$4,'pending'::request_status_enum,$5,now(),now())",
        [reqId, wipId, posterId, hunterId, 'On my way.'],
      );
      // Accept through the product's own RPC rather than writing the end state.
      // fn_bounties_enforce_funding_before_work refuses a hand-written transition to
      // in_progress ('bounty_not_funded'), and its HINT names this function: it reserves
      // escrow and flips the bounty in one transaction. Going through it means the seeded
      // state is one the marketplace could actually reach -- including the escrow row the
      // payment and completion oracles then assert against.
      await client.query('select fn_accept_bounty_request($1)', [reqId]);
      made++;
    }
    const hasSub = (
      await client.query('select 1 from completion_submissions where bounty_id = $1', [wipId])
    ).rows.length;
    if (!hasSub) {
      await client.query(
        'insert into completion_submissions (id, bounty_id, hunter_id, message, proof_items, ' +
          "status, submitted_at, created_at, updated_at) values ($1,$2,$3,$4,$5,'pending',now(),now(),now())",
        [
          randomUUID(),
          wipId,
          hunterId,
          'Done — boxes are in the hallway as agreed.',
          JSON.stringify([{ type: 'note', value: 'Seeded proof of work for swarm testing.' }]),
        ],
      );
    }
  }

  console.log(
    '  slots seeded: ' + poolSize + '  (bounties created ' + made + ', reused ' + reused +
      ', rebuilt ' + repaired + ')',
  );
  console.log('  per slot: 1 open+applied bounty, 1 in_progress bounty with a completion submission');

  const race = (
    await client.query(
      "select id from bounties where title like '[shoal]%' and status::text = 'open' order by created_at desc limit 1",
    )
  ).rows[0];
  if (race) {
    console.log('\n  Race against one of them:');
    console.log('    npm run qa:shoal:race -- --bounty-id ' + race.id + ' --swarm 8\n');
  }
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

  // Pool coverage, per role. run.mjs refuses an authenticated scenario whose swarm is
  // larger than the seeded pool, so this is the number to check before a big run.
  const needed = requiredPoolSize(loadScenarios());
  for (const role of POOL_ROLES) {
    const seeded = (
      await client.query(
        "select count(*)::int n from auth.users where email like $1 and email like '%@bountyfinder.test'",
        ['qa+shoal-' + role + '-%'],
      )
    ).rows[0].n;
    // Slot 00 is reserved and not usable by an agent.
    const usable = Math.max(0, seeded - 1);
    console.log(
      '  ' + role + ' pool: ' + usable + ' agent slot(s) seeded' +
        (usable < needed
          ? '  -- SHORT: the largest authenticated scenario needs ' + needed +
            '. Run: node qa/shoal/bin/seed.mjs accounts --env ' + target.name
          : ''),
    );
  }
  if (!process.env[POOL_SECRET_ENV]) {
    console.log('  ' + POOL_SECRET_ENV + ' is not set in this shell -- run.mjs cannot derive pool passwords.');
  }
}

try {
  if (cmd === 'accounts') await ensureAccounts();
  else if (cmd === 'bounty') await seedBounty();
  else if (cmd === 'state') await seedState();
  else await status();
} finally {
  await client.end();
}
