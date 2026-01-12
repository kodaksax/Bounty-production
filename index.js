// Top-level entry to ensure critical polyfills run before Expo's router/runtime.
// This file is intentionally minimal and must stay free of heavy imports.
// Use static imports so bundlers and Metro execute side-effects in order.
import 'expo-router/entry.js';
import './polyfills/register-callable-modules';

// Some setups may fail to have `main` registered if the above module throws
// before calling `registerRootComponent`. As a resilient fallback, attempt
// to load the entry's default export and register it with Expo. This is
// idempotent if the entry already registered the root component.
try {
  // eslint-disable-next-line global-require
  const expoRouterEntry = require('expo-router/entry.js');
  // eslint-disable-next-line global-require
  const { registerRootComponent } = require('expo');

  const AppComponent = expoRouterEntry && (expoRouterEntry.default || expoRouterEntry);
  // Only attempt to register if the export looks like a React component (function or string).
  // Some modules export an object with side-effects only — registering that causes the
  // "Element type is invalid" runtime error shown in the app. Guard to avoid registering
  // non-component exports coming from `expo-router/entry`.
  if (
    AppComponent &&
    (typeof AppComponent === 'function' || typeof AppComponent === 'string') &&
    typeof registerRootComponent === 'function'
  ) {
    try {
      registerRootComponent(AppComponent);
    } catch (e) {
      // swallow; if registration already happened or fails, metro will show the real error
      // eslint-disable-next-line no-console
      console.debug('[EntryShim] registerRootComponent fallback failed:', e && e.message ? e.message : e);
    }
  } else if (AppComponent) {
    // eslint-disable-next-line no-console
    console.debug('[EntryShim] skipping registerRootComponent because expo-router entry export is not a component', typeof AppComponent);
  }
} catch (e) {
  // eslint-disable-next-line no-console
  console.debug('[EntryShim] expo-router entry fallback check failed:', e && e.message ? e.message : e);
}
