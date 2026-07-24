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
  }));

  // Import the freshly-mocked module
  const mod = await import('../../../lib/supabase');

  // Wait for initSupabase() to settle (resolve OR reject).
  // On the mismatch path initSupabase() now throws; the module-level
  // ensureInit().catch() and the deferred proxy's own .catch() absorb that
  // rejection so it never surfaces as an unhandledRejection. The body is
  // otherwise synchronous, so flushing the microtask + macrotask queues via
  // setTimeout(0) is sufficient for the module to reach a stable state.
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
// Scenario 2: mismatch → hard failure. createClient is NOT called, mismatch is
// flagged, and initialization REJECTS (fail-fast) instead of silently stubbing.
// A silent stub is exactly what let a wrong-project bundle ship unnoticed, so
// the guard now throws to surface the misconfiguration loudly.
// ---------------------------------------------------------------------------
describe('(2) mismatched channel/URL — hard failure, mismatch flag set', () => {
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

  it('exported supabase proxy is still defined but access REJECTS (fail-fast, no silent stub)', async () => {
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

    // The proxy is exported and not null — the module still loads without a
    // synchronous crash at import time.
    expect(mod.supabase).toBeDefined();

    // But awaiting through the proxy now REJECTS with the env-guard error rather
    // than resolving to a signed-out stub. Callers therefore see a loud failure
    // instead of a silent 15s hang / signed-out limbo.
    const sessionCall = (mod.supabase as any).auth?.getSession?.();
    expect(sessionCall).toBeDefined();
    expect(typeof sessionCall?.then).toBe('function');
    await expect(sessionCall).rejects.toThrow(/env-guard/i);
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
