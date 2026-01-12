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

/**
 * Attempts to load HMRClient from known locations.
 * @returns HMRClient module or null if not found
 */
function loadHMRClient(): any {
  const locations = [
    '@expo/metro-runtime/build/HMRClient', // Expo SDK 54+
    'react-native/Libraries/Utilities/HMRClient', // React Native standard
    'react-native/Libraries/Core/Devtools/HMRClient', // Older versions
  ];

  for (const location of locations) {
    try {
      return require(location);
    } catch (e) {
      // Continue to next location
    }
  }

  return null; // HMRClient not found in any known location
}

/**
 * Creates a stub HMRClient implementation for when the real module isn't available.
 * This prevents crashes when native code calls HMRClient methods.
 */
function createHMRClientStub() {
  return {
    setup: () => {
      console.log('[HMRClient] Stub setup called - HMR may not be available');
    },
    // No-op stub: HMR enable is unavailable without the real module
    enable: () => {},
    // No-op stub: HMR disable is unavailable without the real module
    disable: () => {},
  };
}

// Register HMRClient if in development mode to enable Hot Module Replacement
if (typeof __DEV__ !== 'undefined' && __DEV__) {
  try {
    // Attempt to load and register HMRClient module
    if (typeof globalObject.registerCallableModule === 'function') {
      const HMRClient = loadHMRClient();
      const moduleToRegister = HMRClient || createHMRClientStub();
      
      globalObject.registerCallableModule('HMRClient', moduleToRegister);
      if (!globalObject.HMRClient) {
        globalObject.HMRClient = moduleToRegister;
      }
      
      if (HMRClient) {
        console.log('[Polyfill] HMRClient registered successfully - Hot Module Replacement enabled');
      } else {
        console.warn('[Polyfill] HMRClient module not found, using stub. Hot Module Replacement will not be available. You may need to manually reload the app to see code changes.');
      }
    }
  } catch (e) {
    console.warn('[Polyfill] HMRClient registration failed:', e);
  }
}
