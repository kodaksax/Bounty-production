/**
 * With `poster-home` on, someone whose role is poster doesn't get the moments
 * about getting paid.
 */

import { evaluateEligibleMoments } from '../../../../lib/moments/engine';
import type { MomentContext, MomentState, MomentType } from '../../../../lib/moments/types';

const SUPPRESSED: MomentType[] = [
  'stripe_connect_onboarding',
  'identity_verification',
  'accept_first_bounty',
];

function ctx(
  primaryRole: MomentContext['profile']['primaryRole'],
  isPosterHomeUser: boolean
): MomentContext {
  return {
    userId: 'user-1',
    accountCreatedAt: new Date().toISOString(),
    sessionCount: 2,
    activeScreen: 'bounty',
    isPosterHomeUser,
    hasEngaged: true,
    hasPublishedBounty: true,
    profile: {
      hasAvatar: true,
      hasBio: true,
      hasLocation: true,
      hasSkills: true,
      idVerificationStatus: 'unverified',
      stripeConnectChargesEnabled: false,
      stripeConnectPayoutsEnabled: false,
      primaryRole,
      balance: 0,
    },
    permissions: { notifications: 'granted', location: 'granted' },
  };
}

function pending(...types: MomentType[]): Map<MomentType, MomentState> {
  return new Map(
    types.map(momentType => [
      momentType,
      {
        momentType,
        status: 'pending',
        shownCount: 0,
        firstShownAt: null,
        lastShownAt: null,
        dismissedAt: null,
        completedAt: null,
        snoozedUntil: null,
        metadata: {},
      } as MomentState,
    ])
  );
}

const eligible = (c: MomentContext) =>
  evaluateEligibleMoments(c, pending('accept_first_bounty', 'post_first_bounty')).map(m => m.type);

describe('poster moment suppression', () => {
  it('leaves out the three hunter moments for a poster with the flag on', () => {
    const result = eligible(ctx('poster', true));
    SUPPRESSED.forEach(type => expect(result).not.toContain(type));
  });

  it('still offers post_first_bounty', () => {
    expect(eligible(ctx('poster', true))).toContain('post_first_bounty');
  });

  it('changes nothing for a poster with the flag off', () => {
    const result = eligible(ctx('poster', false));
    expect(result).toContain('identity_verification');
    expect(result).toContain('accept_first_bounty');
  });

  it('changes nothing for a hunter', () => {
    const result = eligible(ctx('hunter', false));
    SUPPRESSED.forEach(type => expect(result).toContain(type));
  });
});
