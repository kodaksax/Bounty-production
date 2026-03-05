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
