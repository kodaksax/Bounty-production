import {
  failureEventProps,
  getPaymentIntentIdFromClientSecret,
  serializeStripeError,
} from '../../lib/utils/stripe-error';

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

describe('failureEventProps', () => {
  test('never produces [object Object] for the plain objects invokePayments throws', () => {
    // setup_intent_failed shipped `error: String(error)` for exactly this shape
    // (13 events, 09-15/16).
    const props = failureEventProps({
      type: 'api_error',
      code: 'api_key_expired',
      status: 401,
      requestId: 'payments_123',
      message: 'Request failed (401): Expired API Key provided',
    });

    expect(JSON.stringify(props)).not.toContain('[object Object]');
    expect(props).toMatchObject({
      error_code: 'api_key_expired',
      error_type: 'api_error',
      request_id: 'payments_123',
      error_message: 'Request failed (401): Expired API Key provided',
    });
  });

  test("prefers the decline code over the Stripe SDK's generic 'Failed' code", () => {
    // What confirmPayment rethrows for a Radar block.
    expect(
      failureEventProps({ type: 'card_error', code: 'Failed', decline_code: 'fraudulent' })
    ).toMatchObject({ error_code: 'fraudulent', decline_code: 'fraudulent', code: 'Failed' });
  });

  test('reads the SDK camelCase declineCode too', () => {
    expect(failureEventProps({ code: 'Failed', declineCode: 'insufficient_funds' }).error_code).toBe(
      'insufficient_funds'
    );
  });

  test('keeps a generic code when it is all there is', () => {
    expect(failureEventProps({ code: 'Timeout', message: 'timed out' }).error_code).toBe('Timeout');
  });

  test('an Error instance without a code falls back to the fallback code', () => {
    expect(failureEventProps(new Error('Escrow refund did not complete'))).toEqual({
      error_code: 'unknown',
      error_message: 'Escrow refund did not complete',
    });
  });

  test('a failure with no thrown error uses the caller-supplied code, not a Stripe message', () => {
    expect(failureEventProps(undefined, 'refund_incomplete')).toEqual({
      error_code: 'refund_incomplete',
      error_message: 'No error thrown (refund_incomplete)',
    });
    expect(failureEventProps(null).error_message).toBe('No error thrown (unknown)');
  });

  test('caps error_message length', () => {
    expect(failureEventProps(new Error('x'.repeat(500))).error_message).toHaveLength(200);
  });
});

describe('getPaymentIntentIdFromClientSecret', () => {
  test('extracts the PaymentIntent id', () => {
    expect(getPaymentIntentIdFromClientSecret('pi_3UHKpyJekUCspsfJ1frlH8vR_secret_M5dXBb08')).toBe(
      'pi_3UHKpyJekUCspsfJ1frlH8vR'
    );
  });

  test('never returns the secret when the format is unexpected', () => {
    for (const value of ['pi_abc', 'seti_abc_secret_xyz', 'garbage', '', undefined, null, 42]) {
      expect(getPaymentIntentIdFromClientSecret(value)).toBeUndefined();
    }
  });
});
