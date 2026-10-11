import { isOnboardingRole, nextStepAfterRole } from '../../../lib/onboarding/next-step-after-role';

describe('nextStepAfterRole', () => {
  test('posters skip Stripe payout setup and build their profile', () => {
    expect(nextStepAfterRole('poster')).toBe('/onboarding/poster-profile');
  });

  test('hunters go to payout setup', () => {
    expect(nextStepAfterRole('hunter')).toBe('/onboarding/payouts');
  });

  test('no default route for a missing/unknown role: it throws rather than landing on payouts', () => {
    expect(() => nextStepAfterRole(null as any)).toThrow(/unknown role/);
    expect(() => nextStepAfterRole(undefined as any)).toThrow(/unknown role/);
    expect(() => nextStepAfterRole('both' as any)).toThrow(/unknown role/);
  });
});

describe('isOnboardingRole', () => {
  test('accepts only the two roles', () => {
    expect(isOnboardingRole('poster')).toBe(true);
    expect(isOnboardingRole('hunter')).toBe(true);
    for (const v of [null, undefined, '', 'both', 'Poster', 1, {}]) {
      expect(isOnboardingRole(v)).toBe(false);
    }
  });
});
