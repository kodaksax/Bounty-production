#!/usr/bin/env node
/**
 * Prove that no client role can execute the wallet-crediting RPCs.
 *
 *   node scripts/verify-apply-deposit-permissions.mjs [--env .env.production]
 *
 * 20260310_apply_deposit.sql granted EXECUTE on `apply_deposit` to
 * `authenticated`. Because the RPC is SECURITY DEFINER and takes both the
 * crediting user id and the amount as parameters, that grant let any signed-in
 * user mint arbitrary wallet balance. 20260830_secure_apply_deposit.sql revokes
 * it (along with `update_balance` and `apply_escrow`), but a migration that ran
 * is not proof a guardrail is armed — this script checks the live database.
 *
 * Money safety: every probe passes a freshly generated random UUID as the
 * target user. If a call were somehow permitted, `apply_deposit` raises
 * 'Profile not found' and `update_balance` raises 'User not found', and the
 * whole statement — including the wallet_transactions insert — is rolled back.
 * The script asserts afterwards that it wrote nothing. It never touches a real
 * account and never moves money.
 *
 * Requires, in the chosen env file: SUPABASE_URL, SUPABASE_ANON_KEY,
 * SUPABASE_SERVICE_ROLE_KEY and SUPABASE_JWT_SECRET (to mint the throwaway
 * `authenticated` JWT used for the probe).
 */
import fs from 'fs';
import crypto from 'crypto';

const envArgIndex = process.argv.indexOf('--env');
const envFile = envArgIndex > -1 ? process.argv[envArgIndex + 1] : '.env.production';

if (!fs.existsSync(envFile)) {
  console.error(`Env file not found: ${envFile}`);
  process.exit(1);
}

const env = fs.readFileSync(envFile, 'utf8');
const readEnv = key => {
  const match = env.match(new RegExp(`^${key}=(.*)$`, 'm'));
  return match ? match[1].trim().replace(/^["']|["']$/g, '') : '';
};

const supabaseUrl = readEnv('SUPABASE_URL') || readEnv('EXPO_PUBLIC_SUPABASE_URL');
const anonKey = readEnv('SUPABASE_ANON_KEY') || readEnv('EXPO_PUBLIC_SUPABASE_ANON_KEY');
const serviceKey = readEnv('SUPABASE_SERVICE_ROLE_KEY');
const jwtSecret = readEnv('SUPABASE_JWT_SECRET');

for (const [name, value] of Object.entries({
  SUPABASE_URL: supabaseUrl,
  SUPABASE_ANON_KEY: anonKey,
  SUPABASE_SERVICE_ROLE_KEY: serviceKey,
  SUPABASE_JWT_SECRET: jwtSecret,
})) {
  if (!value) {
    console.error(`Missing ${name} in ${envFile}`);
    process.exit(1);
  }
}

const b64 = obj => Buffer.from(JSON.stringify(obj)).toString('base64url');
function mintAuthenticatedJwt(sub) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64({ alg: 'HS256', typ: 'JWT' });
  const payload = b64({ aud: 'authenticated', role: 'authenticated', sub, iat: now, exp: now + 300 });
  const signature = crypto
    .createHmac('sha256', jwtSecret)
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${signature}`;
}

const ghostUser = crypto.randomUUID();
const probeIntentId = `pi_permission_probe_${ghostUser.replace(/-/g, '')}`;
const authenticatedJwt = mintAuthenticatedJwt(ghostUser);

const PROBES = [
  {
    fn: 'apply_deposit',
    body: {
      p_user_id: ghostUser,
      p_amount: 0.01,
      p_payment_intent_id: probeIntentId,
      p_metadata: { probe: true },
    },
  },
  { fn: 'update_balance', body: { p_user_id: ghostUser, p_amount: 0.01 } },
  {
    fn: 'apply_escrow',
    body: {
      p_user_id: ghostUser,
      p_bounty_id: ghostUser,
      p_amount: 0.01,
      p_description: 'permission probe',
      p_metadata: { probe: true },
    },
  },
];

async function probe(fn, body, token) {
  const res = await fetch(`${supabaseUrl}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  let payload;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }
  return { status: res.status, code: payload?.code ?? null, message: payload?.message ?? null };
}

let failures = 0;

console.log(`Verifying wallet-credit RPC permissions against ${supabaseUrl} (${envFile})\n`);

for (const { fn, body } of PROBES) {
  for (const [role, token] of [
    ['anon', anonKey],
    ['authenticated', authenticatedJwt],
  ]) {
    const result = await probe(fn, body, token);
    const denied = result.code === '42501';
    console.log(
      `  ${denied ? 'PASS' : 'FAIL'}  ${role.padEnd(13)} ${fn.padEnd(15)} HTTP ${result.status} ${result.code ?? ''} ${result.message ?? ''}`
    );
    if (!denied) failures++;
  }
}

// The probes should have written nothing at all. Confirm with the service role.
const check = await fetch(
  `${supabaseUrl}/rest/v1/wallet_transactions?select=id&stripe_payment_intent_id=eq.${probeIntentId}`,
  { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
);
const written = await check.json();
if (Array.isArray(written) && written.length === 0) {
  console.log('\n  PASS  probes wrote no wallet_transactions rows');
} else {
  console.log('\n  FAIL  probe left rows behind:', JSON.stringify(written));
  failures++;
}

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED — a client role can still reach a crediting RPC.`);
  process.exit(1);
}

console.log('\nAll checks passed: apply_deposit, update_balance and apply_escrow are service_role only.');
