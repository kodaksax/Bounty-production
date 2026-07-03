/**
 * Integration tests: supabase module initialization + environment integrity guard
 *
 * Verifies that the safety behavior in initSupabase() correctly uses the result
 * of checkEnvironmentIntegrity() to decide whether to call createClient() or
 * fall back to the inert stub client, preventing cross-environment data leakage.
 *
 * Three scenarios (as required by the code review):
 *  (1) Matching channel/url → createClient() is invoked (real client path)
 *  (2) Mismatch → createClient() is NOT invoked, stub is used, mismatch flag set
 *  (3) No channel / unknown channel → createClient() is invoked (not blocked)
 *
 * Each test resets the module registry so lib/supabase.ts is freshly evaluated
 * with its own mocked dependencies. This mirrors the real initialization path
 * that runs once per app launch.
 */

const PROD_REF = 'xwlwqzzphmmhghiqvkeu';
const DEV_REF = 'ajsbkocnixpwbrjokvnq';
const PROD_URL = `https://${PROD_REF}.supabase.co`;
const DEV_URL = `https://${DEV_REF}.supabase.co`;
const ANON_KEY = 'test-anon-key';

/** Minimal Supabase client shape that passes validateSupabaseShape(). */
function makeRealClientMock() {
  return {
    from: jest.fn(() => ({})),
    auth: {
      onAuthStateChange: jest.fn(() => ({
        data: { subscription: { unsubscribe: jest.fn() } },
      })),
      getUser: jest.fn().mockResolvedValue({ data: { user: null }, error: null }),
      getSession: jest.fn().mockResolvedValue({ data: { session: null }, error: null }),
    },
    channel: jest.fn(() => ({ on: jest.fn(() => ({})), subscribe: jest.fn() })),
    removeChannel: jest.fn(),
    rpc: jest.fn().mockResolvedValue({ data: null, error: null }),
  };
}

/** Load a fresh copy of lib/supabase with controlled dependencies. */
async function loadSupabaseModule(
  overrides: {
    supabaseUrl?: string;
    integrityResult?: {
      ok: boolean;
      channel: string | null;
      expectedRef: string | null;
      actualRef: string | null;
      reason?: string;
    };
    createClientImpl?: jest.Mock;
  } = {}
) {
  jest.resetModules();

  const {
    supabaseUrl = PROD_URL,
    integrityResult = { ok: true, channel: null, expectedRef: null, actualRef: PROD_REF },
    createClientImpl = jest.fn(() => makeRealClientMock()),
  } = overrides;

  // Mock lib/config so the module sees our controlled URL/key
  jest.doMock('../../../lib/config', () => ({
    config: {
      supabase: { url: supabaseUrl, anonKey: ANON_KEY },
      api: { baseUrl: '' },
    },
    default: {
      supabase: { url: supabaseUrl, anonKey: ANON_KEY },
      api: { baseUrl: '' },
    },
    configDiagnostics: {},
  }));

  // Mock the env-guard to return our controlled result
  jest.doMock('../../../lib/config/env-guard', () => ({
    checkEnvironmentIntegrity: jest.fn(() => integrityResult),
    getBuildChannel: jest.fn(() => integrityResult.channel),
    projectRefFromUrl: jest.fn((url: string | null) =>
      url ? new URL(url).hostname.split('.')[0] : null
    ),
    CHANNEL_TO_SUPABASE_REF: {},
  }));

  // Track whether createClient is called
  jest.doMock('@supabase/supabase-js', () => ({
    createClient: createClientImpl,
  }));

  // Avoid native module errors from auth session storage
  jest.doMock('../../../lib/auth-session-storage', () => ({
    createAuthSessionStorageAdapter: jest.fn(() => ({
      getItem: jest.fn().mockResolvedValue(null),
      setItem: jest.fn().mockResolvedValue(undefined),
      removeItem: jest.fn().mockResolvedValue(undefined),
    })),
    getRememberMePreference: jest.fn().mockResolvedValue(true),
  }));

  // Import the freshly-mocked module
  const mod = await import('../../../lib/supabase');

  // Wait for initSupabase() to settle.
  // We CANNOT `await mod.supabase` directly: when checkEnvironmentIntegrity
  // returns ok:false the real client is replaced with the inert stub, and the
  // stub proxy exposes a `.then` property (to be chainable), which causes JS
  // Promise resolution to enter infinite thenable recursion and never settle.
  //
  // `initSupabase` in the mismatch path has no explicit awaits (all the work
  // is synchronous), so the async function's micro-task body settles after a
  // small number of Promise.resolve() ticks.  We use setTimeout(0) to flush
  // both the microtask and macrotask queues, which is always sufficient.
  await new Promise<void>(resolve => setTimeout(resolve, 0));

  return { mod, createClientImpl };
}

// ---------------------------------------------------------------------------
// Scenario 1: matching channel/URL → real client initialized
// ---------------------------------------------------------------------------
describe('(1) matching channel and URL — real client is initialized', () => {
  it('calls createClient when the integrity check passes', async () => {
    const { createClientImpl } = await loadSupabaseModule({
      supabaseUrl: PROD_URL,
      integrityResult: {
        ok: true,
        channel: 'production',
        expectedRef: PROD_REF,
        actualRef: PROD_REF,
      },
    });

    expect(createClientImpl).toHaveBeenCalledTimes(1);
    expect(createClientImpl).toHaveBeenCalledWith(PROD_URL, ANON_KEY, expect.any(Object));
  });

  it('does not set supabaseEnv.mismatch when integrity passes', async () => {
    const { mod } = await loadSupabaseModule({
      supabaseUrl: PROD_URL,
      integrityResult: {
        ok: true,
        channel: 'production',
        expectedRef: PROD_REF,
        actualRef: PROD_REF,
      },
    });

    expect(mod.supabaseEnv.mismatch).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Scenario 2: mismatch → stub used, createClient NOT called, mismatch flagged
// ---------------------------------------------------------------------------
describe('(2) mismatched channel/URL — stub client path, mismatch flag set', () => {
  it('does NOT call createClient when the integrity check fails', async () => {
    const { createClientImpl } = await loadSupabaseModule({
      supabaseUrl: DEV_URL,
      integrityResult: {
        ok: false,
        channel: 'production',
        expectedRef: PROD_REF,
        actualRef: DEV_REF,
        reason: `Build channel "production" must use Supabase project "${PROD_REF}", but this bundle resolved to "${DEV_REF}".`,
      },
    });

    expect(createClientImpl).not.toHaveBeenCalled();
  });

  it('sets supabaseEnv.mismatch to true when integrity fails', async () => {
    const { mod } = await loadSupabaseModule({
      supabaseUrl: DEV_URL,
      integrityResult: {
        ok: false,
        channel: 'production',
        expectedRef: PROD_REF,
        actualRef: DEV_REF,
        reason: 'mismatch',
      },
    });

    expect(mod.supabaseEnv.mismatch).toBe(true);
  });

  it('exported supabase proxy is still defined and its stub auth responds synchronously', async () => {
    const { mod, createClientImpl } = await loadSupabaseModule({
      supabaseUrl: DEV_URL,
      integrityResult: {
        ok: false,
        channel: 'production',
        expectedRef: PROD_REF,
        actualRef: DEV_REF,
        reason: 'mismatch',
      },
    });

    // The real client was never created
    expect(createClientImpl).not.toHaveBeenCalled();

    // The proxy is exported and not null — the app does not crash at startup
    expect(mod.supabase).toBeDefined();

    // The stub's auth sub-object is directly accessible and returns a thenable
    // for getSession (callers get a safe no-op rather than an unhandled exception).
    // We intentionally do NOT await through the deferred proxy here: the stub
    // proxy is itself thenable (its `then` trap returns a callable stub), which
    // makes nested awaits recurse infinitely.  The synchronous check below is
    // sufficient to prove the stub path was taken.
    const sessionCall = (mod.supabase as any).auth?.getSession?.();
    expect(sessionCall).toBeDefined();
    expect(typeof sessionCall?.then).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// Scenario 3: no channel or unknown channel → real client initialized (not blocked)
// ---------------------------------------------------------------------------
describe('(3) no channel or unknown channel — does not block', () => {
  it('calls createClient when there is no build channel (local dev / Expo Go)', async () => {
    const { createClientImpl } = await loadSupabaseModule({
      supabaseUrl: PROD_URL,
      integrityResult: {
        ok: true,
        channel: null,
        expectedRef: null,
        actualRef: PROD_REF,
      },
    });

    expect(createClientImpl).toHaveBeenCalledTimes(1);
  });

  it('calls createClient when the channel is not in the known mapping', async () => {
    const { createClientImpl } = await loadSupabaseModule({
      supabaseUrl: PROD_URL,
      integrityResult: {
        ok: true,
        channel: 'nightly-ci',
        expectedRef: null,
        actualRef: PROD_REF,
      },
    });

    expect(createClientImpl).toHaveBeenCalledTimes(1);
  });

  it('does not set supabaseEnv.mismatch for an unknown channel', async () => {
    const { mod } = await loadSupabaseModule({
      supabaseUrl: PROD_URL,
      integrityResult: {
        ok: true,
        channel: 'feature-branch',
        expectedRef: null,
        actualRef: PROD_REF,
      },
    });

    expect(mod.supabaseEnv.mismatch).toBe(false);
  });
});
