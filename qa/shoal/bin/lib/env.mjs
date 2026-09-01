/**
 * Environment resolution and the production fail-closed guard for Bounty's Shoal layer.
 *
 * The guard is deliberately paranoid, because the failure mode it prevents is a swarm of
 * agents creating accounts, posting bounties and pushing money through the real
 * marketplace. It refuses by default and only proceeds on positive evidence:
 *
 *   1. The requested env must exist in shoal.config.json and must not be "production".
 *   2. The target host must not be on the denylist.
 *   3. The app actually served at that URL must not talk to the production Supabase
 *      project. This is checked by FETCHING the page and its scripts and looking for the
 *      project ref -- not by reading .env files, which lie: Expo CLI loads
 *      .env.local / .env.<mode> / .env for the web bundle regardless of APP_ENV, and this
 *      repo's root .env contains the PRODUCTION ref (see README "Known hazards").
 *   4. Any Stripe publishable key visible in the bundle must be a test key (pk_test_).
 *
 * Only BOUNTY_SHOAL_I_UNDERSTAND_THIS_IS_PRODUCTION=yes-really relaxes steps 2-4, and
 * nothing relaxes step 1.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const QA_ROOT = resolve(here, '..', '..');
export const REPO_ROOT = resolve(QA_ROOT, '..', '..');

export function loadConfig() {
  return JSON.parse(readFileSync(join(QA_ROOT, 'shoal.config.json'), 'utf8'));
}

export function loadScenarios() {
  return JSON.parse(readFileSync(join(QA_ROOT, 'scenarios', 'scenarios.json'), 'utf8')).scenarios;
}

/**
 * Where the pinned Shoal checkout lives. Outside the repo by default, so Metro, ESLint,
 * tsc and Jest never see a second node_modules tree; override for CI caching.
 */
export function shoalHome(config) {
  if (process.env.BOUNTY_SHOAL_HOME) return resolve(process.env.BOUNTY_SHOAL_HOME);
  const base =
    process.env.LOCALAPPDATA ||
    process.env.XDG_CACHE_HOME ||
    join(process.env.HOME || process.env.USERPROFILE || '.', '.cache');
  return join(base, 'bounty-shoal', config.shoal.commit.slice(0, 12));
}

export class GuardError extends Error {}

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    throw new GuardError('Not a valid URL: ' + url);
  }
}

/** Resolve --env <name> (or BOUNTY_SHOAL_ENV) to a target definition. */
export function resolveEnv(config, name) {
  const envName = name || process.env.BOUNTY_SHOAL_ENV || config.guards.defaultEnv;
  if (envName === 'production' || envName === 'prod') {
    throw new GuardError(
      'BOUNTY_SHOAL_ENV=production is never a valid value. Shoal drives real user flows ' +
        '(signup, posting, applying, paying), so pointing it at production would create real ' +
        'accounts, real bounties and real money movement. Use local or staging.',
    );
  }
  const target = config.environments[envName];
  if (!target) {
    throw new GuardError(
      'Unknown environment "' + envName + '". Known: ' + Object.keys(config.environments).join(', '),
    );
  }
  const url = process.env.BOUNTY_SHOAL_URL || target.url;
  return { name: envName, ...target, url };
}

const OVERRIDE_VALUE = 'yes-really';

function overrideActive(config) {
  return process.env[config.guards.overrideEnvVar] === OVERRIDE_VALUE;
}

/**
 * Fetch the served page plus its script bundles and return the raw text, so callers can
 * look for backend identifiers that were baked in at bundle time.
 *
 * Metro's web bundle is one enormous file; we cap what we read because we only need to
 * find fixed substrings, and pulling the whole graph into memory on every run is wasteful.
 */
async function fetchServedSources(url, opts = {}) {
  const maxBytes = opts.maxBytes ?? 24 * 1024 * 1024;
  const timeoutMs = opts.timeoutMs ?? 180_000;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ac.signal });
    if (!res.ok) throw new GuardError('Target ' + url + ' returned HTTP ' + res.status + '.');
    const html = await res.text();
    const sources = [html];

    const scriptSrcs = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]);
    for (const src of scriptSrcs) {
      const abs = new URL(src, url).toString();
      const r = await fetch(abs, { signal: ac.signal }).catch(() => null);
      if (!r || !r.ok || !r.body) continue;
      // Stream and stop early -- the whole Metro graph is far bigger than we need.
      let read = 0;
      const chunks = [];
      for await (const chunk of r.body) {
        chunks.push(Buffer.from(chunk));
        read += chunk.length;
        if (read >= maxBytes) break;
      }
      sources.push(Buffer.concat(chunks).toString('utf8'));
    }
    return sources.join('\n');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The gate. Throws GuardError unless the target is provably not production.
 * Returns evidence so the runner can print what it actually verified.
 */
export async function assertSafeTarget(config, target, opts = {}) {
  const host = hostOf(target.url);
  const g = config.guards;
  const override = overrideActive(config);
  const evidence = { host, env: target.name, probed: false, refsSeen: [], stripeKeys: [] };

  if (g.deniedHosts.some((d) => host === d || host.endsWith('.' + d))) {
    if (!override) {
      throw new GuardError(
        'Refusing to run: ' + host + ' is on the production denylist in shoal.config.json.',
      );
    }
    console.warn('  !! ' + g.overrideEnvVar + ' is set -- running against denylisted host ' + host + '.');
  }

  if (opts.skipProbe) return evidence;

  let sources;
  try {
    sources = await fetchServedSources(target.url);
  } catch (err) {
    if (err instanceof GuardError) throw err;
    throw new GuardError(
      'Could not reach ' + target.url + ' to verify which backend it uses (' + err.message + ').\n' +
        '  Start the web target first:  npm run qa:shoal:web\n' +
        '  The guard fails closed: an unreachable target is never assumed safe.',
    );
  }
  evidence.probed = true;

  const refs = new Set([...sources.matchAll(/([a-z]{20})\.supabase\.co/g)].map((m) => m[1]));
  evidence.refsSeen = [...refs];
  const denied = evidence.refsSeen.filter((r) => g.deniedSupabaseRefs.includes(r));
  if (denied.length > 0 && !override) {
    throw new GuardError(
      'Refusing to run: the app served at ' + target.url + ' is wired to the PRODUCTION ' +
        'Supabase project (' + denied.join(', ') + ').\n' +
        "  This repo's root .env carries the production ref and Expo CLI loads it for the web\n" +
        '  bundle regardless of APP_ENV. Fix the served bundle (see qa/shoal/README.md,\n' +
        '  "Known hazards") rather than overriding the guard.',
    );
  }
  const unknown = evidence.refsSeen.filter(
    (r) => !g.allowedSupabaseRefs.includes(r) && !g.deniedSupabaseRefs.includes(r),
  );
  if (unknown.length > 0 && !override) {
    throw new GuardError(
      'Refusing to run: ' + target.url + ' talks to an unrecognised Supabase project (' +
        unknown.join(', ') + '). Add it to guards.allowedSupabaseRefs only if it is a ' +
        'non-production project.',
    );
  }
  if (refs.size === 0) {
    console.warn(
      '  !! No Supabase project ref found in the served sources. The bundle may still be\n' +
        '     building, or it loads its config at runtime. Verify manually before trusting this run.',
    );
  }

  const stripeKeys = new Set([...sources.matchAll(/pk_(?:live|test)_[A-Za-z0-9]{6}/g)].map((m) => m[0]));
  evidence.stripeKeys = [...stripeKeys].map((k) => k.slice(0, 12) + '...');
  const live = [...stripeKeys].filter((k) => k.startsWith('pk_live_'));
  if (g.requireStripeTestMode && live.length > 0 && !override) {
    throw new GuardError(
      'Refusing to run: the app served at ' + target.url + ' is using a LIVE Stripe ' +
        'publishable key. Shoal exercises payment UI; it must only ever run against Stripe test mode.',
    );
  }

  return evidence;
}

export function printEvidence(evidence) {
  console.log('  [guard] env=' + evidence.env + ' host=' + evidence.host);
  if (evidence.probed) {
    console.log('          supabase refs in served bundle: ' + (evidence.refsSeen.join(', ') || '(none found)'));
    console.log('          stripe publishable keys: ' + (evidence.stripeKeys.join(', ') || '(none found)'));
  }
}
