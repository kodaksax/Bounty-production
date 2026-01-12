let sentryInitialized = false;

export function initSentry(options?: { dsn?: string | null; release?: string | null }) {
  const { dsn, release } = options || {};
  try {
    if (!dsn) {
      // No DSN configured - skip initialization
      return;
    }

    // Lazy require to avoid build-time dependency when Sentry isn't installed
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    const Sentry = require('@sentry/react-native');

    if (!Sentry || sentryInitialized) return;

    Sentry.init({
      dsn,
      enableNative: true,
      release: release || undefined,
      tracesSampleRate: 0.0, // dev builds: don't sample traces by default
    });

    sentryInitialized = true;
    // Provide a no-op console log to make it visible in dev
    // eslint-disable-next-line no-console
    console.log('[Sentry] Initialized (dev)');
  } catch (e) {
    // If Sentry package missing or init fails, just warn
    // Safely extract message from unknown
    const msg = (e && typeof e === 'object' && 'message' in e) ? (e as any).message : String(e);
    // eslint-disable-next-line no-console
    console.warn('[Sentry] init failed or package not installed:', msg);
  }
}

export async function reportError(err: unknown) {
  try {
    if (!sentryInitialized) {
      // Try to require Sentry on-demand and capture without init
      // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
      const Sentry = require('@sentry/react-native');
      if (Sentry && typeof Sentry.captureException === 'function') {
        Sentry.captureException(err);
        return;
      }
    } else {
      // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
      const Sentry = require('@sentry/react-native');
      if (Sentry && typeof Sentry.captureException === 'function') {
        Sentry.captureException(err);
        return;
      }
    }
  } catch (e) {
    // ignore failures
  }
  // Fallback: log to console
  // eslint-disable-next-line no-console
  console.error('[Sentry] reportError fallback', err);
}
