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

// HMRClient registration disabled to prevent crashes.
// The native dev client may call HMRClient.setup(), but without the module registered,
// it will fail gracefully. Hot Module Replacement will not be available, but the app
// will run. To re-enable HMR, the HMRClient module needs to be properly loaded and
// registered, but for now we're bypassing it entirely to allow the app to start.
if (typeof __DEV__ !== 'undefined' && __DEV__) {
  try { 
    console.log('[Polyfill] HMRClient registration skipped - HMR disabled to prevent crashes'); 
  } catch (e) { 
    /* ignore */ 
  }
}
