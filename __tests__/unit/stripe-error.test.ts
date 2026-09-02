import { serializeStripeError } from '../../lib/utils/stripe-error';

describe('serializeStripeError', () => {
  test('preserves useful structured Stripe decline fields', () => {
    expect(
      serializeStripeError({
        type: 'StripeCardError',
        code: 'card_declined',
        decline_code: 'insufficient_funds',
        message: 'Your card was declined.',
        requestId: 'req_123',
      })
    ).toEqual({
      type: 'StripeCardError',
      code: 'card_declined',
      decline_code: 'insufficient_funds',
      message: 'Your card was declined.',
      request_id: 'req_123',
    });
  });

  test('never coerces an object error to [object Object]', () => {
    const serialized = serializeStripeError({ raw: { type: 'StripeError' } });

    expect(serialized.message).not.toBe('[object Object]');
    expect(serialized).toMatchObject({ type: 'StripeError', message: 'Unknown Stripe error' });
  });
});
