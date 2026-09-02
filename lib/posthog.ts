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

// dev / staging / preview / production all report into the same PostHog
// project (see EXPO_PUBLIC_ENVIRONMENT in .env.*). Tag every event and person
// with this so Insights/dashboards can filter non-production traffic out.
const APP_ENVIRONMENT = process.env.EXPO_PUBLIC_ENVIRONMENT || 'development';

const INTERNAL_EMAILS = new Set([
  'jordanmag11@yahoo.com',
  'leewright093@gmail.com',
  'support@bountyfinder.app',
  'posterbnty158@gmail.com',
  'hunterbnty158@gmail.com',
]);

export const isInternalEmail = (email: string): boolean => {
  const normalizedEmail = email.trim().toLowerCase();
  return INTERNAL_EMAILS.has(normalizedEmail) || normalizedEmail.includes('bountyfinder');
};

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
      _posthog = new PostHog(POSTHOG_KEY, {
        host: POSTHOG_HOST,
        // Explicit even though it matches the SDK default: only create a
        // Person profile once a user is identified (post sign-up/sign-in).
        // Anonymous pre-auth events (e.g. app_opened) still record fine for
        // acquisition funnels — they just don't cost a person profile.
        personProfiles: 'identified_only',
        // Application Installed/Opened/Updated/Backgrounded — needed for the
        // acquisition -> activation funnel referenced in app/_layout.tsx.
        captureAppLifecycleEvents: true,
        // Sentry (@sentry/react-native) is already wired as the crash/error
        // reporter throughout this app (see analytics-service.ts). Disable
        // PostHog's own global exception/rejection/console handlers so the
        // two don't both install competing global handlers.
        errorTracking: {
          autocapture: {
            uncaughtExceptions: false,
            unhandledRejections: false,
            console: false,
          },
        },
        // Session Replay. Also requires "Record user sessions" to be enabled
        // in the PostHog project settings, and the optional native module
        // `posthog-react-native-session-replay` to be present (it is a
        // dependency in package.json) — without it the SDK logs "Session
        // replay enabled but not installed." and records nothing.
        enableSessionReplay: true,
        // This app renders Stripe/ACH, password, KYC, private-message and
        // bounty-description screens, so replay runs fully masked. Do not
        // relax these to make recordings easier to read; use
        // `PostHogMaskView` from posthog-react-native to mask *more*.
        sessionReplayConfig: {
          // Masks all text input fields (emails, addresses, phone numbers, payment fields).
          // Static <Text> content is not guaranteed to be masked — wrap sensitive UI in PostHogMaskView.
          maskAllTextInputs: true,
          // Masks all images to a placeholder (avatars, bounty photos, ID /
          // KYC uploads, attachment previews).
          maskAllImages: true,
          // Explicit even though it matches the SDK default: masks iOS
          // sandboxed system views (photo/contact pickers used by the
          // attachment and avatar flows).
          maskAllSandboxedViews: true,
          // Off (SDK default is on): console output is Sentry's channel in
          // this app (see `errorTracking` above), and the diagnostic logs in
          // lib/utils/auth-diagnostics.ts and the payment paths are not
          // written with replay redaction in mind.
          captureLog: false,
        },
        debug: __DEV__,
      });
      _posthog.register({ app_env: APP_ENVIRONMENT });
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
    const email = typeof properties?.email === 'string' ? properties.email : null;
    const identityProperties = email
      ? { ...properties, is_internal: isInternalEmail(email) }
      : properties;

    // identify() already merges the current anonymous person into the
    // identified person, so no alias() call is needed. But calling it while the
    // SDK is already identified as a different user would instead ask the
    // pipeline to merge two identified persons, which it rejects
    // (cannot_merge_already_identified). Reset first so identify() starts from a
    // fresh anonymous id — this covers shared or account-switch devices.
    const currentDistinctId =
      typeof _posthog.getDistinctId === 'function' ? _posthog.getDistinctId() : undefined;
    const anonymousId =
      typeof _posthog.getAnonymousId === 'function' ? _posthog.getAnonymousId() : undefined;
    const currentIsIdentified =
      !!anonymousId && !!currentDistinctId && currentDistinctId !== anonymousId;
    if (
      currentIsIdentified &&
      currentDistinctId !== distinctId &&
      typeof _posthog.reset === 'function'
    ) {
      _posthog.reset();
    }

    if (email && typeof _posthog.register === 'function') {
      _posthog.register({ is_internal: isInternalEmail(email) });
    }
    _posthog.identify(distinctId, identityProperties);
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
    _posthog.capture('$set', { $set: properties });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[posthog] setPersonProperties failed', e);
  }
};

/** Set immutable person properties without replacing values already stored by PostHog. */
export const setPersonPropertiesOnce = (properties: Record<string, any>): void => {
  try {
    if (!_posthog) return;
    _posthog.setPersonProperties(undefined, properties);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[posthog] setPersonPropertiesOnce failed', e);
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

/** A PostHog flag value: `true`/`false` for a boolean flag, or the variant key. */
export type FeatureFlagValue = string | boolean;

/**
 * Read a feature flag outside React — services, startup code, and anything
 * else that can't call a hook. The imperative counterpart to `useFeatureFlag`
 * below (`posthog.getFeatureFlag(key)` in PostHog's own docs).
 *
 * Returns `undefined` when the flag hasn't resolved yet (first launch, before
 * the initial /flags response), when the key doesn't exist, or when PostHog is
 * unavailable — so `undefined` means "unknown", never "off". After the first
 * launch values come from the SDK's local cache, so this is synchronous.
 *
 * The first call for a given key records `$feature_flag_called`, which is what
 * a PostHog experiment counts as an exposure; the SDK re-arms that report
 * whenever a fresh flags response arrives, so reading before flags have loaded
 * only costs one throwaway event, it doesn't poison the experiment.
 */
export const getFeatureFlag = (key: string): FeatureFlagValue | undefined => {
  try {
    if (!_posthog || typeof _posthog.getFeatureFlag !== 'function') return undefined;
    return _posthog.getFeatureFlag(key);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[posthog] getFeatureFlag failed', e);
    return undefined;
  }
};

/**
 * Subscribe to feature-flag (re)loads — pairs with `getFeatureFlag` when a
 * non-React caller needs to wait for the first flags response instead of
 * treating an unresolved flag as absent.
 *
 * @returns An unsubscribe function (a no-op when PostHog is unavailable).
 */
export const onFeatureFlags = (callback: () => void): (() => void) => {
  try {
    if (!_posthog || typeof _posthog.onFeatureFlags !== 'function') return () => {};
    return _posthog.onFeatureFlags(callback) ?? (() => {});
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[posthog] onFeatureFlags failed', e);
    return () => {};
  }
};

/**
 * Reads a feature flag value inside a component tree wrapped by
 * `PostHogProvider` (see app/_layout.tsx). Re-exported here so call sites use
 * the same `lib/posthog` import surface as the rest of this module instead of
 * reaching into `posthog-react-native` directly.
 */
export { useFeatureFlag } from 'posthog-react-native';

export default getPostHog;
