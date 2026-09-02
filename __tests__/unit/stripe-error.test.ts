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

  test('preserves the useful string representation of Error instances', () => {
    expect(serializeStripeError(new Error('card declined')).message).toBe('card declined');
  });

  test('preserves both payment intent and charge identifiers', () => {
    expect(
      serializeStripeError({
        raw: { payment_intent: 'pi_123', charge: 'ch_123' },
      })
    ).toMatchObject({
      object_id: 'pi_123',
      payment_intent_id: 'pi_123',
      charge_id: 'ch_123',
    });
  });
});
