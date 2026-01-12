// Top-level entry to ensure critical polyfills run before Expo's router/runtime.
// This file is intentionally minimal and must stay free of heavy imports.
try {
  // eslint-disable-next-line global-require
  require('./polyfills/register-callable-modules');
} catch (e) {
  // swallow - polyfill best-effort
}

// Delegate to expo-router's entry for the app runtime
// eslint-disable-next-line global-require
require('expo-router/entry');
