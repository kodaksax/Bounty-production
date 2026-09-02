#!/usr/bin/env node
/**
 * Server-side oracles for Bounty's Shoal runs.
 *
 * A browser agent's opinion is not evidence about money or state. Shoal's own
 * "server-verified ground truth" only covers its bundled demo shop (packages/core/src/
 * server.ts), so for Bounty the ground truth has to come from Bounty's own database.
 * Everything here reads the target project directly and asserts invariants that the UI
 * cannot fake.
 *
 *   node qa/shoal/bin/oracle.mjs <check> [--env <name>] [--bounty-id <uuid>]
 *                                        [--since <iso>] [--out <file>]
 *
 * Checks:
 *   race-claim           one bounty, one winner -- no double acceptance, no contradictory state
 *   duplicate-bounties   no duplicate postings from repeated submits
 *   payment-integrity    the ledger agrees with itself and with the balances
 *   completion-integrity completed bounties are actually complete end to end
 *   seed-race            (helper) create one open bounty for the race scenario to contend over
 *
 * Connection: BOUNTY_SHOAL_DATABASE_URL only. This deliberately does NOT fall back to
 * DATABASE_URL from .env, because this repo's root .env points at a different project
 * than its filename suggests and the production URL lives one file away.
 */
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import pg from 'pg';
import {
  GuardError,
  expectedRefForAppEnv,
  loadConfig,
  resolveDatabaseTarget,
  resolveEnv,
} from './lib/env.mjs';

const argv = process.argv.slice(2);
const has = (f) => argv.includes('--' + f);
const opt = (f, fallback) => {
  const i = argv.indexOf('--' + f);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const check = argv.find((a) => !a.startsWith('--'));
const config = loadConfig();

const CHECKS = [
  'race-claim',
  'duplicate-bounties',
  'payment-integrity',
  'completion-integrity',
  'seed-race',
];
if (!check || !CHECKS.includes(check)) {
  console.error('  Usage: node qa/shoal/bin/oracle.mjs <' + CHECKS.join('|') + '> [options]');
  process.exit(1);
}

// --- Connection guard -----------------------------------------------------
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
  console.error(
    '\n  BOUNTY_SHOAL_DATABASE_URL is not set.\n' +
      '  Point it at the ' + target.name + " project's Postgres connection string.\n" +
      '  It is deliberately a separate variable from DATABASE_URL: the root .env in this\n' +
      '  repo carries a different project than its name implies, and the production URL is\n' +
      '  one file away. Never export the production URL into this variable.\n',
  );
  process.exit(1);
}

// Fail-closed: refuses an unidentified database rather than connecting to it. See
// resolveDatabaseTarget() for why the old host-only matcher was unsafe with pooler URLs.
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
const refInUrl = dbTarget.ref;

// The environment name and the project actually being connected to must agree, so a
// staging-labelled run can never quietly touch a different project.
const expectedForEnv = config.environments[target.name]?.appEnv
  ? expectedRefForAppEnv(config.environments[target.name].appEnv)
  : null;
if (expectedForEnv && expectedForEnv !== refInUrl) {
  console.error(
    '\n  BLOCKED\n  --env ' + target.name + ' maps to Supabase project ' + expectedForEnv +
      ',\n  but BOUNTY_SHOAL_DATABASE_URL connects to ' + refInUrl + '.\n' +
      '  Refusing: the environment label and the database must agree.\n',
  );
  process.exit(2);
}

const since = opt('since', new Date(Date.now() - 60 * 60 * 1000).toISOString());
const bountyId = opt('bounty-id', process.env.BOUNTY_SHOAL_RACE_BOUNTY_ID);

const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
await client.connect();

/**
 * Introspect the target's actual schema before asserting anything against it.
 *
 * Bounty's environments are NOT schema-identical: production's wallet_transactions
 * carries completed_at, reference_id, dispute_status and four stripe_* columns that
 * staging does not have, and no tracked migration creates them. An oracle that assumes
 * one shape crashes on the other -- and a crashed oracle is indistinguishable from an
 * oracle that found nothing, which is the failure mode that matters here.
 */
const schema = new Map();
{
  const rows = (
    await client.query(
      "select table_name, column_name from information_schema.columns where table_schema = 'public'",
    )
  ).rows;
  for (const r of rows) {
    if (!schema.has(r.table_name)) schema.set(r.table_name, new Set());
    schema.get(r.table_name).add(r.column_name);
  }
}
const hasTable = (t) => schema.has(t);
const hasCols = (t, ...cols) => schema.has(t) && cols.every((c) => schema.get(t).has(c));

/**
 * One invariant result. `ok:false` is a P0 by construction -- these are integrity rules.
 * A check the schema cannot support is recorded as SKIPPED, never as a pass: silently
 * "passing" a check that never ran is how a guard stops guarding.
 */
const results = [];
function assert(id, ok, detail, severity = 'P0') {
  results.push({ id, ok, skipped: false, severity: ok ? null : severity, detail });
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + id + (detail ? ' -- ' + detail : ''));
}
function skip(id, reason) {
  results.push({ id, ok: null, skipped: true, severity: null, detail: reason });
  console.log('  SKIP  ' + id + ' -- ' + reason);
}

async function raceClaim() {
  if (!bountyId) {
    console.error('  race-claim needs --bounty-id <uuid>.');
    process.exit(1);
  }
  const b = (
    await client.query(
      'select id, status, accepted_by, accepted_request_id, poster_id, amount from bounties where id = $1',
      [bountyId],
    )
  ).rows[0];
  if (!b) {
    console.error('  No bounty ' + bountyId + ' in this project.');
    process.exit(1);
  }

  const reqs = (
    await client.query(
      'select id, hunter_id, status, accepted_at from bounty_requests where bounty_id = $1',
      [bountyId],
    )
  ).rows;
  const accepted = reqs.filter((r) => r.status === 'accepted');

  // The whole point of the race: a bounty is a one-of-one resource.
  assert(
    'race.single-accepted-request',
    accepted.length <= 1,
    accepted.length + ' requests are in status=accepted (expected at most 1): ' +
      accepted.map((r) => r.id).join(', '),
  );

  // Duplicate applications from one hunter -- the other way a swarm breaks this table.
  const byHunter = new Map();
  for (const r of reqs) byHunter.set(r.hunter_id, (byHunter.get(r.hunter_id) ?? 0) + 1);
  const dupes = [...byHunter.entries()].filter(([, n]) => n > 1);
  assert(
    'race.no-duplicate-applications',
    dupes.length === 0,
    dupes.map(([h, n]) => h + ' x' + n).join(', '),
    'P1',
  );

  // The denormalised winner columns must agree with the request table.
  const winner = accepted[0] ?? null;
  assert(
    'race.accepted_by-matches-request',
    !b.accepted_by || (winner && winner.hunter_id === b.accepted_by),
    'bounties.accepted_by=' + b.accepted_by + ' vs accepted request hunter_id=' +
      (winner ? winner.hunter_id : 'none'),
  );
  assert(
    'race.accepted_request_id-consistent',
    !b.accepted_request_id || (winner && winner.id === b.accepted_request_id),
    'bounties.accepted_request_id=' + b.accepted_request_id + ' vs accepted request id=' +
      (winner ? winner.id : 'none'),
  );

  // A claimed bounty must not still advertise itself as open.
  assert(
    'race.status-not-contradictory',
    !(b.accepted_by && b.status === 'open'),
    'status=' + b.status + ' accepted_by=' + b.accepted_by,
  );

  // Escrow must not have been taken more than once for one bounty.
  const escrow = (
    await client.query(
      "select id, type, status, amount, idempotency_key from wallet_transactions " +
        'where bounty_id = $1',
      [bountyId],
    )
  ).rows;
  const byKey = new Map();
  for (const t of escrow) {
    if (!t.idempotency_key) continue;
    byKey.set(t.idempotency_key, (byKey.get(t.idempotency_key) ?? 0) + 1);
  }
  const keyDupes = [...byKey.entries()].filter(([, n]) => n > 1);
  assert(
    'race.no-duplicate-ledger-rows',
    keyDupes.length === 0,
    keyDupes.map(([k, n]) => k + ' x' + n).join(', '),
  );

  console.log(
    '\n  contended bounty ' + bountyId + ': ' + reqs.length + ' requests, ' +
      accepted.length + ' accepted, status=' + b.status + ', ' + escrow.length + ' ledger rows',
  );
}

async function duplicateBounties() {
  const rows = (
    await client.query(
      "select poster_id, title, amount, count(*) as n, min(created_at) as first, max(created_at) as last " +
        'from bounties where created_at >= $1 ' +
        'group by poster_id, title, amount having count(*) > 1',
      [since],
    )
  ).rows;
  const nearSimultaneous = rows.filter(
    (r) => new Date(r.last) - new Date(r.first) < 120_000,
  );
  assert(
    'post.no-duplicate-submissions',
    nearSimultaneous.length === 0,
    nearSimultaneous
      .map((r) => '"' + r.title + '" x' + r.n + ' by ' + r.poster_id)
      .join('; '),
    'P1',
  );
  console.log('\n  window since ' + since + ': ' + rows.length + ' duplicate title/amount groups');
}

async function paymentIntegrity() {
  // The ledger must not contain two rows for one logical operation.
  const dupKeys = (
    await client.query(
      'select idempotency_key, count(*) as n from wallet_transactions ' +
        'where idempotency_key is not null and created_at >= $1 ' +
        'group by idempotency_key having count(*) > 1',
      [since],
    )
  ).rows;
  assert(
    'pay.idempotency-keys-unique',
    dupKeys.length === 0,
    dupKeys.map((r) => r.idempotency_key + ' x' + r.n).join(', '),
  );

  // Bounty's ledger is SIGNED, by design: escrow debits the poster and is stored
  // negative (see apply_escrow / atomic_bounty_escrow_reservation / secure_apply_deposit,
  // all of which insert `'escrow', -p_amount`, and the Command Center view which reads it
  // back with ABS()). An earlier version of this oracle asserted "amount >= 0" and
  // therefore flagged every correct escrow row in the database. What is actually
  // invariant is the CONVENTION -- so assert that instead.
  const SIGN = { escrow: 'negative', deposit: 'positive', release: 'positive', refund: 'positive' };
  const wrongSign = (
    await client.query(
      "select id, type::text t, amount from wallet_transactions where created_at >= $1 " +
        "and ((type::text = 'escrow' and amount > 0) " +
        "  or (type::text in ('deposit','release','refund') and amount < 0))",
      [since],
    )
  ).rows;
  assert(
    'pay.ledger-sign-convention',
    wrongSign.length === 0,
    wrongSign
      .map((r) => r.id + ' (' + r.t + ' ' + r.amount + ', expected ' + (SIGN[r.t] ?? '?') + ')')
      .join(', '),
  );

  // completed_at exists on production's wallet_transactions but not staging's, and no
  // tracked migration adds it -- so this check is schema-gated rather than assumed.
  if (hasCols('wallet_transactions', 'completed_at')) {
    const unstamped = (
      await client.query(
        "select id from wallet_transactions where created_at >= $1 " +
          "and status::text = 'completed' and completed_at is null",
        [since],
      )
    ).rows;
    assert(
      'pay.completed-rows-are-stamped',
      unstamped.length === 0,
      unstamped.map((r) => r.id).join(', '),
      'P1',
    );
  } else {
    skip('pay.completed-rows-are-stamped', 'wallet_transactions.completed_at does not exist here');
  }

  // A ledger row must belong to somebody. user_id is the owning column -- sender_id and
  // receiver_id are vestigial (populated on 0 of 150 rows in staging), so requiring one
  // of the three would be satisfied by a column nothing writes. Scoped to the run window
  // on purpose: staging carries legacy rows from May-Jul 2026 with a null user_id, which
  // predate the current RPCs (all of which pass p_user_id) and are not a live defect.
  const orphaned = (
    await client.query(
      'select id, type::text t from wallet_transactions where created_at >= $1 and user_id is null',
      [since],
    )
  ).rows;
  assert(
    'pay.ledger-rows-have-an-owner',
    orphaned.length === 0,
    orphaned.map((r) => r.id + ' (' + r.t + ')').join(', '),
    'P1',
  );

  // A ledger row that names a bounty must name one that exists.
  const danglingBounty = (
    await client.query(
      'select t.id, t.bounty_id from wallet_transactions t ' +
        'where t.created_at >= $1 and t.bounty_id is not null ' +
        'and not exists (select 1 from bounties b where b.id = t.bounty_id)',
      [since],
    )
  ).rows;
  assert(
    'pay.ledger-bounty-references-resolve',
    danglingBounty.length === 0,
    danglingBounty.map((r) => r.id + ' -> ' + r.bounty_id).join(', '),
  );

  // No balance may go negative, and none may be held beyond what exists.
  const badBalances = (
    await client.query(
      'select id, balance, balance_on_hold from profiles ' +
        'where balance < 0 or (balance_on_hold is not null and balance_on_hold > balance)',
    )
  ).rows;
  assert(
    'pay.balances-non-negative-and-covered',
    badBalances.length === 0,
    badBalances.map((r) => r.id + ' bal=' + r.balance + ' hold=' + r.balance_on_hold).join('; '),
  );

  const n = (
    await client.query('select count(*)::int as n from wallet_transactions where created_at >= $1', [
      since,
    ])
  ).rows[0].n;
  console.log('\n  window since ' + since + ': ' + n + ' ledger rows examined');
}

async function completionIntegrity() {
  const bad = (
    await client.query(
      "select id, status::text as status, accepted_by, completed_at from bounties " +
        "where updated_at >= $1 and status::text = 'completed' " +
        'and (completed_at is null or accepted_by is null)',
      [since],
    )
  ).rows;
  assert(
    'complete.completed-implies-worker-and-timestamp',
    bad.length === 0,
    bad.map((r) => r.id + ' completed_at=' + r.completed_at + ' accepted_by=' + r.accepted_by).join('; '),
  );

  // A completed bounty that never moved money is the silent failure that matters most.
  const unpaid = (
    await client.query(
      "select b.id, b.amount from bounties b " +
        "where b.updated_at >= $1 and b.status::text = 'completed' and b.is_for_honor is not true " +
        'and not exists (select 1 from wallet_transactions t where t.bounty_id = b.id)',
      [since],
    )
  ).rows;
  assert(
    'complete.paid-bounty-has-ledger-rows',
    unpaid.length === 0,
    unpaid.map((r) => r.id + ' ($' + r.amount + ')').join(', '),
  );

  const inProgressNoWorker = (
    await client.query(
      "select id from bounties where updated_at >= $1 and status::text = 'in_progress' and accepted_by is null",
      [since],
    )
  ).rows;
  assert(
    'complete.in-progress-implies-worker',
    inProgressNoWorker.length === 0,
    inProgressNoWorker.map((r) => r.id).join(', '),
    'P1',
  );

  // completion_submissions is where proof of work actually lives -- the earlier version
  // of this oracle never looked at it, so "the hunter submitted proof" was unverifiable.
  // created_at is in the gate because all three queries below filter on it. Gating only
  // on the columns named in the SELECT list would let a project that has the table but a
  // differently-named timestamp reach the query and hard-fail the whole oracle, when the
  // correct outcome is a recorded SKIP.
  if (hasCols('completion_submissions', 'bounty_id', 'hunter_id', 'status', 'created_at')) {
    const orphanProof = (
      await client.query(
        'select cs.id, cs.bounty_id from completion_submissions cs ' +
          'where cs.created_at >= $1 ' +
          'and not exists (select 1 from bounties b where b.id = cs.bounty_id)',
        [since],
      )
    ).rows;
    assert(
      'complete.submissions-reference-real-bounties',
      orphanProof.length === 0,
      orphanProof.map((r) => r.id + ' -> ' + r.bounty_id).join(', '),
    );

    // Proof of work must come from the hunter who actually holds the job. A submission
    // from anyone else is either a bug or an authorisation hole.
    const wrongHunter = (
      await client.query(
        'select cs.id, cs.hunter_id, b.accepted_by from completion_submissions cs ' +
          'join bounties b on b.id = cs.bounty_id ' +
          'where cs.created_at >= $1 and b.accepted_by is not null ' +
          'and cs.hunter_id is distinct from b.accepted_by',
        [since],
      )
    ).rows;
    assert(
      'complete.submission-author-is-the-assigned-hunter',
      wrongHunter.length === 0,
      wrongHunter.map((r) => r.id + ': ' + r.hunter_id + ' != ' + r.accepted_by).join('; '),
    );

    // A bounty cannot be finished if its proof of work is still awaiting review.
    const closedWithPendingProof = (
      await client.query(
        "select b.id, cs.status::text s from bounties b join completion_submissions cs on cs.bounty_id = b.id " +
          "where b.updated_at >= $1 and b.status::text = 'completed' and cs.status::text = 'pending'",
        [since],
      )
    ).rows;
    assert(
      'complete.no-completed-bounty-with-pending-proof',
      closedWithPendingProof.length === 0,
      closedWithPendingProof.map((r) => r.id).join(', '),
      'P1',
    );
  } else {
    skip(
      'complete.submission-checks',
      hasTable('completion_submissions')
        ? 'completion_submissions lacks one of bounty_id/hunter_id/status/created_at here'
        : 'completion_submissions is not present in this project',
    );
  }
}

/**
 * Create the single open bounty the race scenario contends over. Writes rows, so it is
 * gated by the same non-production guard as everything else above.
 */
async function seedRace() {
  const posterId = opt('poster-id', process.env.BOUNTY_SHOAL_POSTER_ID);
  if (!posterId) {
    console.error(
      '  seed-race needs the test poster who will own the bounty:\n' +
        '    --poster-id <uuid>   (or BOUNTY_SHOAL_POSTER_ID)\n',
    );
    process.exit(1);
  }
  const id = randomUUID();
  await client.query(
    'insert into bounties (id, title, description, amount, location, poster_id, user_id, status, ' +
      'is_for_honor, created_at, updated_at) ' +
      "values ($1, $2, $3, $4, $5, $6, $6, 'open', false, now(), now())",
    [
      id,
      '[shoal-race] Contended test bounty ' + new Date().toISOString(),
      'Seeded by qa/shoal/bin/oracle.mjs for concurrency testing. Safe to delete.',
      25,
      'Test Location',
      posterId,
    ],
  );
  console.log('\n  seeded open bounty: ' + id);
  console.log('  run the race with:');
  console.log('    node qa/shoal/bin/run.mjs race-claim --env ' + target.name + ' --bounty-id ' + id + '\n');
  results.push({ id: 'seed-race', ok: true, severity: null, detail: id });
}

const handlers = {
  'race-claim': raceClaim,
  'duplicate-bounties': duplicateBounties,
  'payment-integrity': paymentIntegrity,
  'completion-integrity': completionIntegrity,
  'seed-race': seedRace,
};

console.log('\n  oracle: ' + check + '  (env=' + target.name + ', project=' + (refInUrl ?? 'unknown') + ')\n');
try {
  await handlers[check]();
} finally {
  await client.end();
}

// `ok === null` means skipped, which is neither a pass nor a violation. Only an explicit
// false is a finding; skips are surfaced separately so a run that checked nothing can
// never look like a run that found nothing.
const failed = results.filter((r) => r.ok === false);
const skipped = results.filter((r) => r.skipped);
const passed = results.filter((r) => r.ok === true);

const out = opt('out');
if (out) {
  writeFileSync(
    out,
    JSON.stringify(
      {
        check,
        env: target.name,
        project: refInUrl,
        since,
        bountyId,
        results,
        passed: passed.length,
        skipped: skipped.length,
        failed: failed.length,
      },
      null,
      2,
    ),
    'utf8',
  );
  console.log('\n  wrote ' + out);
}

console.log(
  '\n  ' + passed.length + ' passed · ' + failed.length + ' violated · ' + skipped.length + ' skipped',
);
if (skipped.length > 0) {
  console.log('  skipped checks did NOT run and prove nothing:');
  for (const s of skipped) console.log('    - ' + s.id + ' (' + s.detail + ')');
}

if (failed.length > 0) {
  console.error('\n  ' + failed.length + ' invariant(s) violated -- these are ground truth, not agent opinion.\n');
  process.exit(1);
}
console.log('\n  all invariants that could run held\n');
