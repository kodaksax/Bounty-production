// lib/services/sentry-init.ts - Sentry initialization for error tracking
import type { Integration } from '@sentry/types';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

// Sentry configuration
const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;
const ENVIRONMENT = process.env.NODE_ENV || 'development';

/**
 * Returns true when the native Sentry SDK should be enabled.
 *
 * @sentry/react-native ≤7.11.0 bundles a Sentry Cocoa SDK that crashes on
 * iOS 26+ (EXC_BAD_ACCESS in SentrySDKInternal startWithOptions:, offset 608,
 * address 0x10 — a null-pointer deref introduced by a breaking iOS 26 change).
 * Until the package is upgraded to a version that ships a compatible Cocoa SDK,
 * we disable native-SDK initialisation on iOS 26+ so the app does not crash at
 * launch.  JS-layer error reporting (breadcrumbs, JS exceptions, etc.) continues
 * to work with enableNative: false.
 */
function shouldEnableNative(): boolean {
  if (Platform.OS !== 'ios') return true;
  const iosVersion = parseInt(String(Platform.Version), 10);
  // Disable native Sentry on iOS 26+ to avoid the SentrySDKInternal crash.
  return iosVersion < 26;
}

/**
 * Initialize Sentry for error tracking
 */
export function initializeSentry() {
  // Lazy-require Sentry to avoid importing native module at module-evaluation time
  // (prevents crashes in Expo Go or non-native runtimes).
  let Sentry: any = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    Sentry = require('@sentry/react-native');
  } catch {
    // Sentry not available in this runtime
    return;
  }

  try {
    // Avoid double-initialization: if a Sentry client already exists, skip init.
    const hub = (Sentry as any).getCurrentHub && (Sentry as any).getCurrentHub();
    if (hub && hub.getClient && hub.getClient()) {
      return;
    }
  } catch {
    // ignore guard failures
  }
  // Only initialize if DSN is provided and not in development
  if (!SENTRY_DSN || SENTRY_DSN === 'YOUR_SENTRY_DSN') {
    return;
  }

  try {
    // Defensive detection for tracing integrations across SDK versions.
    // v7->v8 renamed/changed tracing exports (class vs factory). Try common names
    // and handle both constructor (new ...) and factory (fn(...) -> Integration).
    const integrationCandidates = [
      (Sentry as any).reactNativeTracingIntegration,
      (Sentry as any).reactNativeTracing,
      (Sentry as any).ReactNativeTracing,
      (Sentry as any).ReactNativeTracingIntegration,
    ];

    const tracingOptions = {
      routingInstrumentation: undefined,
      tracingOrigins: ['localhost', /^\//],
    };

    let integrations: Integration[] | undefined;

    for (const candidate of integrationCandidates) {
      if (!candidate) continue;
      try {
        // If candidate is a function that returns an integration (factory)
        if (typeof candidate === 'function') {
          // Try as factory first
          const maybe = candidate(tracingOptions);
          if (maybe && typeof maybe === 'object') {
            integrations = [maybe as Integration];
            break;
          }

          // Try as constructor with `new`
          try {
            const inst = new (candidate as any)(tracingOptions);
            if (inst) {
              integrations = [inst as Integration];
              break;
            }
          } catch {
            // ignore constructor error and continue
          }
        }
      } catch {
        // ignore and try next candidate
      }
    }

    Sentry.init({
      dsn: SENTRY_DSN,
      environment: ENVIRONMENT,
      // Enable tracing
      tracesSampleRate: ENVIRONMENT === 'production' ? 0.2 : 1.0,
      // Set release version
      release: Constants.expoConfig?.version || '1.0.0',
      // dist should be the build number (e.g. "30"), not the EAS project ID.
      dist: Constants.expoConfig?.ios?.buildNumber
        ?? Constants.expoConfig?.android?.versionCode?.toString()
        ?? undefined,
      // Enable automatic session tracking
      enableAutoSessionTracking: true,
      // Sessions close after app is 10 seconds in the background
      sessionTrackingIntervalMillis: 10000,
      // Guard against native SDK crash on iOS 26+ (SentrySDKInternal SIGSEGV).
      // enableNative: false keeps JS-layer reporting while skipping the Cocoa
      // SDK initialisation that crashes on iOS 26 in @sentry/react-native 7.x.
      enableNative: shouldEnableNative(),
      // Enable automatic breadcrumbs
      enableAutoPerformanceTracing: true,
      // Debug mode in development
      debug: ENVIRONMENT === 'development',
      // Before send hook to sanitize data
      beforeSend(event: any, hint: any) {
        // Don't send events in development unless explicitly enabled
        if (ENVIRONMENT === 'development' && !process.env.EXPO_PUBLIC_SENTRY_DEBUG) {
          return null;
        }

        // Remove sensitive data from breadcrumbs
        if (event.breadcrumbs) {
          event.breadcrumbs = event.breadcrumbs.map((breadcrumb: any) => {
            // Remove Authorization headers
            if (breadcrumb.data?.headers) {
              const { Authorization, ...otherHeaders } = breadcrumb.data.headers;
              breadcrumb.data.headers = otherHeaders;
            }
            return breadcrumb;
          });
        }

        // Remove sensitive data from request
        if (event.request?.headers) {
          const { Authorization, ...otherHeaders } = event.request.headers;
          event.request.headers = otherHeaders;
        }

        return event;
      },
      // Integrations (tracing integration may be undefined on older/newer SDKs)
      integrations,
    });

  } catch (error) {
    console.error('[Sentry] Failed to initialize:', error);
  }
}

/**
 * Safe getter for the Sentry SDK. Returns `null` if the package isn't available.
 */
export function getSentrySafe() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    return require('@sentry/react-native');
  } catch {
    return null;
  }
}

export { getSentrySafe as getSentry };

