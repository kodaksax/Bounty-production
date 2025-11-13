// IMPORTANT: We delegate to expo-router's entrypoint so that navigation context is established.
// Previously this file rendered a standalone component (Todo list) which broke useRouter() calls
// with the error: "Couldn't find a navigation context". Keeping this as a thin pass-through
// ensures compatibility with the "main": "expo-router/entry" in package.json.
import 'expo-router/entry';

// If you need to run global side-effects before the router mounts, you can add them here, e.g.:
// import './polyfills';
import * as Sentry from '@sentry/react-native';

Sentry.init({
  dsn: 'https://6aaf694964261a5e219b858da9c1b1e5@o4510355895025664.ingest.us.sentry.io/4510355897319424',

  // Adds more context data to events (IP address, cookies, user, etc.)
  // For more information, visit: https://docs.sentry.io/platforms/react-native/data-management/data-collected/
  sendDefaultPii: true,

  // Enable Logs
  enableLogs: true,

  // Configure Session Replay
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1,
  integrations: [Sentry.mobileReplayIntegration(), Sentry.feedbackIntegration()],

  // uncomment the line below to enable Spotlight (https://spotlightjs.com)
  // spotlight: __DEV__,
});
// But do not export a React component – expo-router handles root mounting.

if (__DEV__) {
	// eslint-disable-next-line no-console
	console.log('[AppEntry] expo-router entry imported (navigation context should be established)');
}
// Note: Do NOT export a React component from this file. The `expo-router/entry` import above
// establishes the navigation/root mounting. Root-level providers (Stripe, Theme, Auth, etc.)
// are provided inside `app/_layout.tsx` so that `Slot` and navigation context are available.

