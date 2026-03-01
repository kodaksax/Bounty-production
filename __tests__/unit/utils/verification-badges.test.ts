/**
 * Unit tests for verification-badges utilities
 */

import {
  getVerificationBadges,
  deriveVerificationStatus,
  type VerificationBadgeInput,
} from '../../../lib/utils/verification-badges';

const fullyVerifiedInput: VerificationBadgeInput = {
  email_confirmed: true,
  phone_verified: true,
  id_verification_status: 'approved',
  display_name: 'Alice',
  avatar_url: 'https://example.com/avatar.jpg',
  bio: 'Experienced developer',
};

describe('getVerificationBadges', () => {
  it('marks all badges as earned for a fully-verified user', () => {
    const badges = getVerificationBadges(fullyVerifiedInput);
    badges.forEach((b) => expect(b.earned).toBe(true));
  });

  it('email_confirmed badge is earned only when email_confirmed is true', () => {
    const earned = getVerificationBadges({ ...fullyVerifiedInput, email_confirmed: true });
    expect(earned.find((b) => b.id === 'email_confirmed')?.earned).toBe(true);

    const unearned = getVerificationBadges({ ...fullyVerifiedInput, email_confirmed: false });
    expect(unearned.find((b) => b.id === 'email_confirmed')?.earned).toBe(false);
  });

  it('phone_verified badge is earned only when phone_verified is true', () => {
    const earned = getVerificationBadges({ ...fullyVerifiedInput, phone_verified: true });
    expect(earned.find((b) => b.id === 'phone_verified')?.earned).toBe(true);

    const unearned = getVerificationBadges({ ...fullyVerifiedInput, phone_verified: false });
    expect(unearned.find((b) => b.id === 'phone_verified')?.earned).toBe(false);
  });

  it('id_verified badge is earned only when id_verification_status is approved', () => {
    const approved = getVerificationBadges({ ...fullyVerifiedInput, id_verification_status: 'approved' });
    expect(approved.find((b) => b.id === 'id_verified')?.earned).toBe(true);

    for (const status of ['none', 'pending', 'rejected'] as const) {
      const notApproved = getVerificationBadges({ ...fullyVerifiedInput, id_verification_status: status });
      expect(notApproved.find((b) => b.id === 'id_verified')?.earned).toBe(false);
    }
  });

  it('profile_complete badge requires display_name, avatar_url, and bio', () => {
    const complete = getVerificationBadges(fullyVerifiedInput);
    expect(complete.find((b) => b.id === 'profile_complete')?.earned).toBe(true);

    const missingName = getVerificationBadges({ ...fullyVerifiedInput, display_name: '' });
    expect(missingName.find((b) => b.id === 'profile_complete')?.earned).toBe(false);

    const missingAvatar = getVerificationBadges({ ...fullyVerifiedInput, avatar_url: null });
    expect(missingAvatar.find((b) => b.id === 'profile_complete')?.earned).toBe(false);

    const missingBio = getVerificationBadges({ ...fullyVerifiedInput, bio: '   ' });
    expect(missingBio.find((b) => b.id === 'profile_complete')?.earned).toBe(false);
  });

  it('trusted badge is not earned if any step is incomplete', () => {
    const noPhone = getVerificationBadges({ ...fullyVerifiedInput, phone_verified: false });
    expect(noPhone.find((b) => b.id === 'trusted')?.earned).toBe(false);
  });

  it('returns 5 badges', () => {
    const badges = getVerificationBadges({});
    expect(badges).toHaveLength(5);
  });
});

describe('deriveVerificationStatus', () => {
  it('returns trusted when all Phase 1 steps are complete', () => {
    expect(deriveVerificationStatus(fullyVerifiedInput)).toBe('trusted');
  });

  it('returns verified when id is approved but not all steps complete', () => {
    const input: VerificationBadgeInput = {
      ...fullyVerifiedInput,
      phone_verified: false,
    };
    expect(deriveVerificationStatus(input)).toBe('verified');
  });

  it('returns pending when id_verification_status is pending', () => {
    const input: VerificationBadgeInput = {
      email_confirmed: true,
      id_verification_status: 'pending',
    };
    expect(deriveVerificationStatus(input)).toBe('pending');
  });

  it('returns unverified for empty input', () => {
    expect(deriveVerificationStatus({})).toBe('unverified');
  });
});
