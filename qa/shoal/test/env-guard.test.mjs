/**
 * Regression tests for the QA layer's environment resolution and production guards.
 *
 * Run with `npm run qa:shoal:test` (node:test, no Jest). These deliberately do NOT live
 * under __tests__/: Jest here is CJS + ts-jest with no ESM transform, and wiring these
 * .mjs modules into it would mean loosening the very isolation this layer depends on.
 *
 * Everything here is pure -- no network, no database, no Shoal checkout required -- so it
 * is safe to run anywhere, including as the first step of the CI workflow.
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { describe, it } from 'node:test';
import {
  GuardError,
  assertSafeTarget,
  expectedRefForAppEnv,
  loadConfig,
  loadScenarios,
  parseDbProjectRefs,
  resolveDatabaseTarget,
  resolveEnv,
} from '../bin/lib/env.mjs';

const config = loadConfig();
const PROD = 'xwlwqzzphmmhghiqvkeu';
const STAGING = 'gwumwpoomwvkjyibdmpj';
const DEV = 'ajsbkocnixpwbrjokvnq';

async function withServedBundle(bundle, fn) {
  const server = createServer((req, res) => {
    if (req.url === '/bundle.js') {
      res.writeHead(200, { 'content-type': 'application/javascript' });
      res.end(bundle);
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<html><script src="/bundle.js"></script></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) =>
      server.close(error => (error ? reject(error) : resolve())),
    );
  }
}

/** Run `fn` with `env` applied, then restore -- these guards read process.env directly. */
function withEnv(env, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

describe('supabase ref parsing', () => {
  it('finds the ref in a pooler URL, where it lives in the username', () => {
    // The regression that mattered: Supabase retired db.<ref>.supabase.co, so the pooler
    // is the only form that connects -- and a host-only matcher finds nothing in it.
    assert.deepEqual(
      parseDbProjectRefs(
        'postgresql://postgres.' + PROD + ':pw@aws-1-us-east-2.pooler.supabase.com:5432/postgres',
      ),
      [PROD],
    );
  });

  it('finds the ref in a legacy direct-host URL', () => {
    assert.deepEqual(
      parseDbProjectRefs('postgresql://postgres:pw@db.' + STAGING + '.supabase.co:5432/postgres'),
      [STAGING],
    );
  });

  it('finds the ref in an ?options=project form', () => {
    assert.deepEqual(
      parseDbProjectRefs(
        'postgresql://postgres:pw@aws-1-us-east-2.pooler.supabase.com:5432/postgres?options=project%3D' +
          DEV,
      ),
      [DEV],
    );
  });

  it('returns nothing for a URL that names no project', () => {
    assert.deepEqual(parseDbProjectRefs('postgresql://postgres:pw@localhost:5432/postgres'), []);
  });
});

describe('resolveDatabaseTarget', () => {
  it('REFUSES a production pooler URL', () => {
    const url =
      'postgresql://postgres.' + PROD + ':pw@aws-1-us-east-2.pooler.supabase.com:5432/postgres';
    assert.throws(
      () => withEnv({ BOUNTY_SHOAL_DB_PROJECT_REF: undefined }, () => resolveDatabaseTarget(config, url)),
      (e) => e instanceof GuardError && /PRODUCTION/.test(e.message),
    );
  });

  it('REFUSES a production legacy-host URL', () => {
    const url = 'postgresql://postgres:pw@db.' + PROD + '.supabase.co:5432/postgres';
    assert.throws(
      () => withEnv({ BOUNTY_SHOAL_DB_PROJECT_REF: undefined }, () => resolveDatabaseTarget(config, url)),
      (e) => e instanceof GuardError && /PRODUCTION/.test(e.message),
    );
  });

  it('FAILS CLOSED when the project cannot be determined', () => {
    assert.throws(
      () =>
        withEnv({ BOUNTY_SHOAL_DB_PROJECT_REF: undefined }, () =>
          resolveDatabaseTarget(config, 'postgresql://postgres:pw@localhost:5432/postgres'),
        ),
      (e) => e instanceof GuardError && /Could not determine/.test(e.message),
    );
  });

  it('refuses an explicit ref that contradicts the URL', () => {
    const url =
      'postgresql://postgres.' + STAGING + ':pw@aws-1-us-east-2.pooler.supabase.com:5432/postgres';
    assert.throws(
      () => resolveDatabaseTarget(config, url, PROD),
      (e) => e instanceof GuardError && /contradicts/.test(e.message),
    );
  });

  it('refuses a URL naming two different projects', () => {
    const url =
      'postgresql://postgres.' + STAGING + ':pw@db.' + DEV + '.supabase.co:5432/postgres';
    assert.throws(
      () => resolveDatabaseTarget(config, url),
      (e) => e instanceof GuardError && /more than one/.test(e.message),
    );
  });

  it('refuses an unrecognised project', () => {
    const url = 'postgresql://postgres.abcdefghijklmnopqrst:pw@aws-1-us-east-2.pooler.supabase.com:5432/postgres';
    assert.throws(
      () => resolveDatabaseTarget(config, url),
      (e) => e instanceof GuardError && /unrecognised/.test(e.message),
    );
  });

  it('ALLOWS the staging pooler URL', () => {
    const url =
      'postgresql://postgres.' + STAGING + ':pw@aws-1-us-east-2.pooler.supabase.com:5432/postgres';
    const r = withEnv({ BOUNTY_SHOAL_DB_PROJECT_REF: undefined }, () =>
      resolveDatabaseTarget(config, url),
    );
    assert.equal(r.ref, STAGING);
    assert.equal(r.source, 'connection-string');
  });

  it('accepts an explicitly declared ref when the URL carries none', () => {
    const r = resolveDatabaseTarget(config, 'postgresql://postgres:pw@localhost:5432/postgres', STAGING);
    assert.equal(r.ref, STAGING);
    assert.equal(r.source, 'BOUNTY_SHOAL_DB_PROJECT_REF');
  });
});

describe('resolveEnv', () => {
  it('refuses production outright, with no override path', () => {
    for (const name of ['production', 'prod']) {
      assert.throws(
        () => resolveEnv(config, name),
        (e) => e instanceof GuardError && /never a valid value/.test(e.message),
      );
    }
  });

  it('refuses an unknown environment', () => {
    assert.throws(() => resolveEnv(config, 'nope'), (e) => e instanceof GuardError);
  });

  it('resolves the known environments', () => {
    for (const name of Object.keys(config.environments)) {
      assert.equal(resolveEnv(config, name).name, name);
    }
  });
});

describe('payment walkthrough target evidence', () => {
  const options = { requiredSupabaseRef: STAGING, requireStripeTestKey: true };

  it('accepts only positive evidence of staging and Stripe test mode', async () => {
    await withServedBundle(`${STAGING}.supabase.co pk_test_abcdef`, async url => {
      const evidence = await assertSafeTarget(config, { name: 'staging', url }, options);
      assert.deepEqual(evidence.refsSeen, [STAGING]);
      assert.deepEqual(evidence.stripeKeys, ['pk_test_abcd...']);
    });
  });

  it('refuses missing or non-staging Supabase evidence', async () => {
    for (const bundle of ['pk_test_abcdef', `${STAGING}.supabase.co ${DEV}.supabase.co pk_test_abcdef`]) {
      await withServedBundle(bundle, async url => {
        await assert.rejects(
          assertSafeTarget(config, { name: 'staging', url }, options),
          error => error instanceof GuardError && /must use only Supabase project/.test(error.message),
        );
      });
    }
  });

  it('refuses missing or live Stripe key evidence', async () => {
    for (const bundle of [`${STAGING}.supabase.co`, `${STAGING}.supabase.co pk_live_abcdef`]) {
      await withServedBundle(bundle, async url => {
        await assert.rejects(
          assertSafeTarget(config, { name: 'staging', url }, options),
          error => error instanceof GuardError && /Stripe test-mode/.test(error.message),
        );
      });
    }
  });

  it('refuses to skip a required evidence probe', async () => {
    await assert.rejects(
      assertSafeTarget(config, { name: 'staging', url: 'http://127.0.0.1:8090' }, {
        ...options,
        skipProbe: true,
      }),
      error => error instanceof GuardError && /probe is skipped/.test(error.message),
    );
  });
});

describe('config invariants', () => {
  it('never allowlists the production project', () => {
    assert.ok(!config.guards.allowedSupabaseRefs.includes(PROD));
    assert.ok(config.guards.deniedSupabaseRefs.includes(PROD));
  });

  it('agrees with the app\'s own APP_ENV -> project map', () => {
    // If someone repoints an environment in lib/config/supabase-refs.json, this catches
    // the QA layer silently continuing to allow the old project.
    assert.equal(expectedRefForAppEnv('production'), PROD);
    for (const [name, env] of Object.entries(config.environments)) {
      assert.ok(env.appEnv, name + ' must declare an appEnv');
      assert.notEqual(
        expectedRefForAppEnv(env.appEnv),
        PROD,
        name + ' resolves to the production project',
      );
      assert.ok(
        config.guards.allowedSupabaseRefs.includes(expectedRefForAppEnv(env.appEnv)),
        name + ' resolves to a project that is not allowlisted',
      );
    }
  });

  it('every scenario references a real Shoal strategy and declares triage tags', () => {
    const SHOAL_STRATEGIES = new Set([
      'complete-task', 'explore', 'adversarial-input', 'rage-quit',
      'dark-patterns', 'state-breaker', 'race',
    ]);
    for (const s of loadScenarios()) {
      assert.ok(s.strategy?.length, s.id + ' has no strategy');
      for (const st of s.strategy) {
        assert.ok(SHOAL_STRATEGIES.has(st), s.id + ' uses unknown strategy "' + st + '"');
      }
      assert.ok(s.tags?.funnel?.length, s.id + ' has no funnel tags');
      assert.ok(s.tags?.area?.length, s.id + ' has no area tags');
      assert.ok(typeof s.task === 'string' && s.task.length > 80, s.id + ' has no real task');
    }
  });
});
