// IMPORTANT: We delegate to expo-router's entrypoint so that navigation context is established.
// Previously this file rendered a standalone component (Todo list) which broke useRouter() calls
// with the error: "Couldn't find a navigation context". Keeping this as a thin pass-through
// ensures compatibility with the "main": "expo-router/entry" in package.json.
import 'expo-router/entry';

// If you need to run global side-effects before the router mounts, you can add them here, e.g.:
// import './polyfills';
// But do not export a React component – expo-router handles root mounting.

if (__DEV__) {
	// eslint-disable-next-line no-console
	console.log('[AppEntry] expo-router entry imported (navigation context should be established)');
}

