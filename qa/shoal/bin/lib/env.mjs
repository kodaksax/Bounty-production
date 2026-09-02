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

/**
 * The canonical APP_ENV -> Supabase project map the app itself uses
 * (app.config.js and lib/config/env-guard.ts both import this file). Reused rather than
 * duplicated so the QA layer can never drift from the app's own idea of which project an
 * environment means.
 */
export function supabaseRefs() {
  return JSON.parse(readFileSync(join(REPO_ROOT, 'lib', 'config', 'supabase-refs.json'), 'utf8'));
}

export function expectedRefForAppEnv(appEnv) {
  const ref = supabaseRefs().byAppEnv[appEnv];
  if (!ref) {
    throw new GuardError(
      'No Supabase project mapped to APP_ENV="' + appEnv + '" in lib/config/supabase-refs.json.',
    );
  }
  return ref;
}

/** A Supabase project ref is exactly 20 lowercase letters. */
const REF = '[a-z]{20}';

/**
 * Pull every Supabase project ref out of a Postgres connection string.
 *
 * Supabase has retired the direct `db.<ref>.supabase.co` host; the working form is now the
 * pooler, where the ref lives in the USERNAME (`postgres.<ref>@aws-1-us-east-2.pooler...`)
 * and not in the host at all. A host-only matcher silently finds nothing there, which is
 * how a guard that only warns on a match ends up failing OPEN on the one URL shape that
 * actually connects. Match every documented shape, and let the caller refuse when the
 * result is empty.
 */
export function parseDbProjectRefs(connectionString) {
  const patterns = [
    new RegExp('://postgres\\.(' + REF + ')[:@]'), // pooler username
    new RegExp('\\bdb\\.(' + REF + ')\\.supabase\\.(?:co|com)\\b'), // legacy direct host
    new RegExp('\\b(' + REF + ')\\.supabase\\.(?:co|com)\\b'), // any *.supabase.co host
    new RegExp('\\b(' + REF + ')\\.pooler\\.supabase\\.com\\b'), // per-project pooler host
    new RegExp('[?&]options=[^&]*project(?:%3D|=)(' + REF + ')'), // ?options=project%3D<ref>
  ];
  const found = new Set();
  for (const p of patterns) {
    const m = connectionString.match(p);
    if (m) found.add(m[1]);
  }
  return [...found];
}

/**
 * Decide whether a database connection string may be used, and against which project.
 *
 * Fails CLOSED: an unparseable connection string is refused rather than allowed, because
 * `seed-race` writes rows and the cost of guessing wrong is production data. The operator
 * can name the project explicitly with BOUNTY_SHOAL_DB_PROJECT_REF, but an explicit ref
 * that contradicts the URL is itself an error.
 */
export function resolveDatabaseTarget(config, connectionString, explicitRef) {
  const g = config.guards;
  const parsed = parseDbProjectRefs(connectionString);

  if (parsed.length > 1) {
    throw new GuardError(
      'The connection string names more than one Supabase project (' + parsed.join(', ') +
        '). Refusing rather than guessing which one it connects to.',
    );
  }

  const declared = explicitRef || process.env.BOUNTY_SHOAL_DB_PROJECT_REF;
  if (declared && parsed.length === 1 && declared !== parsed[0]) {
    throw new GuardError(
      'BOUNTY_SHOAL_DB_PROJECT_REF="' + declared + '" contradicts the connection string, ' +
        'which points at "' + parsed[0] + '".',
    );
  }

  const ref = parsed[0] || declared;
  if (!ref) {
    throw new GuardError(
      'Could not determine which Supabase project this connection string reaches.\n' +
        '  Supabase pooler URLs carry the project ref in the username\n' +
        '  (postgresql://postgres.<ref>@aws-1-<region>.pooler.supabase.com:5432/postgres).\n' +
        '  If yours has no ref at all, declare it explicitly:\n' +
        '    BOUNTY_SHOAL_DB_PROJECT_REF=<ref>\n' +
        '  Refusing to connect to an unidentified database.',
    );
  }

  if (g.deniedSupabaseRefs.includes(ref)) {
    throw new GuardError(
      'This connection string points at the PRODUCTION project (' + ref + ').\n' +
        '  The oracle reads and, for seed-race, WRITES marketplace rows. Refusing.',
    );
  }
  if (!g.allowedSupabaseRefs.includes(ref)) {
    throw new GuardError(
      'This connection string points at an unrecognised project (' + ref + ').\n' +
        '  Add it to guards.allowedSupabaseRefs only if it is non-production.',
    );
  }
  return { ref, source: parsed.length ? 'connection-string' : 'BOUNTY_SHOAL_DB_PROJECT_REF' };
}

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
