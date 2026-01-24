// lib/services/sentry-init.ts - Sentry initialization for error tracking
import type { Integration } from '@sentry/types';
import Constants from 'expo-constants';

// Sentry configuration
const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;
const ENVIRONMENT = process.env.NODE_ENV || 'development';

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
    const ReactNativeTracingIntegration = (Sentry as { ReactNativeTracing?: new (options: {
      routingInstrumentation?: unknown;
      tracingOrigins?: (string | RegExp)[];
    }) => Integration }).ReactNativeTracing;

    const integrations: Integration[] | undefined = ReactNativeTracingIntegration
      ? [
          new ReactNativeTracingIntegration({
            // Routing instrumentation not needed for Expo Router
            routingInstrumentation: undefined,
            // Track automatic spans
            tracingOrigins: ['localhost', /^\//],
          }) as Integration,
        ]
      : undefined;

    Sentry.init({
      dsn: SENTRY_DSN,
      environment: ENVIRONMENT,
      // Enable tracing
      tracesSampleRate: ENVIRONMENT === 'production' ? 0.2 : 1.0,
      // Set release version
      release: Constants.expoConfig?.version || '1.0.0',
      // Dist can be used to distinguish builds
      dist: Constants.expoConfig?.extra?.eas?.projectId,
      // Enable automatic session tracking
      enableAutoSessionTracking: true,
      // Sessions close after app is 10 seconds in the background
      sessionTrackingIntervalMillis: 10000,
      // Enable native crash reporting
      enableNative: true,
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
      // Integrations
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
