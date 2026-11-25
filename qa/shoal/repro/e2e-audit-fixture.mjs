#!/usr/bin/env node
/**
 * Fixture for the senior-inclusive end-to-end audit (2026-11-24). STAGING ONLY.
 * Derived from senior-second-pass-fixture.mjs. Differences:
 *   - --link 8:16,9:17 makes hunter slot 16/17 the hired helper on that poster slot's
 *     tap AND dry-cleaning jobs, so the same transaction can be watched from both sides.
 *   - --open-poster 7 posts three plain open jobs for first-time hunters to discover.
 *
 * For each poster pool slot given (default 08..12, which carry no older test
 * jobs), builds three "[shoal] sNN ..." jobs, each walking the product's real
 * lifecycle (insert open -> apply -> fn_accept_bounty_request) rather than
 * writing end states:
 *
 *   1. "Remove old furniture from my garage"  open, pay-when-you-choose ($60),
 *      three pending offers from three different hunter slots.
 *   2. "Fix a dripping kitchen tap"           hired 4 days ago ($45), the
 *      helper has sent no message since (the silent-helper case).
 *   3. "Pick up my dry cleaning"              hired 2 days ago ($25), work
 *      submitted with a real photo, waiting for the poster's approval.
 *
 * Re-running replaces this script's own rows for those slots (and only those:
 * matched by poster AND exact title) and tops each poster's TEST balance back
 * up to 500, the same thing seed.mjs does. Nothing here touches production:
 * the database target must resolve to the staging project ref or it refuses.
 *
 *   DOTENV_CONFIG_PATH=.env node -r dotenv/config qa/shoal/repro/senior-second-pass-fixture.mjs [--slots 8,9,10,11,12]
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
const slots = opt('slots', '8,9,10,11,12').split(',').map(Number);
const HUNTER_SLOTS = 12;
const links = Object.fromEntries(
  opt('link', '').split(',').filter(Boolean).map((p) => p.split(':').map(Number))
);
const openPoster = Number(opt('open-poster', '0'));

const connectionString = process.env.BOUNTY_SHOAL_DATABASE_URL;
if (!connectionString) throw new Error('BOUNTY_SHOAL_DATABASE_URL is not set');
const target = resolveDatabaseTarget(loadConfig(), connectionString);
if (target.ref !== expectedRefForAppEnv('staging')) {
  console.error('BLOCKED: database is ' + target.ref + ', not staging');
  process.exit(2);
}

const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
await client.connect();
console.log('\n  senior second-pass fixture  (project ' + target.ref + ', slots ' + slots.join(',') + ')\n');

const JOBS = {
  garage: 'Remove old furniture from my garage',
  tap: 'Fix a dripping kitchen tap',
  cleaning: 'Pick up my dry cleaning',
};
const OFFER_MESSAGES = [
  "Hi! I have a van and can come Saturday morning. I've cleared out garages before.",
  "I can do this any evening this week. I'm careful with furniture and I'll sweep up after.",
  "Happy to help. I can take everything to the dump for you so it's gone the same day.",
];
const PROOF = {
  id: randomUUID(),
  type: 'image',
  name: 'dry-cleaning.jpg',
  url: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=800',
  uri: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=800',
  size: 245_000,
  mimeType: 'image/jpeg',
};

async function idFor(email) {
  const r = await client.query('select id from auth.users where email = $1', [email]);
  if (!r.rows[0]) throw new Error('missing pool account ' + email + ' (run seed.mjs accounts first)');
  return r.rows[0].id;
}

async function removeOwn(posterId, title) {
  const ids = (await client.query('select id from bounties where poster_id = $1 and title = $2', [posterId, title])).rows.map(r => r.id);
  for (const id of ids) {
    await client.query('delete from completion_submissions where bounty_id = $1', [id]);
    await client.query('delete from bounty_requests where bounty_id = $1', [id]);
    await client.query('delete from wallet_transactions where bounty_id = $1', [id]);
    await client.query('delete from bounties where id = $1', [id]);
  }
  return ids.length;
}

async function insertBounty({ id, title, description, amount, posterId, fundingMode }) {
  await client.query(
    'insert into bounties (id, title, description, amount, location, poster_id, user_id, status, is_for_honor, ' +
      "funding_mode, created_at, updated_at) values ($1,$2,$3,$4,$5,$6,$6,'open',false,$7,now(),now())",
    [id, title, description, amount, 'Petworth', posterId, fundingMode]
  );
}

async function apply(bountyId, posterId, hunterId, message) {
  const id = randomUUID();
  await client.query(
    'insert into bounty_requests (id, bounty_id, poster_id, hunter_id, status, message, created_at, updated_at) ' +
      "values ($1,$2,$3,$4,'pending'::request_status_enum,$5,now(),now())",
    [id, bountyId, posterId, hunterId, message]
  );
  return id;
}

async function topUp(userId) {
  await client.query('begin');
  try {
    await client.query("select set_config('app.bypass_profile_guard', 'on', true)");
    await client.query('update profiles set balance = greatest(coalesce(balance,0), 500) where id = $1', [userId]);
    await client.query('commit');
  } catch (e) {
    await client.query('rollback');
    throw e;
  }
}

for (const slot of slots) {
  const nn = String(slot).padStart(2, '0');
  const posterId = await idFor(poolAccount('poster', slot).email);
  const tag = '[shoal] s' + nn + ' ';
  const hunterSlots = [0, 1, 2].map(k => ((slot - 1 + k) % HUNTER_SLOTS) + 1);
  const hunterIds = [];
  for (const h of hunterSlots) hunterIds.push(await idFor(poolAccount('hunter', h).email));

  let removed = 0;
  for (const t of Object.values(JOBS)) removed += await removeOwn(posterId, tag + t);
  await topUp(posterId);

  // 1. Garage: open, pay when you choose, three offers.
  const garageId = randomUUID();
  await insertBounty({
    id: garageId,
    title: tag + JOBS.garage,
    description:
      'Three dining chairs, an old sofa and a broken dresser in my garage. They need to go to the curb or the dump. The garage is at street level. Test job, safe to delete.',
    amount: 60,
    posterId,
    fundingMode: 'at_accept',
  });
  for (let k = 0; k < 3; k++) {
    await apply(garageId, posterId, hunterIds[k], OFFER_MESSAGES[k]);
    // Arrival order: the first offer came in yesterday, the others since.
    await client.query(
      "update bounty_requests set created_at = now() - make_interval(hours => $3) where bounty_id = $1 and hunter_id = $2",
      [garageId, hunterIds[k], 30 - k * 10]
    );
  }
  await client.query("update bounties set created_at = now() - interval '2 days' where id = $1", [garageId]);

  // 2. Tap: hired 4 days ago, no word from the helper since.
  const tapId = randomUUID();
  await insertBounty({
    id: tapId,
    title: tag + JOBS.tap,
    description: 'The kitchen tap drips all night. I have a new washer but cannot reach under the sink. Test job, safe to delete.',
    amount: 45,
    posterId,
    fundingMode: 'at_post',
  });
  const linked = links[slot] ? await idFor(poolAccount('hunter', links[slot]).email) : null;
  const tapReq = await apply(tapId, posterId, linked ?? hunterIds[0], 'I can fix that, I have the tools.');
  await client.query('select fn_accept_bounty_request($1)', [tapReq]);
  await client.query(
    "update bounty_requests set created_at = now() - interval '5 days', accepted_at = now() - interval '4 days' where id = $1",
    [tapReq]
  );
  await client.query("update bounties set created_at = now() - interval '6 days' where id = $1", [tapId]);

  // 3. Dry cleaning: hired 2 days ago, work submitted with a photo.
  const dcId = randomUUID();
  await insertBounty({
    id: dcId,
    title: tag + JOBS.cleaning,
    description: 'Collect three shirts and a coat from Main Street Cleaners and leave them with my neighbour at number 12. Test job, safe to delete.',
    amount: 25,
    posterId,
    fundingMode: 'at_post',
  });
  const dcReq = await apply(dcId, posterId, linked ?? hunterIds[1], 'I pass the cleaners every day, happy to do it.');
  await client.query('select fn_accept_bounty_request($1)', [dcReq]);
  await client.query(
    "update bounty_requests set created_at = now() - interval '3 days', accepted_at = now() - interval '2 days' where id = $1",
    [dcReq]
  );
  await client.query("update bounties set created_at = now() - interval '3 days' where id = $1", [dcId]);
  await client.query(
    'insert into completion_submissions (id, bounty_id, hunter_id, message, proof_items, status, submitted_at, created_at, updated_at) ' +
      "values ($1,$2,$3,$4,$5,'pending',now() - interval '3 hours',now(),now())",
    [
      randomUUID(),
      dcId,
      linked ?? hunterIds[1],
      'All done. I picked up your three shirts and the coat and left them with your neighbour at number 12, as you asked.',
      JSON.stringify([PROOF]),
    ]
  );

  await topUp(posterId);
  const bal = (await client.query('select balance from profiles where id = $1', [posterId])).rows[0].balance;
  console.log(
    '  s' + nn + ': garage ' + garageId.slice(0, 8) + ' (3 offers from hunters ' + hunterSlots.join('/') + '), tap ' +
      tapId.slice(0, 8) + ' (hired 4d, silent), cleaning ' + dcId.slice(0, 8) + ' (submitted)  replaced ' + removed +
      ', test balance ' + bal
  );
}

if (openPoster) {
  const posterId = await idFor(poolAccount('poster', openPoster).email);
  const tag = '[shoal] s' + String(openPoster).padStart(2, '0') + ' ';
  const OPEN = [
    ['Help carry groceries in from the car', 'Every Saturday around 11am I come back from the store with 6 to 8 bags. I need someone to carry them up one flight of stairs to my kitchen. Takes about 15 minutes. Test job, safe to delete.', 20],
    ['Rake leaves in my front yard', 'Small front yard, maybe 40 minutes of raking. I have the rake and the bags; please put the bags at the curb. Any day this week. Test job, safe to delete.', 35],
    ['Put together a bookshelf', 'A flat-pack bookshelf (5 shelves) is in the box in my living room. I have a screwdriver but not the patience. Should take about an hour. Test job, safe to delete.', 40],
  ];
  let removed = 0;
  for (const [t] of OPEN) removed += await removeOwn(posterId, tag + t);
  for (const [t, d, amount] of OPEN) {
    await insertBounty({ id: randomUUID(), title: tag + t, description: d, amount, posterId, fundingMode: 'at_accept' });
  }
  console.log('  s' + String(openPoster).padStart(2, '0') + ': ' + OPEN.length + ' open jobs for discovery (replaced ' + removed + ')');
}

await client.end();
console.log('\n  done. Every row is titled "[shoal] sNN ..." and is safe to delete.\n');
