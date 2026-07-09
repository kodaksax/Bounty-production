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

/**
 * Role intent captured on the onboarding carousel's final slide
 * ("Get something done" → poster, "Start earning nearby" → hunter).
 * Device-local hint only — used to tailor onboarding copy/CTAs; it never
 * gates features and both roles see the full app.
 */
export type OnboardingRole = 'poster' | 'hunter';

/** AsyncStorage key for the device-local onboarding role intent. */
export const ONBOARDING_ROLE_KEY = '@bounty_onboarding_role';

/** Returns the stored onboarding role intent, or null if unset/unreadable. */
export async function getOnboardingRole(): Promise<OnboardingRole | null> {
  try {
    const val = await AsyncStorage.getItem(ONBOARDING_ROLE_KEY);
    return val === 'poster' || val === 'hunter' ? val : null;
  } catch {
    return null;
  }
}
