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
  // `registerCallableModule` expects a factory function as the second argument that
  // returns the JS module when invoked by native code. Our fallback accepts a factory
  // and also eagerly populates a JS-visible registry for JS consumers.
  globalObject.registerCallableModule = function registerCallableModuleFallback(name: string, moduleFactory: any) {
    try {
      (globalObject as any).__callableModuleRegistry = (globalObject as any).__callableModuleRegistry || Object.create(null);
      // If a factory was provided, call it to populate the JS registry with the module
      if (typeof moduleFactory === 'function') {
        try {
          (globalObject as any).__callableModuleRegistry[name] = moduleFactory();
        } catch (e) {
          // If the factory throws, still store the factory so native code can attempt later
          (globalObject as any).__callableModuleRegistry[name] = undefined;
        }
      } else {
        // If a module object was passed directly, store it (best-effort)
        (globalObject as any).__callableModuleRegistry[name] = moduleFactory;
      }
    } catch (e) {
      // ignore
    }
  } as any;
}

/**
 * HMRClient interface defining the methods that must be available
 * for Hot Module Replacement to work correctly.
 */
interface HMRClientInterface {
  setup: (config?: any) => void;
  enable: () => void;
  disable: () => void;
}

/**
 * Attempts to load HMRClient from known locations.
 * @returns HMRClient module or null if not found
 */
function loadHMRClient(): HMRClientInterface | null {
  // Metro's transformer rejects dynamic `require(location)` calls.
  // Try each known location with explicit `require` calls so Metro can statically analyze them.
  try {
    // Expo SDK 54+
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('@expo/metro-runtime/HMRClient');
  } catch (e: any) {
    const isModuleNotFound = e?.code === 'MODULE_NOT_FOUND' && e?.message?.includes('@expo/metro-runtime/HMRClient');
    if (!isModuleNotFound && typeof console !== 'undefined' && typeof console.debug === 'function') {
      console.debug('[Polyfill] Failed to load HMRClient from "@expo/metro-runtime/HMRClient":', e);
    }
  }

  try {
    // React Native standard location
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('react-native/Libraries/Utilities/HMRClient');
  } catch (e: any) {
    const isModuleNotFound = e?.code === 'MODULE_NOT_FOUND' && e?.message?.includes('react-native/Libraries/Utilities/HMRClient');
    if (!isModuleNotFound && typeof console !== 'undefined' && typeof console.debug === 'function') {
      console.debug('[Polyfill] Failed to load HMRClient from "react-native/Libraries/Utilities/HMRClient":', e);
    }
  }

  try {
    // Older RN versions
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('react-native/Libraries/Core/Devtools/HMRClient');
  } catch (e: any) {
    const isModuleNotFound = e?.code === 'MODULE_NOT_FOUND' && e?.message?.includes('react-native/Libraries/Core/Devtools/HMRClient');
    if (!isModuleNotFound && typeof console !== 'undefined' && typeof console.debug === 'function') {
      console.debug('[Polyfill] Failed to load HMRClient from "react-native/Libraries/Core/Devtools/HMRClient":', e);
    }
  }

  return null; // HMRClient not found in any known location
}

/**
 * Creates a stub HMRClient implementation for when the real module isn't available.
 * This prevents crashes when native code calls HMRClient methods.
 */
function createHMRClientStub(): HMRClientInterface {
  let hasLoggedHMRStubSetup = false;

  return {
    setup: () => {
      if (hasLoggedHMRStubSetup) {
        return;
      }
      hasLoggedHMRStubSetup = true;
      if (typeof console !== 'undefined' && typeof console.warn === 'function') {
        console.warn('[HMRClient] Stub setup called - HMR may not be available');
      }
    },
    enable: () => {
      // Stub implementation - real HMR module would enable hot reloading here
    },
    disable: () => {
      // Stub implementation - real HMR module would disable hot reloading here
    },
  };
}

// Register HMRClient if in development mode to enable Hot Module Replacement
if (typeof __DEV__ !== 'undefined' && __DEV__) {
  try {
    const HMRClient = loadHMRClient();
    const moduleToRegister = HMRClient || createHMRClientStub();

    // registerCallableModule expects a factory function as the second argument.
    try {
      globalObject.registerCallableModule('HMRClient', () => moduleToRegister);
    } catch (e) {
      // If registration fails for some reason, fallback to storing it on the global
      // so JS code can still find it.
      // eslint-disable-next-line no-console
      console.debug('[Polyfill] registerCallableModule call failed, falling back to global assignment:', e && e.message ? e.message : e);
      try {
        (globalObject as any).__callableModuleRegistry = (globalObject as any).__callableModuleRegistry || Object.create(null);
        (globalObject as any).__callableModuleRegistry['HMRClient'] = moduleToRegister;
      } catch (_e) {
        // ignore
      }
    }
    if (!globalObject.HMRClient) {
      globalObject.HMRClient = moduleToRegister;
    }
    
    if (HMRClient) {
      console.log('[Polyfill] HMRClient registered successfully - Hot Module Replacement enabled');
    } else {
      console.warn('[Polyfill] HMRClient module not found, using stub. Hot Module Replacement will not be available. You may need to manually reload the app to see code changes.');
    }
  } catch (e) {
    console.warn('[Polyfill] HMRClient registration failed:', e);
  }
}
