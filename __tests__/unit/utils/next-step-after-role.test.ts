import { nextStepAfterRole } from '../../../lib/onboarding/next-step-after-role';

describe('nextStepAfterRole', () => {
  test('posters skip Stripe payout setup', () => {
    expect(nextStepAfterRole('poster')).toBe('/onboarding/founder-note');
  });

  test('hunters go to payout setup', () => {
    expect(nextStepAfterRole('hunter')).toBe('/onboarding/payouts');
  });
});
