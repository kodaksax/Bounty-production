// lib/posthog.ts
//
// Single source of truth for product analytics across BOUNTYExpo.
//
// This module owns a single standalone PostHog client instance that is shared
// between:
//   1. React components (via `<PostHogProvider client={posthog}>` in app/_layout)
//      and the `usePostHog()` hook.
//   2. Non-React surfaces (services, hooks, startup code) via the helper
//      functions exported here.
//
// Sharing one instance guarantees autocapture, manual `capture()` calls, and
// service-level events all flow into the same PostHog project with a single,
// consistent distinct id.

const POSTHOG_KEY = process.env.EXPO_PUBLIC_POSTHOG_KEY;
const POSTHOG_HOST = process.env.EXPO_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com';

let _posthog: any | null = null;

// Construct the client eagerly (synchronously) so it is available to the
// PostHogProvider at first render. The PostHog React Native SDK constructs
// synchronously and lazily flushes in the background, so this is safe.
try {
  if (POSTHOG_KEY) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('posthog-react-native');
    const PostHog = mod.PostHog ?? mod.default;
    if (PostHog) {
      _posthog = new PostHog(POSTHOG_KEY, { host: POSTHOG_HOST });
    }
  } else if (__DEV__) {
    // eslint-disable-next-line no-console
    console.warn('[posthog] EXPO_PUBLIC_POSTHOG_KEY is not set — analytics disabled');
  }
} catch (e) {
  // PostHog native deps may be unavailable in some runtimes (e.g. certain test
  // environments). Analytics is optional, so degrade gracefully.
  // eslint-disable-next-line no-console
  console.warn('[posthog] client initialization failed — analytics disabled', e);
  _posthog = null;
}

/** Returns the shared PostHog client instance (or null if unavailable). */
export function getPostHog(): any | null {
  return _posthog;
}

/** True when the PostHog client is ready to receive events. */
export const isPostHogReady = (): boolean => !!_posthog;

/**
 * Capture an analytics event.
 * @param event - Event name (snake_case recommended).
 * @param properties - Optional event properties.
 */
export const capture = (event: string, properties?: Record<string, any>): void => {
  try {
    if (!_posthog) {
      if (__DEV__) console.warn('[posthog] capture called before client ready:', event);
      return;
    }
    _posthog.capture(event, properties);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[posthog] capture failed', e);
  }
};

/**
 * Associate the current session with a user and set person properties.
 * @param distinctId - Stable unique user id.
 * @param properties - Person properties to set (e.g. email, name).
 */
export const identify = (distinctId: string, properties?: Record<string, any>): void => {
  try {
    if (!_posthog) {
      if (__DEV__) console.warn('[posthog] identify called before client ready');
      return;
    }
    _posthog.identify(distinctId, properties);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[posthog] identify failed', e);
  }
};

/**
 * Set person properties on the currently identified user.
 * @param properties - Person properties to set.
 */
export const setPersonProperties = (properties: Record<string, any>): void => {
  try {
    if (!_posthog) return;
    // Use the SDK's dedicated setPersonProperties method when available.
    // Falling back to attaching $set on a generic event ensures compatibility
    // with older SDK versions without using $set as the event name (which
    // would pollute the event stream).
    if (typeof _posthog.setPersonProperties === 'function') {
      _posthog.setPersonProperties(properties);
    } else {
      _posthog.capture('person_properties_update', { $set: properties });
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[posthog] setPersonProperties failed', e);
  }
};

/** Register super properties sent with every subsequent event. */
export const register = (properties: Record<string, any>): void => {
  try {
    if (!_posthog || typeof _posthog.register !== 'function') return;
    _posthog.register(properties);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[posthog] register failed', e);
  }
};

/** Capture a screen view. */
export const screen = (name: string, properties?: Record<string, any>): void => {
  try {
    if (!_posthog || typeof _posthog.screen !== 'function') {
      capture('screen_view', { screen_name: name, ...properties });
      return;
    }
    _posthog.screen(name, properties);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[posthog] screen failed', e);
  }
};

/** Reset the client identity (call on logout). */
export const reset = (): void => {
  try {
    if (!_posthog || typeof _posthog.reset !== 'function') return;
    _posthog.reset();
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[posthog] reset failed', e);
  }
};

/** Flush any queued events (useful before app exit). */
export const flush = async (): Promise<void> => {
  try {
    if (!_posthog || typeof _posthog.flush !== 'function') return;
    await _posthog.flush();
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[posthog] flush failed', e);
  }
};

export default getPostHog;
