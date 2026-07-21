/**
 * Unit tests for the stripe_connect_onboarding moment's eligibility rule
 * (lib/moments/registry.ts) — the "Setup Payouts" prompt's display logic.
 * Covers: role gating, not nagging brand-new users right after onboarding,
 * the wallet-screen "strong reason" override, and the returning-user
 * fallback.
 */

import { MOMENT_REGISTRY } from '../../../../lib/moments/registry';
import type { MomentContext } from '../../../../lib/moments/types';

const stripeConnectOnboarding = MOMENT_REGISTRY.find((m) => m.type === 'stripe_connect_onboarding')!;

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

describe('stripe_connect_onboarding moment', () => {
  it('is never eligible for a poster-only account, regardless of screen or session', () => {
    const ctx = makeContext({
      sessionCount: 5,
      activeScreen: 'wallet',
      profile: { ...makeContext().profile, primaryRole: 'poster' },
    });
    expect(stripeConnectOnboarding.isEligible(ctx, null)).toBe(false);
  });

  it('is never eligible once payouts are already enabled', () => {
    const ctx = makeContext({
      sessionCount: 5,
      activeScreen: 'wallet',
      profile: { ...makeContext().profile, stripeConnectPayoutsEnabled: true },
    });
    expect(stripeConnectOnboarding.isEligible(ctx, null)).toBe(false);
  });

  it('does NOT show a brand-new hunter (session 1) on a neutral screen with no strong reason', () => {
    const ctx = makeContext({ sessionCount: 1, activeScreen: 'bounty' });
    expect(stripeConnectOnboarding.isEligible(ctx, null)).toBe(false);
  });

  it('shows a returning hunter (session >= 2) on a neutral screen', () => {
    const ctx = makeContext({ sessionCount: 2, activeScreen: 'bounty' });
    expect(stripeConnectOnboarding.isEligible(ctx, null)).toBe(true);
  });

  it('shows even a session-1 hunter once they reach the wallet screen (strong reason)', () => {
    const ctx = makeContext({ sessionCount: 1, activeScreen: 'wallet' });
    expect(stripeConnectOnboarding.isEligible(ctx, null)).toBe(true);
  });

  it('applies the same wallet-screen override to "both" roles', () => {
    const ctx = makeContext({
      sessionCount: 1,
      activeScreen: 'wallet',
      profile: { ...makeContext().profile, primaryRole: 'both' },
    });
    expect(stripeConnectOnboarding.isEligible(ctx, null)).toBe(true);
  });

  it('auto-completes once Stripe Connect payouts are enabled', () => {
    const ctx = makeContext({ profile: { ...makeContext().profile, stripeConnectPayoutsEnabled: true } });
    expect(stripeConnectOnboarding.checkCompleted?.(ctx)).toBe(true);
  });
});
