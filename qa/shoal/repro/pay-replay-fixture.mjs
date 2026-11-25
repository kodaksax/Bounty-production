#!/usr/bin/env node
/**
 * INSERT-ONLY fixture for replaying "Yes, pay" on staging (E2E-01). STAGING ONLY.
 *
 * The audit fixture (e2e-audit-fixture.mjs, on audit/senior-inclusive-e2e-2026-11-24)
 * re-creates a slot's jobs by DELETING its earlier rows first. This one never deletes
 * and never updates: it adds ONE new job with a unique title, walks it through the
 * product's own hire, and adds the helper's submitted work, so the poster can pay it
 * once in Stripe test mode. Every run makes a new job; nothing existing is touched.
 *
 *   1. INSERT bounties            "[shoal] pay-replay <timestamp>", $25, open
 *   2. INSERT bounty_requests     the helper's pending offer
 *   3. SELECT fn_accept_bounty_request(offer)   the real hire (the function's own
 *                                 writes: job -> in_progress, offer -> accepted, and
 *                                 fn_reserve_escrow_for_acceptance holds the $25 from
 *                                 the poster's TEST balance)
 *   4. INSERT completion_submissions   pending, with one photo
 *
 * Default is a dry run: it prints the statements and the accounts and changes nothing.
 * Pass --apply to run them, in one transaction.
 *
 *   DOTENV_CONFIG_PATH=.env node -r dotenv/config qa/shoal/repro/pay-replay-fixture.mjs \
 *     [--poster-slot 11] [--hunter-slot 12] [--apply]
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { poolAccount } from '../bin/lib/accounts.mjs';
import { expectedRefForAppEnv, loadConfig, resolveDatabaseTarget } from '../bin/lib/env.mjs';

const argv = process.argv.slice(2);
const opt = (f, d) => {
  const i = argv.indexOf('--' + f);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const apply = argv.includes('--apply');
const posterSlot = Number(opt('poster-slot', '11'));
const hunterSlot = Number(opt('hunter-slot', '12'));

const connectionString = process.env.BOUNTY_SHOAL_DATABASE_URL;
if (!connectionString) throw new Error('BOUNTY_SHOAL_DATABASE_URL is not set');
const target = resolveDatabaseTarget(loadConfig(), connectionString);
if (target.ref !== expectedRefForAppEnv('staging')) {
  console.error('BLOCKED: database is ' + target.ref + ', not staging');
  process.exit(2);
}

const posterEmail = poolAccount('poster', posterSlot).email;
const hunterEmail = poolAccount('hunter', hunterSlot).email;
const stamp = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
const ids = { bounty: randomUUID(), request: randomUUID(), submission: randomUUID() };
const PROOF = {
  id: randomUUID(),
  type: 'image',
  name: 'dry-cleaning.jpg',
  url: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=800',
  uri: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=800',
  size: 245_000,
  mimeType: 'image/jpeg',
};

const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15_000 });
await client.connect();
try {
  const who = async (email) => {
    const r = await client.query('select u.id, p.username, p.balance from auth.users u join profiles p on p.id = u.id where u.email = $1', [email]);
    if (!r.rows[0]) throw new Error('missing pool account ' + email);
    return r.rows[0];
  };
  const poster = await who(posterEmail);
  const hunter = await who(hunterEmail);
  const title = '[shoal] pay-replay ' + stamp;

  const steps = [
    {
      what: 'INSERT bounties',
      sql:
        'insert into bounties (id, title, description, amount, location, poster_id, user_id, status, is_for_honor, funding_mode, created_at, updated_at) ' +
        "values ($1, $2, $3, 25, 'Petworth', $4, $4, 'open', false, 'at_post', now(), now())",
      params: [ids.bounty, title, 'Pay-replay test job for the job-page stage fix (E2E-01). Safe to delete.', poster.id],
    },
    {
      what: 'INSERT bounty_requests',
      sql:
        'insert into bounty_requests (id, bounty_id, poster_id, hunter_id, status, message, created_at, updated_at) ' +
        "values ($1, $2, $3, $4, 'pending'::request_status_enum, $5, now(), now())",
      params: [ids.request, ids.bounty, poster.id, hunter.id, 'I can do this today.'],
    },
    {
      what: 'SELECT fn_accept_bounty_request (the product hire)',
      sql: 'select fn_accept_bounty_request($1)',
      params: [ids.request],
    },
    {
      what: 'INSERT completion_submissions',
      sql:
        'insert into completion_submissions (id, bounty_id, hunter_id, message, proof_items, status, submitted_at, created_at, updated_at) ' +
        "values ($1, $2, $3, $4, $5, 'pending', now(), now(), now())",
      params: [ids.submission, ids.bounty, hunter.id, 'All done. Picked up and dropped off as asked.', JSON.stringify([PROOF])],
    },
  ];

  console.log('\n  pay-replay fixture  (staging ' + target.ref + ', ' + (apply ? 'APPLY' : 'dry run') + ')');
  console.log('  poster : ' + posterEmail + '  ' + poster.id + '  ' + poster.username + '  test balance ' + poster.balance);
  console.log('  helper : ' + hunterEmail + '  ' + hunter.id + '  ' + hunter.username);
  console.log('  job    : ' + ids.bounty + '  "' + title + '"\n');
  for (const [i, s] of steps.entries()) {
    console.log('  ' + (i + 1) + '. ' + s.what + '\n     ' + s.sql + '\n     params ' + JSON.stringify(s.params).slice(0, 400) + '\n');
  }

  if (!apply) {
    console.log('  dry run: nothing written. Re-run with --apply to insert.\n');
  } else {
    await client.query('begin');
    try {
      for (const s of steps) await client.query(s.sql, s.params);
      await client.query('commit');
    } catch (e) {
      await client.query('rollback');
      throw e;
    }
    const r = await client.query(
      "select b.status, b.accepted_by = $2 as hired, (select status from completion_submissions where bounty_id = b.id) as submission from bounties b where b.id = $1",
      [ids.bounty, hunter.id]
    );
    console.log('  applied: ' + JSON.stringify(r.rows[0]) + '\n  route  : /postings/' + ids.bounty + '\n');
  }
} finally {
  await client.end();
}
