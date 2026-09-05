/**
 * Verification badge system utilities
 *
 * Determines which verification badges a user has earned and derives the
 * overall verification status that drives UserProfile.verificationStatus.
 */

export type VerificationBadgeId =
  | 'email_confirmed'
  | 'phone_verified'
  | 'id_verified'
  | 'age_verified'
  | 'profile_complete'
  | 'trusted';

export interface VerificationBadgeInput {
  email_confirmed?: boolean;
  phone_verified?: boolean;
  id_verification_status?: 'unverified' | 'pending' | 'verified' | 'rejected';
  selfie_submitted_at?: string | null;
  age_verified?: boolean;
  // Stripe Identity status -- new source of truth for id_verified. Legacy
  // id_verification_status is still checked as a fallback for profiles
  // verified before the Stripe Identity migration (backfilled, never had a
  // real VerificationSession created for them).
  stripe_identity_status?: 'unstarted' | 'requires_input' | 'processing' | 'verified' | 'canceled';
  // Profile completeness fields (aligned with checkProfileCompleteness)
  username?: string | null;
  display_name?: string | null;
  avatar_url?: string | null;
  bio?: string | null;
}

export interface VerificationBadge {
  id: VerificationBadgeId;
  label: string;
  description: string;
  earned: boolean;
}

/**
 * Returns the list of verification badges with their earned state.
 *
 * Badge criteria:
 * - Email Confirmed  : email_confirmed === true
 * - Phone Verified   : phone_verified === true
 * - ID Verified      : id_verification_status === 'verified'
 * - Age Verified     : age_verified === true (set automatically when ID is approved by admin)
 * - Profile Complete : username, display_name, avatar_url, and bio are all non-empty
 *                      (aligned with checkProfileCompleteness in userProfile.ts)
 * - Trusted          : all five above badges are earned
 */
export function getVerificationBadges(input: VerificationBadgeInput): VerificationBadge[] {
  const emailEarned = input.email_confirmed === true;
  const phoneEarned = input.phone_verified === true;
  const idEarned = input.stripe_identity_status === 'verified' || input.id_verification_status === 'verified';
  const ageEarned = input.age_verified === true;
  const profileEarned =
    !!input.username?.trim() &&
    !!input.display_name?.trim() &&
    !!input.avatar_url?.trim() &&
    !!input.bio?.trim();

  const trustedEarned = emailEarned && phoneEarned && idEarned && ageEarned && profileEarned;

  return [
    {
      id: 'email_confirmed',
      label: 'Email Confirmed',
      description: 'Email address has been verified.',
      earned: emailEarned,
    },
    {
      id: 'phone_verified',
      label: 'Phone Verified',
      description: 'Phone number has been verified via SMS.',
      earned: phoneEarned,
    },
    {
      id: 'id_verified',
      label: 'ID Verified',
      description: 'Government-issued ID has been approved.',
      earned: idEarned,
    },
    {
      id: 'age_verified',
      label: '✓ 18+',
      description: 'Age verified as 18 or older via approved government ID.',
      earned: ageEarned,
    },
    {
      id: 'profile_complete',
      label: 'Profile Complete',
      description: 'Username, display name, avatar, and bio are all set.',
      earned: profileEarned,
    },
    {
      id: 'trusted',
      label: 'Trusted',
      description: 'All Phase 1 verification steps are complete.',
      earned: trustedEarned,
    },
  ];
}

/**
 * Derives the UserProfile.verificationStatus value from verification inputs.
 *
 * - 'trusted'    : all Phase 1 steps complete
 * - 'verified'   : id approved but not all steps complete
 * - 'pending'    : id verification is pending
 * - 'unverified' : otherwise
 */
export function deriveVerificationStatus(
  input: VerificationBadgeInput,
): 'unverified' | 'pending' | 'verified' | 'trusted' {
  const badges = getVerificationBadges(input);
  const trusted = badges.find((b) => b.id === 'trusted');
  if (trusted?.earned) return 'trusted';

  const idVerified = badges.find((b) => b.id === 'id_verified');
  if (idVerified?.earned) return 'verified';

  if (input.stripe_identity_status === 'processing' || input.id_verification_status === 'pending') return 'pending';

  return 'unverified';
}

/**
 * Marketplace-activity milestone badges — a distinct concept from the
 * identity-verification badges above. These are earned from real, deterministic
 * marketplace activity (via get_profile_activity_stats + ratings), not
 * identity/KYC state. Kept as a small, meaningful set rather than decorative
 * gamification — see the profile-overhaul plan for the "don't create
 * meaningless badges" guidance this follows.
 */
export type MilestoneBadgeId = 'first_bounty_posted' | 'bounties_completed_5' | 'top_rated';

export interface MilestoneBadgeInput {
  bounties_posted?: number;
  bounties_completed?: number;
  average_rating?: number;
  rating_count?: number;
}

export interface MilestoneBadge {
  id: MilestoneBadgeId;
  label: string;
  description: string;
  earned: boolean;
}

/**
 * Badge criteria:
 * - First Bounty Posted : bounties_posted >= 1
 * - 5 Bounties Completed: bounties_completed >= 5
 * - Top Rated           : average_rating >= 4.5 with rating_count >= 5
 *                         (a minimum sample size so a single 5-star rating
 *                         can't earn it)
 */
export function getMilestoneBadges(input: MilestoneBadgeInput): MilestoneBadge[] {
  const postedEarned = (input.bounties_posted ?? 0) >= 1;
  const completed5Earned = (input.bounties_completed ?? 0) >= 5;
  const topRatedEarned = (input.average_rating ?? 0) >= 4.5 && (input.rating_count ?? 0) >= 5;

  return [
    {
      id: 'first_bounty_posted',
      label: 'First Bounty Posted',
      description: 'Posted their first bounty on Bounty.',
      earned: postedEarned,
    },
    {
      id: 'bounties_completed_5',
      label: '5 Bounties Completed',
      description: 'Successfully completed 5 or more posted bounties.',
      earned: completed5Earned,
    },
    {
      id: 'top_rated',
      label: 'Top Rated',
      description: 'Maintains a 4.5+ average rating across 5 or more reviews.',
      earned: topRatedEarned,
    },
  ];
}
