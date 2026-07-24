import { createClient, SupabaseClient } from '@supabase/supabase-js';
// Polyfill is now imported in index.js to ensure it's loaded as early as possible
import { createAuthSessionStorageAdapter } from './auth-session-storage';
import { config } from './config';
import { checkEnvironmentIntegrity } from './config/env-guard';
import { authFetchWithTimeout } from './utils/auth-fetch';

// Use centralized frontend config for env access
const supabaseUrl = config.supabase.url;
const supabaseAnonKey = config.supabase.anonKey;

// Project-scoped storage key derived from the Supabase URL at module load time.
// Exported so logout code and auth handlers can reference the same key that the
// Supabase client uses internally, ensuring complete session cleanup on sign-out.
export const PROJECT_STORAGE_KEY = (() => {
  try {
    const ref = new URL(supabaseUrl).hostname.split('.')[0] || 'default';
    return `supabase.auth.token.${ref}`;
  } catch {
    return 'supabase.auth.token.default';
  }
})();

export const isSupabaseConfigured = !!supabaseUrl && !!supabaseAnonKey;
// Keep compatibility shape expected by callers (hasUrl/hasKey/mismatch).
export const supabaseEnv = {
  url: supabaseUrl,
  anonKey: Boolean(supabaseAnonKey),
  hasUrl: !!supabaseUrl,
  hasKey: !!supabaseAnonKey,
  mismatch: false,
};

let realSupabase: SupabaseClient | null = null;
let initPromise: Promise<void> | null = null;

// Runtime shape validation for the Supabase client.
// This helps catch type mismatches at runtime (e.g. unexpected client API),
// preventing obscure runtime errors when callers assume the fluent API.
function validateSupabaseShape(obj: any): obj is SupabaseClient {
  try {
    if (!obj) return false;
    // Relaxed check: we strictly need .auth and .from, but don't strictly require .channel
    // as it may optionally fail validation depending on how the runtime bundled the client.
    const hasFrom = typeof obj.from === 'function';
    const hasAuth = obj.auth && typeof obj.auth.onAuthStateChange === 'function';
    return !!(hasFrom && hasAuth);
  } catch {
    return false;
  }
}

// authFetchWithTimeout is imported from lib/utils/auth-fetch.ts.
// See that module for full design documentation.

async function initSupabase(): Promise<void> {
  if (realSupabase) return;

  // HARD ENVIRONMENT GUARD — runs before any real client is created AND before
  // the "not configured" short-circuit below, so a production/staging binary
  // that received an OTA bundle pointing at the WRONG Supabase project (or one
  // that is MISSING its env entirely) fails LOUDLY instead of silently
  // degrading to a signed-out stub that hangs on getSession().
  //
  // The immutable build channel (baked into the native binary at BUILD time) is
  // the source of truth for which environment this binary belongs to. An OTA
  // update can replace the JS bundle (and its EXPO_PUBLIC_SUPABASE_URL) but
  // cannot change the channel, so a channel↔ref mismatch unambiguously means
  // "wrong environment shipped." When that happens we THROW — the app refuses
  // to start against the wrong project, surfacing a fatal Sentry event that
  // forces a corrected `eas update` republish, instead of stranding users in a
  // silent signed-out state.
  const integrity = checkEnvironmentIntegrity(supabaseUrl);
  if (!integrity.ok) {
    // eslint-disable-next-line no-console
    console.error(
      `[supabase] CRITICAL ENVIRONMENT MISMATCH — ${integrity.reason} ` +
        `(channel=${integrity.channel}, expected=${integrity.expectedRef}, actual=${integrity.actualRef}). ` +
        `Refusing to initialize the real Supabase client.`
    );
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
      const Sentry = require('@sentry/react-native');
      if (Sentry && typeof Sentry.captureMessage === 'function') {
        Sentry.setContext?.('env_guard', {
          channel: integrity.channel,
          expectedRef: integrity.expectedRef,
          actualRef: integrity.actualRef,
        });
        Sentry.captureMessage(`[env-guard] ${integrity.reason}`, 'fatal');
      }
    } catch {
      // ignore if Sentry isn't available at startup
    }
    try { (supabaseEnv as any).mismatch = true; } catch {}
    // Fail fast. Do NOT fall back to a stub: a silent stub is exactly what let
    // a wrong-project bundle ship unnoticed. Callers awaiting `supabase` receive
    // this rejection so the failure is visible instead of a 15s hang.
    throw new Error(
      `[env-guard] ${integrity.reason} ` +
        `Rebuild/republish with the correct EXPO_PUBLIC_SUPABASE_URL ` +
        `(eas update --branch <env> --environment <env>).`
    );
  }

  // Reaching here means the environment guard passed. If the app is genuinely
  // unconfigured (local dev / test with intentionally-absent env and no build
  // channel), keep the inert stub without throwing so those flows still work.
  if (!isSupabaseConfigured) return;

  // Add safe, non-secret context to Sentry (best-effort) so errors during
  // early startup include whether Supabase envs were present.
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    const Sentry = require('@sentry/react-native');
    if (Sentry && typeof Sentry.setContext === 'function') {
      Sentry.setContext('supabase', {
        hasUrl: !!supabaseUrl,
        hasKey: !!supabaseAnonKey,
        urlPrefix: supabaseUrl ? String(supabaseUrl).substring(0, 40) : undefined,
      });
    }
  } catch {
    // ignore if Sentry not available at startup
  }

  // Quick runtime diagnostics to surface env presence in Release logs.
  // eslint-disable-next-line no-console
  console.debug('[supabase.debug] env', {
    hasUrl: !!supabaseUrl,
    urlPrefix: supabaseUrl ? String(supabaseUrl).substring(0, 60) : undefined,
    hasKey: !!supabaseAnonKey,
  });
  try {
    // Use PROJECT_STORAGE_KEY as the single source of truth so all auth-related
    // code shares the same key. This ensures sessions from different Supabase
    // projects (dev / staging / production) never share the same SecureStore
    // slot and eliminates cross-environment JWT contamination.

    realSupabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: (() => {
        const isTestEnv = typeof process !== 'undefined' && (process.env.JEST_WORKER_ID !== undefined || process.env.NODE_ENV === 'test');
        return {
          storage: createAuthSessionStorageAdapter(),
          storageKey: PROJECT_STORAGE_KEY,
          autoRefreshToken: !isTestEnv,
          persistSession: !isTestEnv,
          detectSessionInUrl: false,
        };
      })(),
      global: { fetch: authFetchWithTimeout },
    });
  } catch (e) {
    // Defensive: if the Supabase client throws (e.g., invalid URL), fall back
    // to the stub client to avoid crashing the entire app during startup.
    // eslint-disable-next-line no-console
    console.error('[supabase] createClient failed during init - falling back to stub client', e);
    // mark mismatch so diagnostic breadcrumbs show mismatch state
    try { (supabaseEnv as any).mismatch = true; } catch {}
    realSupabase = makeStubClient();
  }
  if (__DEV__) {
    console.log('[supabase] Real client initialized successfully');
  }

  // Validate the runtime shape of the created client. If it doesn't match the
  // minimal shape our code expects, fall back to the chainable stub client so
  // callers receive predictable, safe behavior instead of throwing later.
  if (!validateSupabaseShape(realSupabase)) {
    // eslint-disable-next-line no-console
    console.error('[supabase] runtime validation: created client missing expected shape — falling back to stub client');
    realSupabase = makeStubClient();
  }

  // Add a breadcrumb if Sentry is available (best-effort).
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    const Sentry = require('@sentry/react-native');
    if (Sentry && typeof Sentry.addBreadcrumb === 'function') {
      Sentry.addBreadcrumb({
        category: 'supabase',
        message: 'client lazily created',
        level: 'info',
        data: supabaseEnv,
      });
    }
  } catch {
    // ignore if Sentry isn't present
  }
}

function ensureInit(): Promise<void> {
  if (!initPromise) initPromise = initSupabase();
  return initPromise;
}

// Build a lightweight stub client used when Supabase isn't configured. This
// preserves the shape of the API used in tests and in dev when env vars are
// intentionally absent.
const stubMsg = '[supabase] Not configured';
const noopResult = { data: null, error: { message: stubMsg } };
const stubAuth = {
  onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } }, error: null }),
  getUser: async () => ({ data: { user: null }, error: { message: stubMsg } }),
  getSession: async () => ({ data: { session: null }, error: { message: stubMsg } }),
  signInWithPassword: async () => ({ data: null, error: { message: stubMsg } }),
  signInWithOtp: async () => ({ data: null, error: { message: stubMsg } }),
  signOut: async () => ({ data: null, error: { message: stubMsg } }),
  updateUser: async () => ({ data: null, error: { message: stubMsg } }),
  verifyOtp: async () => ({ data: null, error: { message: stubMsg } }),
};

function makeStubClient(): any {
  const terminal = {
    from: (_table?: string) => {
      const builder: any = {}
      const terminalMethods = ['select','insert','update','delete','eq','match','limit','order','single','maybeSingle','throwOnError','range','on']
      terminalMethods.forEach((m) => {
        builder[m] = (..._args: any[]) => builder
      })
      builder.subscribe = () => ({ unsubscribe() {} })
      builder.send = () => Promise.resolve({})
      // Promise-like behavior so callers can `await` the builder
      builder.then = (resolve: any) => Promise.resolve(noopResult).then(resolve)
      return builder
    },
    rpc: async () => noopResult,
    channel: (..._args: any[]) => {
      // chainable stub channel
      const channelObj: any = {
        on: (_event: any, _filter?: any, cb?: any) => {
          return channelObj;
        },
        subscribe: (cb?: any) => ({ unsubscribe() {} }),
        send: (_payload: any) => Promise.resolve({}),
      };
      return channelObj;
    },
    auth: stubAuth,
    removeChannel: async (_ch: any) => {},
    __unsafe__: {},
  };

  // Chainable proxy for stub (so calls like supabase.from(...).select() work)
  const handler: ProxyHandler<any> = {
    get(_t, prop) {
      if (prop === Symbol.toPrimitive) return () => supabaseUrl || 'http://localhost';
      if (prop === 'toString' || prop === 'valueOf') return () => supabaseUrl || 'http://localhost';
      if (prop in terminal) return (terminal as any)[prop];
      return () => makeStubClient();
    },
    apply() {
      return Promise.resolve(noopResult);
    },
  };

  return new Proxy(() => Promise.resolve(noopResult), handler);
}

/**
 * Creates a proxy around an asynchronously-resolved "real" object while
 * preserving Supabase's fluent API shape.
 * 
 * DESIGN:
 * 1. Maintains a direct reference to the real target once resolved to avoid "proxy of proxy" chains.
 * 2. Caches sub-property proxies (like .auth) to ensure stable object identity.
 * 3. Correctly preserves `this` context for SDK methods.
 *
 * Exported for unit testing of the pre-resolution call path.
 */
export function makeDeferredProxy<T extends object>(
  getRealTarget: () => Promise<T>,
  path: string = 'supabase'
): T {
  let resolvedTarget: T | null = null;
  // Set when getRealTarget() rejects (e.g. the environment guard threw). Once
  // failed, queued and future calls must NOT wait for a resolution that will
  // never come — they re-invoke getRealTarget() and reject to their caller.
  let initFailed = false;
  const taskQueue: Array<() => void> = [];
  const propertyCache = new Map<string | symbol, any>();

  // Start initialization immediately
  getRealTarget().then((target) => {
    resolvedTarget = target;
    if (__DEV__) console.log(`[supabase] Proxy at "${path}" resolved to real target`);
    
    // Process any tasks that were queued while we were initializing
    while (taskQueue.length > 0) {
      const task = taskQueue.shift();
      if (task) task();
    }
  }).catch((err) => {
    // The environment guard (or another fatal init error) rejected. Swallow the
    // rejection HERE so it doesn't surface as an unhandledRejection, but leave
    // `resolvedTarget` null and flag the failure so callers get a loud rejection
    // at the call site instead of a silent stub OR an infinite hang.
    initFailed = true;
    // eslint-disable-next-line no-console
    console.error(`[supabase] deferred proxy at "${path}" failed to initialize:`, err);
    // Drain any calls queued before the failure — each re-invokes getRealTarget()
    // (which rejects) and forwards the error to its awaiting caller. Without this
    // they would wait forever because the success handler above never runs.
    while (taskQueue.length > 0) {
      const task = taskQueue.shift();
      if (task) task();
    }
  });

  // IMPORTANT: the Proxy target MUST be callable (a function), not a plain
  // object. A Proxy only exposes a [[Call]] internal method when its target is
  // callable; otherwise the `apply` trap below is dead code and invoking the
  // proxy throws "TypeError: Object is not a function" (Hermes) the moment any
  // chained Supabase method (e.g. `supabase.auth.onAuthStateChange(...)` or
  // `supabase.from(...).select()`) is called before the real client has
  // finished initializing. Using a no-op function target keeps the proxy
  // callable so pre-resolution calls are correctly queued via `apply`.
  const callableTarget = (() => {}) as unknown as T;

  return new Proxy(callableTarget, {
    get(_t, prop) {
      // 1. Direct access to resolved target if available
      if (resolvedTarget) {
        const val = (resolvedTarget as any)[prop];
        if (typeof val === 'function') {
          return (...args: any[]) => val.apply(resolvedTarget, args);
        }
        return val;
      }

      // 2. Fundamental properties needed by JS engine/v8
      if (prop === Symbol.toPrimitive) return (_hint: any) => path;
      if (prop === 'toString' || prop === 'valueOf') return () => path;
      
      // 3. Special handling for Promise-like `then` to allow awaiting the proxy itself
      if (prop === 'then') {
        return (resolve: any, reject: any) => getRealTarget().then(resolve, reject);
      }

      // 4. Placeholder headers for initial boot
      if (prop === 'headers') {
        const headers = realSupabase 
          ? (realSupabase as any).headers 
          : { apikey: supabaseAnonKey, Authorization: `Bearer ${supabaseAnonKey}` };
        return headers;
      }

      // 5. Check cache for sub-properties (like .auth, .from, etc.)
      if (propertyCache.has(prop)) return propertyCache.get(prop);

      // 6. Special handling for known methods to return functional proxies immediately
      if (prop === 'from' || prop === 'channel') {
        const subProxy = (...args: any[]) => {
          return makeDeferredProxy(async () => {
            const target = await getRealTarget();
            return (target as any)[prop](...args);
          }, `${path}.${String(prop)}(...)`);
        };
        propertyCache.set(prop, subProxy);
        return subProxy;
      }

      // 7. Return a stable deferred proxy for the sub-property.
      // Bind function-valued properties to their parent so every invocation
      // path (direct call, `apply`, or queued pre-resolution call) uses the
      // correct receiver. A bound function ignores the `this` supplied to
      // `apply`, so even `resolvedTarget.apply(resolvedTarget, args)` in the
      // `apply` trap below behaves correctly when `resolvedTarget` is a
      // method bound here.
      const subProxy = makeDeferredProxy(
        async () => {
          const target = await getRealTarget();
          const val = (target as any)[prop];
          return typeof val === 'function' ? val.bind(target) : val;
        },
        `${path}.${String(prop)}`
      );
      
      propertyCache.set(prop, subProxy);
      return subProxy;
    },

    apply(_t, _thisArg, args) {
      if (resolvedTarget && typeof resolvedTarget === 'function') {
        return (resolvedTarget as any).apply(resolvedTarget, args);
      }

      // If not resolved, return a Promise that resolves to the result of the call
      return new Promise((resolve, reject) => {
        const executeCall = async () => {
          try {
            const target = await getRealTarget();
            if (typeof target !== 'function') {
              throw new Error(`Target at ${path} is not a function`);
            }
            // Function-valued sub-properties are already bound to their parent
            // (see step 7 in the `get` trap), so `apply` inherits the correct
            // receiver regardless of what we pass as `thisArg`.
            resolve((target as any).apply(target, args));
          } catch (err) {
            reject(err);
          }
        };

        if (resolvedTarget) {
          executeCall();
        } else if (initFailed) {
          // Initialization already rejected — don't queue (nothing will drain
          // it). Run immediately so getRealTarget() rejects and the caller sees
          // the fatal env-guard error instead of hanging.
          executeCall();
        } else {
          taskQueue.push(executeCall);
        }
      });
    }
  });
}

// Exported supabase object — a deferred proxy that preserves chainability.
export const supabase: SupabaseClient = makeDeferredProxy(async () => {
  await ensureInit();
  return realSupabase ?? makeStubClient();
}) as unknown as SupabaseClient;

// Kick off initialization in background when configured to make first access faster.
if (isSupabaseConfigured) {
  ensureInit().catch((e) => {
    // eslint-disable-next-line no-console
    console.error('[supabase] lazy init failed:', e);
  });
} else {
  // eslint-disable-next-line no-console
  console.warn('[supabase] Not configured: missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY');

  const isDev = typeof __DEV__ !== 'undefined' ? __DEV__ : false;
  if (!isDev) {
    // eslint-disable-next-line no-console
    console.error('CRITICAL: Supabase is not configured in a production build. Environment variables were likely not injected during the build process.');
  }

  // Even when env is absent, run the environment guard at startup. On a real
  // build channel (production/staging/beta) a missing/unparseable Supabase URL
  // is a fatal mis-configuration and initSupabase() will throw — surfacing it
  // immediately via Sentry instead of only on first `supabase` access. With no
  // channel (local dev / Expo Go) the guard passes and the inert stub is kept.
  ensureInit().catch((e) => {
    // eslint-disable-next-line no-console
    console.error('[supabase] environment guard failed at startup:', e);
  });
}

export default supabase;
