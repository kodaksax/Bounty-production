/**
 * The per-agent test-account pool.
 *
 * Why a pool at all: Shoal's CLI has no way to inject an authenticated browser context,
 * so an authenticated scenario has to hand the agent credentials in text. Until now
 * there was ONE poster account and ONE hunter account, and every agent in the swarm was
 * given the same one. A swarm of six therefore ran six concurrent sessions on a single
 * user, all posting, applying, funding and cancelling against each other's rows. Every
 * state observation was then confounded: "my draft vanished" and "there are bounties I
 * did not post" are indistinguishable from another agent's writes, so the state-breaker
 * and duplicate-submission scenarios could not produce a trustworthy finding. (It also
 * poisoned the duplicate-bounties oracle, which groups by poster_id: five agents posting
 * the same seeded errand on one account looks exactly like one agent double-submitting.)
 *
 * With one account per swarm slot, an agent's own state is its own.
 *
 * Identity and passwords are DERIVED, never stored:
 *
 *   email    = qa+shoal-<role>-<nn>@bountyfinder.test        (deterministic)
 *   password = HMAC-SHA256(BOUNTY_SHOAL_POOL_SECRET, email)  (deterministic)
 *
 * so `seed.mjs` and `run.mjs` agree on the whole pool from a single secret, with no
 * credential file to write, commit, rotate or leak. Changing the secret rotates every
 * password in the pool at the next seed.
 */
import { createHmac } from 'node:crypto';

/** Reserved slot 0 -- see `poolAccount`. */
export const RESERVED_SLOT = 0;

export const POOL_SECRET_ENV = 'BOUNTY_SHOAL_POOL_SECRET';

/** Roles the pool covers. Scenario side (poster vs hunter) picks between them. */
export const POOL_ROLES = ['poster', 'hunter'];

/** Anything at this domain is unroutable, so a stray signup email can never be delivered. */
const DOMAIN = 'bountyfinder.test';

/**
 * The account for one swarm slot.
 *
 * Slot numbering starts at 1 for agents. Slot 0 exists but is never handed to an agent:
 * it is a spare an operator can sign into by hand to inspect what the swarm did without
 * disturbing any agent's state.
 */
export function poolAccount(role, slot) {
  if (!POOL_ROLES.includes(role)) {
    throw new Error('Unknown pool role "' + role + '" (want one of ' + POOL_ROLES.join(', ') + ')');
  }
  if (!Number.isInteger(slot) || slot < 0 || slot > 99) {
    throw new Error('Pool slot must be an integer 0..99, got ' + slot);
  }
  const nn = String(slot).padStart(2, '0');
  return {
    role,
    slot,
    email: 'qa+shoal-' + role + '-' + nn + '@' + DOMAIN,
    username: 'shoal_' + role + '_' + nn,
  };
}

/** Slots 1..count, i.e. the accounts a swarm of `count` agents will be given. */
export function poolAccounts(role, count) {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error('Pool size must be a positive integer, got ' + count);
  }
  return Array.from({ length: count }, (_, i) => poolAccount(role, i + 1));
}

/**
 * Derive the password for an account.
 *
 * The fixed prefix guarantees the upper/lower/digit/symbol mix Supabase's password policy
 * can be configured to require, regardless of what the HMAC happens to encode to.
 */
export function derivePassword(secret, email) {
  if (!secret) throw new Error(POOL_SECRET_ENV + ' is required to derive pool passwords.');
  const digest = createHmac('sha256', secret).update(email).digest('base64url');
  return 'Sh0al!' + digest.slice(0, 26);
}

/**
 * Read the pool secret, or explain precisely how to get one.
 *
 * Fails loudly rather than falling back to a default: a predictable default would make
 * every pool account's password guessable from this file alone.
 */
export function requirePoolSecret() {
  const secret = process.env[POOL_SECRET_ENV];
  if (!secret || secret.length < 16) {
    throw new Error(
      POOL_SECRET_ENV +
        (secret ? ' is too short (need at least 16 characters).' : ' is not set.') +
        '\n  Every per-agent account password is derived from it, so seeding and running\n' +
        '  must use the same value. Generate one once and keep it with your other secrets:\n' +
        '    export ' + POOL_SECRET_ENV + '=$(node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64url\'))")\n' +
        '  Then re-seed:  node qa/shoal/bin/seed.mjs accounts --env staging',
    );
  }
  return secret;
}

/** Every account in the pool, slot 0 included, with its derived password. */
export function fullPool(secret, count) {
  const out = [];
  for (const role of POOL_ROLES) {
    for (let slot = RESERVED_SLOT; slot <= count; slot++) {
      const account = poolAccount(role, slot);
      out.push({ ...account, password: derivePassword(secret, account.email) });
    }
  }
  return out;
}

/**
 * How large a pool the scenario registry needs: the biggest swarm any authenticated
 * scenario runs. Seeding this many means no authenticated scenario is ever short of
 * accounts, without the operator having to work it out.
 */
export function requiredPoolSize(scenarios) {
  const sizes = scenarios.filter((s) => s.requiresAuth).map((s) => Number(s.swarm) || 0);
  return Math.max(1, ...sizes);
}
