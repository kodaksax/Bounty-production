import { createClient, SupabaseClient } from '@supabase/supabase-js';
// Polyfill is now imported in index.js to ensure it's loaded as early as possible
import {
  createAuthSessionStorageAdapter,
  getRememberMePreference,
} from './auth-session-storage';

// Public env vars in Expo must be EXPO_PUBLIC_ prefixed.
// Fallback to standard SUPABASE_URL/ANON_KEY if Expo vars are missing during build.
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() || process.env.SUPABASE_URL?.trim() || '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim() || process.env.SUPABASE_ANON_KEY?.trim() || '';

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

async function initSupabase(): Promise<void> {
  if (realSupabase || !isSupabaseConfigured) return;
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
    // Kick off a background read of the remember-me preference to prime the
    // in-memory cache without blocking client creation. We intentionally do
    // NOT `await` here to avoid adding latency to first access. The storage
    // adapter (`getRememberMePreference`) internally tracks an in-flight
    // promise and will await it when a runtime `getItem`/`setItem` needs the
    // authoritative preference. This keeps first-access fast while still
    // avoiding the original race between adapter reads and writes.
    void getRememberMePreference().catch((e) => {
      // eslint-disable-next-line no-console
      console.warn('[supabase] background getRememberMePreference failed during init', e);
    });
  } catch (e) {
    // Defensive: log unexpected errors but continue with client creation.
    // eslint-disable-next-line no-console
    console.warn('[supabase] warning: getRememberMePreference background start failed during init', e);
  }

  try {
    realSupabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: (() => {
        const isTestEnv = typeof process !== 'undefined' && (process.env.JEST_WORKER_ID !== undefined || process.env.NODE_ENV === 'test');
        return {
          storage: createAuthSessionStorageAdapter(),
          autoRefreshToken: !isTestEnv,
          persistSession: !isTestEnv,
          detectSessionInUrl: false,
        };
      })(),
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
 */
function makeDeferredProxy<T extends object>(
  getRealTarget: () => Promise<T>,
  path: string = 'supabase'
): T {
  let resolvedTarget: T | null = null;
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
  });

  return new Proxy({} as T, {
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

      // 7. Return a stable deferred proxy for the sub-property
      const subProxy = makeDeferredProxy(
        async () => {
          const target = await getRealTarget();
          return (target as any)[prop];
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
            // Use the target itself as the `this` context for SDK compliance
            resolve((target as any).apply(target, args));
          } catch (err) {
            reject(err);
          }
        };

        if (resolvedTarget) {
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
}

export default supabase;
