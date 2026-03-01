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
  | 'profile_complete'
  | 'trusted';

export interface VerificationBadgeInput {
  email_confirmed?: boolean;
  phone_verified?: boolean;
  id_verification_status?: 'none' | 'pending' | 'approved' | 'rejected';
  selfie_submitted_at?: string | null;
  age_verified?: boolean;
  // Profile completeness fields
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
 * - ID Verified      : id_verification_status === 'approved'
 * - Profile Complete : display_name, avatar_url, and bio are all non-empty
 * - Trusted          : all four above badges are earned
 */
export function getVerificationBadges(input: VerificationBadgeInput): VerificationBadge[] {
  const emailEarned = input.email_confirmed === true;
  const phoneEarned = input.phone_verified === true;
  const idEarned = input.id_verification_status === 'approved';
  const profileEarned =
    !!input.display_name?.trim() &&
    !!input.avatar_url?.trim() &&
    !!input.bio?.trim();

  const trustedEarned = emailEarned && phoneEarned && idEarned && profileEarned;

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
      id: 'profile_complete',
      label: 'Profile Complete',
      description: 'Display name, avatar, and bio are all set.',
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

  if (input.id_verification_status === 'pending') return 'pending';

  return 'unverified';
}
