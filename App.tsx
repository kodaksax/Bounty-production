// IMPORTANT: We delegate to expo-router's entrypoint so that navigation context is established.
// Previously this file rendered a standalone component (Todo list) which broke useRouter() calls
// with the error: "Couldn't find a navigation context". Keeping this as a thin pass-through
// ensures compatibility with the "main": "expo-router/entry" in package.json.

// Gesture Handler must be imported before any other code that registers views/handlers.
// Importing it at the very top prevents runtime errors where gesture-handler or
// reanimated gesture hooks are undefined.
import 'react-native-gesture-handler';

// Initialize Sentry and Analytics before anything else
import { analyticsService } from './lib/services/analytics-service';

// Initialize Analytics (Mixpanel)
const MIXPANEL_TOKEN = process.env.EXPO_PUBLIC_MIXPANEL_TOKEN;
if (MIXPANEL_TOKEN) {
	analyticsService.initialize(MIXPANEL_TOKEN).catch((error) => {
		console.error('[Analytics] Initialization failed:', error);
	});
}

import 'expo-router/entry';

// If you need to run global side-effects before the router mounts, you can add them here, e.g.:
// import './polyfills';
// But do not export a React component – expo-router handles root mounting.

if (__DEV__) {
	// eslint-disable-next-line no-console
	console.log('[AppEntry] expo-router entry imported (navigation context should be established)');
}
// Note: Do NOT export a React component from this file. The `expo-router/entry` import above
// establishes the navigation/root mounting. Root-level providers (Stripe, Theme, Auth, etc.)
// are provided inside `app/_layout.tsx` so that `Slot` and navigation context are available.

