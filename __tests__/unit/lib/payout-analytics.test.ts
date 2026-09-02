import { classifyPayoutFailure } from '../../../lib/utils/payout-analytics';

describe('classifyPayoutFailure', () => {
  test('an already-in-progress withdrawal is payout_already_pending, never payout_failed', () => {
    expect(
      classifyPayoutFailure({ code: 'withdrawal_already_in_progress', stripeAttempted: false })
    ).toBe('payout_already_pending');
  });

  test('withdrawal_already_in_progress wins even if stripeAttempted were somehow true', () => {
    // The backend never sets this combination — findInFlightWithdrawal()
    // runs before any Stripe call — but the client-side classifier should
    // not depend on that invariant holding forever. The code IS the specific
    // business rule; it takes priority.
    expect(
      classifyPayoutFailure({ code: 'withdrawal_already_in_progress', stripeAttempted: true })
    ).toBe('payout_already_pending');
  });

  test('a genuine Stripe-attempt failure is payout_failed', () => {
    expect(classifyPayoutFailure({ code: 'transfer_failed', stripeAttempted: true })).toBe(
      'payout_failed'
    );
  });

  test('a pre-flight business-rule rejection with a code is payout_rejected', () => {
    expect(
      classifyPayoutFailure({ code: 'insufficient_balance', stripeAttempted: false })
    ).toBe('payout_rejected');
    expect(classifyPayoutFailure({ code: 'below_minimum' })).toBe('payout_rejected');
  });

  test('a response with a code but no stripeAttempted flag is still a rejection, not a failure', () => {
    // Most pre-flight codes never carry the flag at all — only the handful of
    // genuine post-Stripe-call catch blocks set it to true.
    expect(classifyPayoutFailure({ code: 'no_bank_account' })).toBe('payout_rejected');
  });

  test('no code at all (network error, timeout, abort) stays payout_failed', () => {
    expect(classifyPayoutFailure({})).toBe('payout_failed');
    expect(classifyPayoutFailure({ stripeAttempted: undefined })).toBe('payout_failed');
  });
});
