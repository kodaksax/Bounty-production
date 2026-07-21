/**
 * Unit tests for the identity_verification moment's eligibility rule
 * (lib/moments/registry.ts) — the "Verify Your Identity" prompt's display
 * logic. Covers: not nagging brand-new users right after onboarding, the
 * "strong reason" overrides (payout-relevant screen, high balance), the
 * returning-user fallback, and rejected-resubmission handling.
 */

import { MOMENT_REGISTRY } from '../../../../lib/moments/registry';
import type { MomentContext } from '../../../../lib/moments/types';

const identityVerification = MOMENT_REGISTRY.find((m) => m.type === 'identity_verification')!;

function makeContext(overrides: Partial<MomentContext> = {}): MomentContext {
  return {
    userId: 'user-1',
    accountCreatedAt: new Date().toISOString(),
    sessionCount: 1,
    activeScreen: null,
    profile: {
      hasAvatar: false,
      hasBio: false,
      hasLocation: false,
      hasSkills: false,
      idVerificationStatus: 'unverified',
      stripeConnectChargesEnabled: false,
      stripeConnectPayoutsEnabled: false,
      primaryRole: 'hunter',
      balance: 0,
    },
    permissions: {
      notifications: 'undetermined',
      location: 'undetermined',
    },
    ...overrides,
  };
}

describe('identity_verification moment', () => {
  it('is defined with a sensible cooldown and shown cap', () => {
    expect(identityVerification.cooldownHours).toBeGreaterThan(0);
    expect(identityVerification.maxShownCount).toBeGreaterThan(0);
  });

  it('is never eligible once verified', () => {
    const ctx = makeContext({ profile: { ...makeContext().profile, idVerificationStatus: 'verified' } });
    expect(identityVerification.isEligible(ctx, null)).toBe(false);
  });

  it('is never eligible while pending review', () => {
    const ctx = makeContext({ profile: { ...makeContext().profile, idVerificationStatus: 'pending' } });
    expect(identityVerification.isEligible(ctx, null)).toBe(false);
  });

  it('does NOT show a brand-new user (session 1) on a neutral screen with no strong reason', () => {
    const ctx = makeContext({ sessionCount: 1, activeScreen: 'bounty' });
    expect(identityVerification.isEligible(ctx, null)).toBe(false);
  });

  it('shows a returning user (session >= 2) on a neutral screen', () => {
    const ctx = makeContext({ sessionCount: 2, activeScreen: 'bounty' });
    expect(identityVerification.isEligible(ctx, null)).toBe(true);
  });

  it('shows even a session-1 user once they reach a payout-relevant screen (strong reason)', () => {
    const ctx = makeContext({ sessionCount: 1, activeScreen: 'wallet' });
    expect(identityVerification.isEligible(ctx, null)).toBe(true);
  });

  it('shows even a session-1 user once their balance crosses the high-value threshold (strong reason)', () => {
    const ctx = makeContext({
      sessionCount: 1,
      activeScreen: 'bounty',
      profile: { ...makeContext().profile, balance: 150 },
    });
    expect(identityVerification.isEligible(ctx, null)).toBe(true);
  });

  it('does not treat a balance just under the threshold as a strong reason', () => {
    const ctx = makeContext({
      sessionCount: 1,
      activeScreen: 'bounty',
      profile: { ...makeContext().profile, balance: 99.99 },
    });
    expect(identityVerification.isEligible(ctx, null)).toBe(false);
  });

  it('treats a rejected submission the same as unverified for eligibility', () => {
    const ctx = makeContext({
      sessionCount: 2,
      profile: { ...makeContext().profile, idVerificationStatus: 'rejected' },
    });
    expect(identityVerification.isEligible(ctx, null)).toBe(true);
  });

  it('serves resubmission copy for rejected status and standard copy otherwise', () => {
    const rejectedCtx = makeContext({ profile: { ...makeContext().profile, idVerificationStatus: 'rejected' } });
    const unverifiedCtx = makeContext({ profile: { ...makeContext().profile, idVerificationStatus: 'unverified' } });

    expect(identityVerification.content(rejectedCtx).title).toMatch(/resubmit/i);
    expect(identityVerification.content(unverifiedCtx).title).toMatch(/verify your identity/i);
  });

  it('auto-completes once status moves to pending or verified', () => {
    const pendingCtx = makeContext({ profile: { ...makeContext().profile, idVerificationStatus: 'pending' } });
    const verifiedCtx = makeContext({ profile: { ...makeContext().profile, idVerificationStatus: 'verified' } });
    expect(identityVerification.checkCompleted?.(pendingCtx)).toBe(true);
    expect(identityVerification.checkCompleted?.(verifiedCtx)).toBe(true);
  });
});
