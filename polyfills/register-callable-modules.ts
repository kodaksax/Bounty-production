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
// This prevents crashes when native dev clients try to call HMRClient.setup().
try {
  const g: any = globalObject as any;
  if (typeof g.registerCallableModule === 'function') {
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      try { console.log('[Polyfill] registerCallableModule is a function'); } catch (e) { /* ignore */ }
    }
    
    let hmrClient: any = g.HMRClient;
    
    // Try multiple paths to find the real HMRClient module
    if (!hmrClient) {
      const hmrPaths = [
        'react-native/Libraries/Utilities/HMRClient',
        'react-native/Libraries/Core/Devtools/HMRClient', 
        '@react-native/dev-middleware/dist/inspector-proxy/Device',
        '@expo/metro-runtime/build/HMRClient'
      ];
      
      for (const hmrPath of hmrPaths) {
        try {
          // Try to require the actual HMRClient module from React Native/Expo
          hmrClient = require(hmrPath);
          if (hmrClient && typeof hmrClient.setup === 'function') {
            if (typeof __DEV__ !== 'undefined' && __DEV__) {
              try { console.log(`[Polyfill] Found HMRClient at ${hmrPath}`); } catch (e) { /* ignore */ }
            }
            break;
          }
        } catch (e) {
          // Module not found at this path, try next one
          hmrClient = undefined;
        }
      }
    }

    // If the real HMRClient isn't available, register a safe no-op stub so
    // native callers (e.g., HMRClient.setup) can be invoked without throwing.
    if (!hmrClient) {
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        try { console.log('[Polyfill] HMRClient not found, using stub implementation'); } catch (e) { /* ignore */ }
      }
      hmrClient = {
        setup: (platform?: string, bundleUrl?: string, host?: string, port?: number) => {
          if (typeof __DEV__ !== 'undefined' && __DEV__) {
            try { console.log('[HMRClient stub] setup called:', { platform, bundleUrl, host, port }); } catch (e) { /* ignore */ }
          }
        },
        enable: () => {
          if (typeof __DEV__ !== 'undefined' && __DEV__) {
            try { console.log('[HMRClient stub] enable called'); } catch (e) { /* ignore */ }
          }
        },
        disable: () => {
          if (typeof __DEV__ !== 'undefined' && __DEV__) {
            try { console.log('[HMRClient stub] disable called'); } catch (e) { /* ignore */ }
          }
        },
      };
    }

    if (hmrClient) {
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        try { console.log('[Polyfill] Registering HMRClient...'); } catch (e) { /* ignore */ }
      }
      try {
        g.registerCallableModule && g.registerCallableModule('HMRClient', hmrClient);
        if (typeof __DEV__ !== 'undefined' && __DEV__) {
          try { console.log('[Polyfill] __callableModuleRegistry keys:', Object.keys(g.__callableModuleRegistry || {})); } catch (e) { /* ignore */ }
        }
        if (!g.HMRClient) g.HMRClient = hmrClient;
      } catch (e) {
        if (typeof __DEV__ !== 'undefined' && __DEV__) {
          try { console.warn('[Polyfill] Failed to register HMRClient:', e); } catch (ex) { /* ignore */ }
        }
      }
    }
  } else {
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      try { console.warn('[Polyfill] registerCallableModule is not a function - bridge may not be initialized yet'); } catch (e) { /* ignore */ }
    }
  }
} catch (e) {
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    try { console.error('[Polyfill] Error during HMRClient registration:', e); } catch (ex) { /* ignore */ }
  }
}
