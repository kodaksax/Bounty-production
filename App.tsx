// IMPORTANT: We delegate to expo-router's entrypoint so that navigation context is established.
// Previously this file rendered a standalone component (Todo list) which broke useRouter() calls
// with the error: "Couldn't find a navigation context". Keeping this as a thin pass-through
// ensures compatibility with the "main": "expo-router/entry" in package.json.

// Dev-only: Ensure HMRClient JS module is imported and registered early to prevent
// native crashes when the native runtime calls into HMRClient.setup() before the
// module is registered. This must happen before any other imports.
if (__DEV__) {
  try {
    // Ensure the HMRClient JS module is registered with the native runtime early
    require('react-native/Libraries/Utilities/HMRClient');
  } catch (e) {
    // Fall back gracefully in case the module path is not available
    // (e.g., in production, older RN, or non-standard runtimes)
    // Log to console for easier debugging of dev-only issues.
    // eslint-disable-next-line no-console
    console.warn('[HMRClient] import failed:', e);
  }
}

// Gesture Handler must be imported before any other code that registers views/handlers.
// Importing it at the very top prevents runtime errors where gesture-handler or
// reanimated gesture hooks are undefined.
// Polyfills that need to run prior to any native / Expo runtime work live here.
// Register callable-module shims early so native HMR hooks can find them.
import './polyfills/register-callable-modules';

// Gesture Handler must be imported before any other code that registers views/handlers.
// Importing it at the very top prevents runtime errors where gesture-handler or
// reanimated gesture hooks are undefined.
import 'react-native-gesture-handler';

import 'expo-router/entry';

// Initialize Sentry and Analytics after the router entry ensures Metro runtime hooks are installed
import { analyticsService } from './lib/services/analytics-service';
import { initSentry, reportError } from './lib/services/sentry-service';

const MIXPANEL_TOKEN = process.env.EXPO_PUBLIC_MIXPANEL_TOKEN;
if (MIXPANEL_TOKEN) {
  analyticsService.initialize(MIXPANEL_TOKEN).catch((error) => {
    console.error('[Analytics] Initialization failed:', error);
  });
}

try {
  initSentry({ dsn: process.env.EXPO_SENTRY_DSN || process.env.SENTRY_DSN, release: process.env.EXPO_PUBLIC_APP_VERSION });
} catch (e) {
  const msg = (e && typeof e === 'object' && 'message' in e) ? (e as any).message : String(e);
  console.warn('[Sentry] Initialization skipped or failed:', msg);
}

// If you need to run global side-effects before the router mounts, you can add them here, e.g.:
// import './polyfills';
// But do not export a React component – expo-router handles root mounting.

if (__DEV__) {
  // eslint-disable-next-line no-console
  console.log('[AppEntry] expo-router entry imported (navigation context should be established)');

  // DEV DIAGNOSTICS: print callable-module registration state so we can trace HMR issues
  try {
    const g: any = global as any;
    const keys = Object.keys(g).slice(0, 200);
    console.log('[DevDiag] global keys (sample):', keys.join(', '));
    console.log('[DevDiag] registerCallableModule exists:', typeof g.registerCallableModule === 'function');
    console.log('[DevDiag] __registerCallableModule exists:', typeof g.__registerCallableModule === 'function');
    console.log('[DevDiag] __fbBatchedBridge exists:', !!g.__fbBatchedBridge);
    if (g.__callableModuleRegistry) {
      console.log('[DevDiag] __callableModuleRegistry keys:', Object.keys(g.__callableModuleRegistry));
    }
  } catch (e) {
    console.warn('[DevDiag] failed to read globals', e);
  }

  // Dev-only: ensure HMRClient callable exists so native dev clients don't crash
  try {
    const g: any = global as any;
    if (!g.registerCallableModule && g.__fbBatchedBridge && typeof g.__fbBatchedBridge.registerCallableModule === 'function') {
      g.registerCallableModule = g.__fbBatchedBridge.registerCallableModule.bind(g.__fbBatchedBridge);
    }

    if (typeof g.registerCallableModule === 'function') {
      try {
        const hmrClient = g.HMRClient || require('react-native/Libraries/Core/Devtools/HMRClient');
        g.registerCallableModule('HMRClient', hmrClient);
        if (!g.HMRClient) {
          g.HMRClient = hmrClient;
        }
      } catch (e) {
        // swallow - no HMR in release
      }
    }
  } catch (e) {
    // swallow - dev-only
  }

  // Attach global error handlers to capture diagnostics before native crash
  try {
    const g: any = global as any;
    if (typeof g.ErrorUtils !== 'undefined' && typeof g.ErrorUtils.setGlobalHandler === 'function') {
      const prev = g.ErrorUtils.getGlobalHandler && g.ErrorUtils.getGlobalHandler();
      g.ErrorUtils.setGlobalHandler((error: any, isFatal?: boolean) => {
        try { console.error('[GlobalError] Caught', { error, isFatal }); reportError(error); } catch (e) { /* ignore */ }
        if (typeof prev === 'function') { try { prev(error, isFatal); } catch (e) { /* ignore */ } }
      });
    }

    if (typeof (global as any).process !== 'undefined' && typeof (global as any).process.on === 'function') {
      (global as any).process.on('unhandledRejection', (reason: any) => {
        try { console.error('[GlobalError] UnhandledRejection', reason); reportError(reason); } catch (e) { /* ignore */ }
      });
    }
  } catch (e) { /* ignore */ }
}
// Note: Do NOT export a React component from this file. The `expo-router/entry` import above
// establishes the navigation/root mounting. Root-level providers (Stripe, Theme, Auth, etc.)
// are provided inside `app/_layout.tsx` so that `Slot` and navigation context are available.

