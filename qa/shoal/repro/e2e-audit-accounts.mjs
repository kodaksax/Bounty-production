#!/usr/bin/env node
/**
 * Create (or re-password) ONLY the pool slots named, for the 2026-11-24 senior-inclusive
 * end-to-end audit. STAGING ONLY.
 *
 * Why not `seed.mjs accounts --pool N`: that also (re)sets the shared
 * qa+shoal-poster@/qa+shoal-hunter@ passwords, and with BOUNTY_SHOAL_TEST_PASSWORD /
 * BOUNTY_SHOAL_HUNTER_PASSWORD unset it ROTATES them, breaking CI copies. This touches
 * nothing but the slots asked for, with the same password derivation and the same
 * onboarding_completed profile row seed.mjs writes.
 *
 *   BOUNTY_SHOAL_SERVICE_ROLE_KEY=<staging key> DOTENV_CONFIG_PATH=.env \
 *     node -r dotenv/config qa/shoal/repro/e2e-audit-accounts.mjs --role hunter --slots 13,14,15,16,17
 */
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
import { derivePassword, poolAccount, requirePoolSecret } from '../bin/lib/accounts.mjs';
import { expectedRefForAppEnv, loadConfig, resolveDatabaseTarget } from '../bin/lib/env.mjs';

const argv = process.argv.slice(2);
const opt = (f, d) => {
  const i = argv.indexOf('--' + f);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const role = opt('role', 'hunter');
const slots = opt('slots', '').split(',').filter(Boolean).map(Number);
if (!slots.length || slots.some((s) => !Number.isInteger(s) || s < 13)) {
  console.error('--slots must list new slots >= 13 (existing slots are seed.mjs territory)');
  process.exit(1);
}

const connectionString = process.env.BOUNTY_SHOAL_DATABASE_URL;
const target = resolveDatabaseTarget(loadConfig(), connectionString);
const stagingRef = expectedRefForAppEnv('staging');
if (target.ref !== stagingRef) {
  console.error('BLOCKED: database is ' + target.ref + ', not staging');
  process.exit(2);
}
const serviceKey = process.env.BOUNTY_SHOAL_SERVICE_ROLE_KEY;
if (!serviceKey) {
  console.error('BOUNTY_SHOAL_SERVICE_ROLE_KEY is not set (staging service-role key, this shell only)');
  process.exit(1);
}
// The key must belong to staging: its JWT payload names the project ref.
const keyRef = JSON.parse(Buffer.from(serviceKey.split('.')[1] || '', 'base64url').toString() || '{}').ref;
if (keyRef && keyRef !== stagingRef) {
  console.error('BLOCKED: service key is for ' + keyRef + ', not staging');
  process.exit(2);
}

const secret = requirePoolSecret();
const admin = createClient('https://' + stagingRef + '.supabase.co', serviceKey, { auth: { persistSession: false } });
const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
await client.connect();

for (const slot of slots) {
  const a = poolAccount(role, slot);
  const password = derivePassword(secret, a.email);
  const existing = (await client.query('select id from auth.users where email = $1', [a.email])).rows[0];
  let userId = existing?.id;
  if (userId) {
    const { error } = await admin.auth.admin.updateUserById(userId, { password, email_confirm: true });
    if (error) throw new Error(error.message);
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email: a.email,
      password,
      email_confirm: true,
      user_metadata: { username: a.username, shoal_test_account: true },
    });
    if (error) throw new Error(error.message);
    userId = data.user.id;
  }
  await client.query('begin');
  try {
    await client.query("select set_config('app.bypass_profile_guard', 'on', true)");
    await client.query(
      'insert into profiles (id, email, username, onboarding_completed, created_at, updated_at) ' +
        'values ($1, $2, $3, true, now(), now()) ' +
        'on conflict (id) do update set onboarding_completed = true, ' +
        '  username = coalesce(profiles.username, excluded.username), updated_at = now()',
      [userId, a.email, a.username],
    );
    await client.query('commit');
  } catch (e) {
    await client.query('rollback');
    throw e;
  }
  console.log('  ' + (existing ? 'reused ' : 'created') + ' ' + a.email + ' ' + userId.slice(0, 8));
}
await client.end();
