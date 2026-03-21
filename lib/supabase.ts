import { createClient, SupabaseClient } from '@supabase/supabase-js';
import 'react-native-url-polyfill/auto';
import {
    createAuthSessionStorageAdapter,
    getRememberMePreference,
} from './auth-session-storage';

// Public env vars in Expo must be EXPO_PUBLIC_ prefixed.
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() || '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim() || '';

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
    // Basic, conservative checks: important methods / namespaces used by app
    const hasFrom = typeof obj.from === 'function';
    const hasRpc = typeof obj.rpc === 'function';
    const hasAuth = obj.auth && typeof obj.auth.onAuthStateChange === 'function';
    const hasChannel = typeof (obj as any).channel === 'function' || typeof (obj as any).removeChannel === 'function';
    return !!(hasFrom && hasRpc && hasAuth && hasChannel);
  } catch {
    return false;
  }
}

async function initSupabase(): Promise<void> {
  if (realSupabase || !isSupabaseConfigured) return;

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

  realSupabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      storage: createAuthSessionStorageAdapter(),
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  });

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
      if (prop === Symbol.toPrimitive) return () => 'http://localhost';
      if (prop === 'toString' || prop === 'valueOf') return () => 'http://localhost';
      if (prop in terminal) return (terminal as any)[prop];
      return () => makeStubClient();
    },
    apply() {
      return Promise.resolve(noopResult);
    },
  };

  return new Proxy(() => Promise.resolve(noopResult), handler);
}

// Build a deferred, chainable proxy that wraps an async provider for the
// real object. This supports chainable usage like `supabase.from('x').select()`
// by returning proxies for intermediate builder objects.
/**
 * Creates a proxy around an asynchronously-resolved "real" object (e.g. the
 * Supabase client or one of its query/builder instances) while preserving
 * Supabase's fluent API shape.
 *
 * This implements a **deferred initialization** pattern: callers can eagerly
 * write chains such as `supabase.from('bounties').select('*')` even when the
 * underlying client is not yet available. Each property access and function
 * call is represented as another proxy layer which only resolves `getReal()`
 * at the point a value is actually needed.
 *
 * How this keeps the builder pattern working:
 * - Property access (`.from`, `.select`, etc.) is trapped by `get` and
 *   returns another deferred proxy that, once `getReal()` resolves, reads the
 *   corresponding property from the real object.
 * - Method calls are trapped by `apply` and forwarded to the resolved real
 *   function. If that call returns another builder object (the usual pattern
 *   in Supabase's query API), the result is wrapped in a new deferred proxy so
 *   that chaining (`.from().select().eq()...`) continues to work.
 *
 * Why both traps are needed:
 * - `get` handles *reading* properties and building the next step in the
 *   chain without executing anything immediately.
 * - `apply` handles *calling* functions and ensures that any returned builder
 *   objects are also proxied, maintaining compatibility with Supabase's
 *   fluent API all the way to the terminal async call.
 *
 * The special-case for `then` in the `get` trap avoids the proxy being
 * mistaken for a Promise/thenable, which would otherwise cause unexpected
 * Promise chaining behavior when used with `await` or native Promise helpers.
 *
 * @param getReal Async provider that resolves to the real underlying object.
 * @returns A Proxy that lazily resolves to the real object while supporting
 *          Supabase-style chained method calls.
 */
function makeDeferredProxy(getReal: () => Promise<any>): any {
  const fn = function (..._args: any[]) {
    return getReal().then((real: any) => {
      if (typeof real === 'function') {
        return real.apply(null, _args);
      }
      // If the real is not callable, return it directly.
      return real;
    });
  };

  const proxy = new Proxy(fn, {
    get(_t, prop) {
      if (prop === 'then') return undefined;
      // Ensure primitive coercions work synchronously (avoid Symbol.toPrimitive
      // throwing when consumers coerce the proxy to string/number). If the
      // real object isn't available synchronously we'll return a stable
      // primitive placeholder so coercion doesn't throw.
      if (prop === Symbol.toPrimitive) return (_hint: any) => 'http://localhost';
      if (prop === 'toString' || prop === 'valueOf') return () => 'http://localhost';

      // Provide a safe, plain-object `headers` synchronously so callers like
      // `new Headers(headers)` receive a valid HeadersInit instead of a
      // proxy object which some runtimes (undici) reject.
      if (prop === 'headers') return {};

      // Support common array and object prototype methods so consumers can
      // call them on deferred results (e.g. result.push(...)) without the
      // proxy throwing. These are forwarded to the underlying resolved
      // value once available.
      const arrayMethods = [
        'push', 'pop', 'shift', 'unshift', 'slice', 'splice', 'map', 'filter',
        'forEach', 'find', 'reduce', 'includes', 'indexOf', 'concat', 'join'
      ];
      const objectMethods = ['hasOwnProperty', 'toJSON', 'valueOf', 'isPrototypeOf'];

      if (typeof prop === 'string' && (arrayMethods.includes(prop) || objectMethods.includes(prop))) {
        return (...args: any[]) =>
          getReal().then((real: any) => {
            if (real == null) return undefined;
            const fn = (real as any)[prop];
            if (typeof fn === 'function') return fn.apply(real, args);
            // If property isn't a function, just return it (e.g., length)
            return (real as any)[prop];
          });
      }

      // Provide some commonly-used methods synchronously so callers that
      // expect a function can call them immediately without awaiting the
      // deferred client. These return safe stubs until the real client is
      // available.
      if (prop === 'channel') {
        return (...args: any[]) => {
          try {
            return makeStubClient().channel(...args);
          } catch {
            return makeStubClient().channel(...args);
          }
        };
      }

      if (prop === 'removeChannel') {
        return async (_ch: any) => {
          // no-op until real client is ready
          return;
        };
      }

      return makeDeferredProxy(() => getReal().then((r) => r[prop]));
    },
    apply(_t, thisArg, args) {
      return getReal().then((real: any) => {
        if (typeof real !== 'function') {
          // If someone tried to call a non-function, return it.
          return real;
        }
        const res = real.apply(thisArg, args);
        // If the result is an object (builder), wrap it so chaining continues.
        if (res && typeof res === 'object') return makeDeferredProxy(() => Promise.resolve(res));
        return res;
      });
    },
  });

  return proxy;
}

// Exported supabase object — a deferred proxy that preserves chainability.
export const supabase: SupabaseClient = makeDeferredProxy(() =>
  ensureInit().then(() => {
    // If initialization completed but real client isn't available (envs
    // missing or init failed), return a stub client so callers still get a
    // chainable object instead of a thrown error.
    return realSupabase ?? makeStubClient();
  })
) as unknown as SupabaseClient;

// Kick off initialization in background when configured to make first access faster.
if (isSupabaseConfigured) {
  ensureInit().catch((e) => {
    // eslint-disable-next-line no-console
    console.error('[supabase] lazy init failed:', e);
  });
} else {
  // eslint-disable-next-line no-console
  console.warn('[supabase] Not configured: missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY');
}

export default supabase;
