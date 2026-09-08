/**
 * Profile-polish completion meter.
 *
 * Distinct from both:
 *  - checkProfileCompleteness() in lib/services/userProfile.ts, which is a
 *    stricter onboarding-gating concept (username/displayName/avatar/bio
 *    required) used to decide whether onboarding is "done" — left untouched.
 *  - the `profile_complete` verification badge in verification-badges.ts,
 *    which pins the same 4-field definition and is covered by an existing
 *    test — also left untouched.
 *
 * This is a softer, encouragement-oriented meter over a wider set of
 * personalization fields, meant to drive the visual "Your profile is N%
 * complete" indicator. Missing fields are never treated as errors.
 */

export type ProfileCompletenessItem =
  | 'username'
  | 'display_name'
  | 'avatar_url'
  | 'bio'
  | 'location'
  | 'banner_url';

const ITEMS: ProfileCompletenessItem[] = [
  'username',
  'display_name',
  'avatar_url',
  'bio',
  'location',
  'banner_url',
];

export interface ProfileCompletenessInput {
  username?: string | null;
  display_name?: string | null;
  avatar_url?: string | null;
  bio?: string | null;
  location?: string | null;
  banner_url?: string | null;
}

export interface ProfileCompletenessResult {
  percent: number;
  completedItems: ProfileCompletenessItem[];
  missingItems: ProfileCompletenessItem[];
  isComplete: boolean;
}

export function calculateProfileCompleteness(
  input: ProfileCompletenessInput
): ProfileCompletenessResult {
  const completedItems: ProfileCompletenessItem[] = [];
  const missingItems: ProfileCompletenessItem[] = [];

  for (const item of ITEMS) {
    const value = input[item];
    const isSet = typeof value === 'string' && value.trim().length > 0;
    (isSet ? completedItems : missingItems).push(item);
  }

  const percent = Math.round((completedItems.length / ITEMS.length) * 100);

  return {
    percent,
    completedItems,
    missingItems,
    isComplete: missingItems.length === 0,
  };
}

/** Human-readable label + suggestion copy for a missing item, for the completion meter's suggestion list. */
export const PROFILE_COMPLETENESS_SUGGESTIONS: Record<ProfileCompletenessItem, string> = {
  username: 'Choose a username',
  display_name: 'Add your display name',
  avatar_url: 'Add a profile photo',
  bio: 'Add a short bio',
  location: 'Add your location',
  banner_url: 'Add a banner',
};
