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

// Register HMRClient if in development mode to enable Hot Module Replacement
if (typeof __DEV__ !== 'undefined' && __DEV__) {
  try {
    // Attempt to load and register HMRClient module
    if (typeof globalObject.registerCallableModule === 'function') {
      try {
        // Try different possible locations for HMRClient
        let HMRClient;
        try {
          // Expo SDK 54+ uses @expo/metro-runtime
          HMRClient = require('@expo/metro-runtime/build/HMRClient');
        } catch (e1) {
          try {
            // Fallback to React Native's HMRClient
            HMRClient = require('react-native/Libraries/Utilities/HMRClient');
          } catch (e2) {
            try {
              // Another possible location in older versions
              HMRClient = require('react-native/Libraries/Core/Devtools/HMRClient');
            } catch (e3) {
              // If all fail, we'll use a stub
              throw new Error('HMRClient not found in any known location');
            }
          }
        }
        
        globalObject.registerCallableModule('HMRClient', HMRClient);
        if (!globalObject.HMRClient) {
          globalObject.HMRClient = HMRClient;
        }
        console.log('[Polyfill] HMRClient registered successfully');
      } catch (requireError) {
        // If HMRClient can't be required, provide a stub to prevent crashes
        console.warn('[Polyfill] Could not require HMRClient, registering stub');
        const HMRClientStub = {
          setup: () => {
            console.log('[HMRClient] Stub setup called - HMR may not be available');
          },
          enable: () => {},
          disable: () => {},
        };
        globalObject.registerCallableModule('HMRClient', HMRClientStub);
        if (!globalObject.HMRClient) {
          globalObject.HMRClient = HMRClientStub;
        }
      }
    }
  } catch (e) {
    console.warn('[Polyfill] HMRClient registration failed:', e);
  }
}
