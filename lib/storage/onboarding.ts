/**
 * Shared utilities for reading/writing the per-user onboarding-completed flag
 * in AsyncStorage.
 *
 * All three locations that need to consult this flag (app/index.tsx,
 * app/auth/sign-in-form.tsx, and app/tabs/bounty-app.tsx) import from here so
 * that a single change to the key format is reflected everywhere.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

/** Prefix for the per-user AsyncStorage key for the onboarding-completed flag. */
const ONBOARDING_COMPLETED_KEY_PREFIX = '@bounty_onboarding_completed:';

/**
 * Device-wide (not per-user) flag: has anyone ever successfully signed in or
 * signed up on this device? Used to distinguish a genuine first-time visitor
 * (never used the app) from a returning user who is simply logged out right
 * now — the former sees the onboarding welcome screen instead of the log-in
 * form; the latter sees the normal log-in form.
 */
const HAS_SIGNED_IN_BEFORE_KEY = '@bounty_has_signed_in_before';

/** Marks this device as having completed at least one sign-in/sign-up. */
export async function markDeviceHasSignedIn(): Promise<void> {
  try {
    await AsyncStorage.setItem(HAS_SIGNED_IN_BEFORE_KEY, 'true');
  } catch {
    // Best-effort — a failed write just means the next launch may show
    // onboarding again instead of the log-in form, which is harmless.
  }
}

/** Returns true if this device has ever completed a sign-in/sign-up. */
export async function hasDeviceSignedInBefore(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(HAS_SIGNED_IN_BEFORE_KEY)) === 'true';
  } catch {
    return false;
  }
}

/** Returns the per-user AsyncStorage key for the onboarding-completed flag. */
export function getOnboardingCompleteKey(userId: string): string {
  return `${ONBOARDING_COMPLETED_KEY_PREFIX}${userId}`;
}

/**
 * Returns true if the per-user AsyncStorage flag indicates the user already
 * completed onboarding. Used as a fallback when the Supabase profile write
 * failed (e.g. bad network) so the user is not sent back to the username screen.
 */
export async function hasLocalOnboardingFlag(userId: string): Promise<boolean> {
  try {
    const val = await AsyncStorage.getItem(getOnboardingCompleteKey(userId));
    return val === 'true';
  } catch {
    return false;
  }
}
