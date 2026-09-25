// lib/utils/sentry-gate.ts
//
// Kept apart from lib/services/sentry-init.ts so lib/posthog.ts can ask
// "will Sentry be running?" at module-evaluation time without pulling in
// expo-updates / expo-application.
import { Platform } from 'react-native';

/**
 * Returns true when it is safe to call Sentry.init() at all.
 *
 * @sentry/react-native ≤7.11.0 bundles a Sentry Cocoa SDK that crashes on
 * iOS 26+ (EXC_BAD_ACCESS in SentrySDKInternal startWithOptions:, offset 608,
 * address 0x10 — a null-pointer deref introduced by a breaking iOS 26 change).
 * Setting enableNative:false is NOT sufficient because the JS SDK still calls
 * the native initNativeSdk TurboModule method which triggers the crash.
 * Until @sentry/react-native is upgraded to a version that ships a compatible
 * Cocoa SDK, skip Sentry.init() entirely on iOS 26+.
 */
export function isSentryInitSafe(): boolean {
  if (Platform.OS !== 'ios') return true;
  const iosVersion = parseInt(String(Platform.Version), 10);
  // An unreadable version is treated as unsafe on purpose: the cost of
  // guessing wrong on iOS 26 is a crash at launch, while the cost of skipping
  // Sentry is only that PostHog captures errors instead (lib/posthog.ts).
  if (Number.isNaN(iosVersion)) return false;
  // Completely skip Sentry.init() on iOS 26+ to avoid the SentrySDKInternal crash.
  // enableNative:false alone is insufficient — the native initNativeSdk method
  // is still invoked and crashes at SentrySDKInternal startWithOptions:.
  return iosVersion < 26;
}
