import { describePaymentFailure } from '../../../lib/utils/payment-failure-message';
import { failureEventProps } from '../../../lib/utils/stripe-error';

// Every case is built from the SDK error shape the app really receives, run
// through the same failureEventProps that payment_failed uses — so the copy
// and the analytics can never disagree about what happened.
const sdkError = (fields: Record<string, unknown>, method?: 'card' | 'apple_pay') =>
  failureEventProps({ code: 'Failed', type: 'card_error', ...fields }, 'unknown', method);

describe('describePaymentFailure', () => {
  test('insufficient funds (tahlanalevi, attempt 1)', () => {
    const copy = describePaymentFailure(
      sdkError({ stripeErrorCode: 'card_declined', declineCode: 'insufficient_funds' }, 'card'),
      { walletName: 'Apple Pay' }
    );
    expect(copy.title).toBe("This card doesn't have enough funds.");
    expect(copy.message).toContain('Try another card or Apple Pay.');
    expect(copy.action).toBe('another_method');
  });

  test('Apple Pay ZIP mismatch (tahlanalevi, attempt 2) points at Apple Wallet, not at Apple Pay again', () => {
    const copy = describePaymentFailure(sdkError({ stripeErrorCode: 'incorrect_zip' }, 'apple_pay'), {
      walletName: 'Apple Pay',
    });
    expect(copy.title).toBe("Your bank couldn't match the billing ZIP code.");
    expect(copy.message).toContain('Apple Wallet');
    expect(copy.message).not.toContain('or Apple Pay');
  });

  test('fraud-flavoured declines read as an ordinary bank decline', () => {
    for (const declineCode of ['fraudulent', 'stolen_card', 'lost_card', 'generic_decline', 'do_not_honor']) {
      const copy = describePaymentFailure(
        sdkError({ stripeErrorCode: 'card_declined', declineCode }, 'card'),
        { walletName: 'Apple Pay' }
      );
      expect(copy).toEqual({
        title: 'Your bank declined this card.',
        message: 'Try another card or Apple Pay.',
        action: 'another_method',
      });
    }
  });

  test('no wallet on the device: suggests another card only', () => {
    const copy = describePaymentFailure(
      sdkError({ stripeErrorCode: 'card_declined', declineCode: 'generic_decline' }, 'card')
    );
    expect(copy.message).toBe('Try another card.');
  });

  test('a failed bank approval step says nothing was charged and suggests retrying', () => {
    const copy = describePaymentFailure(
      sdkError({ stripeErrorCode: 'payment_intent_authentication_failure' }, 'card')
    );
    expect(copy.action).toBe('retry');
    expect(copy.message).toContain('Nothing was charged');
  });

  test('security-code instructions do not assume a three-digit code or card location', () => {
    const copy = describePaymentFailure(
      failureEventProps({
        type: 'card_error',
        code: 'incorrect_cvc',
        message: 'Security code did not match',
      })
    );

    expect(copy.message).toContain('security code on your card');
    expect(copy.message).not.toMatch(/3-digit|back/i);
  });

  test('API authentication failures ask the payer to sign in again', () => {
    const copy = describePaymentFailure(
      failureEventProps({
        type: 'api_error',
        code: 'authentication_required',
        message: 'Authentication required',
      })
    );

    expect(copy).toMatchObject({
      title: 'Your session needs attention.',
      message: 'Please sign in again before trying this payment.',
      action: 'retry',
    });
  });

  test('a transient network failure suggests waiting and retrying', () => {
    const copy = describePaymentFailure(
      failureEventProps({ type: 'api_connection_error', message: 'offline' })
    );
    expect(copy).toMatchObject({ title: "We couldn't reach your bank.", action: 'retry' });
  });

  test('an unknown failure still says what to do next', () => {
    const copy = describePaymentFailure(failureEventProps(new Error('boom')), {
      walletName: 'Google Pay',
    });
    expect(copy.title).toBe("This payment didn't go through.");
    expect(copy.message).toContain('Google Pay');
  });

  test('no failure at all is handled', () => {
    expect(describePaymentFailure(null).title).toBe("This payment didn't go through.");
  });
});
