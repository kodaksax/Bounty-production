// Initialize Sentry and Analytics
// Note: expo-router/entry is imported in entry.js, not here, to avoid double registration
import { analyticsService } from './lib/services/analytics-service';
import { initSentry } from './lib/services/sentry-service';

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

// Note: Do NOT export a React component from this file. The `expo-router/entry` import above
// establishes the navigation/root mounting. Root-level providers (Stripe, Theme, Auth, etc.)
// are provided inside `app/_layout.tsx` so that `Slot` and navigation context are available.

