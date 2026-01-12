/*
  Ensure registerCallableModule is available before the Expo runtime executes.
  This avoids native dev clients crashing with HMRClient.setup when the bridge
  moves the callable-module API behind different globals.
*/
const globalObject: Record<string, any> = globalThis as any;

const fallbacks: Array<(() => void) | undefined> = [
  typeof globalObject.registerCallableModule === 'function' ? globalObject.registerCallableModule : undefined,
  typeof globalObject.RN$registerCallableModule === 'function' ? globalObject.RN$registerCallableModule : undefined,
  typeof globalObject.__fbBatchedBridge?.registerCallableModule === 'function'
    ? globalObject.__fbBatchedBridge.registerCallableModule.bind(globalObject.__fbBatchedBridge)
    : undefined,
  typeof globalObject.__turboModuleProxy?.registerCallableModule === 'function'
    ? globalObject.__turboModuleProxy.registerCallableModule
    : undefined,
];

const resolved = fallbacks.find((candidate) => typeof candidate === 'function');

if (typeof resolved === 'function' && globalObject.registerCallableModule !== resolved) {
  globalObject.registerCallableModule = resolved;
}

if (!globalObject.__callableModuleRegistry) {
  globalObject.__callableModuleRegistry = Object.create(null);
}

// If no native registerCallableModule is available yet, provide a safe JS
// fallback that writes into the callable module registry so native callers
// can find callable modules (best-effort).
if (typeof globalObject.registerCallableModule !== 'function') {
  globalObject.registerCallableModule = function registerCallableModuleFallback(name: string, moduleImpl: any) {
    try {
      (globalObject as any).__callableModuleRegistry = (globalObject as any).__callableModuleRegistry || Object.create(null);
      (globalObject as any).__callableModuleRegistry[name] = moduleImpl;
    } catch (e) {
      // ignore
    }
  } as any;
}

// Try to proactively register the HMRClient callable module early in startup.
try {
  const g: any = globalObject as any;
  if (typeof g.registerCallableModule === 'function') {
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      try { console.log('[Polyfill] registerCallableModule is a function'); } catch (e) { /* ignore */ }
    }
    let hmrClient: any = g.HMRClient;
    try {
      // Avoid requiring a file that Metro may not have; instead, if there is no
      // built-in HMRClient available at runtime, provide a lightweight stub
      // implementation so native-side HMR calls do not crash.
      if (!hmrClient) {
        hmrClient = (globalObject as any).HMRClient || undefined;
      }
    } catch (e) {
      hmrClient = undefined;
    }

    // If the real HMRClient isn't available, register a safe no-op stub so
    // native callers (e.g., HMRClient.setup) can be invoked without throwing.
    if (!hmrClient) {
      hmrClient = {
        setup: () => {},
        enable: () => {},
        disable: () => {},
      };
    }

    if (hmrClient) {
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        try { console.log('[Polyfill] HMRClient resolved, attempting register'); } catch (e) { /* ignore */ }
      }
        try {
          g.registerCallableModule && g.registerCallableModule('HMRClient', hmrClient);
          if (typeof __DEV__ !== 'undefined' && __DEV__) {
            try { console.log('[Polyfill] __callableModuleRegistry keys:', Object.keys(g.__callableModuleRegistry || {})); } catch (e) { /* ignore */ }
          }
          if (!g.HMRClient) g.HMRClient = hmrClient;
        } catch (e) {
          // ignore registration failures
        }
    }
  }
} catch (e) {
  // ignore errors during bootstrap
}
