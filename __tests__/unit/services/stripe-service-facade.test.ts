/**
 * Supplemental tests for lib/services/stripe-service.ts (facade).
 *
 * The existing `stripe-service.test.ts` already covers:
 *  - initialize, createPaymentMethod, createPaymentIntent, listPaymentMethods,
 *    attachPaymentMethod, Apple Pay validation paths.
 *
 * This file targets the remaining facade methods to raise patch coverage:
 *  - confirmPayment (native SDK error + success paths, handleNextAction flow)
 *  - presentPaymentSheet (not_supported + init/present errors + success)
 *  - handleNextAction (validation, SDK fallback, success, error)
 *  - createPaymentIntentSecure (duplicate detection, retry wrapper)
 *  - confirmPaymentSecure (delegates + error logging)
 *  - parseStripeError (all branches)
 *  - formatCardDisplay, validateCardNumber, getKeyMode passthroughs
 */

beforeAll(() => {
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
  process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_test_mock';
});
afterAll(() => {
  delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
});

jest.mock('../../../lib/services/analytics-service', () => ({
  analyticsService: {
    trackEvent: jest.fn(),
    incrementUserProperty: jest.fn(),
  },
}));

jest.mock('../../../lib/services/performance-service', () => ({
  performanceService: { startMeasurement: jest.fn(), endMeasurement: jest.fn() },
}));

jest.mock('../../../lib/utils/error-logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    warning: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('../../../lib/utils/network-connectivity', () => ({
  getNetworkErrorMessage: jest.fn((err: any) =>
    err instanceof Error ? err.message : err?.message || 'Network error occurred'
  ),
}));

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    auth: { getSession: jest.fn(), refreshSession: jest.fn() },
    functions: { invoke: jest.fn() },
    from: jest.fn(),
  },
  isSupabaseConfigured: true,
}));

jest.mock('../../../lib/config/app', () => ({ DEEP_LINK_SCHEME: 'bounty-test' }));

// Mutable SDK mock.
const mockSdk: any = {};
jest.mock('../../../lib/services/stripe-sdk', () => ({
  stripeSdk: {
    initialize: jest.fn().mockResolvedValue(undefined),
    getSDK: jest.fn(() => (Object.keys(mockSdk).length > 0 ? mockSdk : null)),
    getPublishableKey: jest.fn(() => 'pk_test_mock'),
    isSDKAvailable: jest.fn(() => Object.keys(mockSdk).length > 0),
    getKeyMode: jest.fn((k: string) => (k.includes('_test_') ? 'test' : 'live')),
    getPublishableKeyMode: jest.fn(() => 'test'),
  },
}));

// payment-error-handler is used by the Secure wrappers.
jest.mock('../../../lib/services/payment-error-handler', () => ({
  checkDuplicatePayment: jest.fn().mockReturnValue(false),
  completePaymentAttempt: jest.fn(),
  generateIdempotencyKey: jest.fn().mockReturnValue('key_123'),
  generateStripeIdempotencyKey: jest.fn().mockReturnValue('stripe_key_123'),
  logPaymentError: jest.fn(),
  parsePaymentError: jest.fn((e: any) => ({ error: e, parsed: true })),
  recordPaymentAttempt: jest.fn(),
  // withPaymentRetry just invokes the fn once in tests to keep them deterministic.
  withPaymentRetry: jest.fn(async (fn: any) => fn()),
}));

import { stripeService } from '../../../lib/services/stripe-service';

const sdkManager = jest.requireMock('../../../lib/services/stripe-sdk').stripeSdk;
const payErr = jest.requireMock('../../../lib/services/payment-error-handler');

function clearSdk() {
  for (const k of Object.keys(mockSdk)) delete mockSdk[k];
}

describe('stripeService: confirmPayment', () => {
  beforeEach(() => {
    clearSdk();
    (global as any).fetch = jest.fn();
    jest.clearAllMocks();
  });

  it('returns succeeded PaymentIntent via native SDK and notifies backend', async () => {
    mockSdk.confirmPayment = jest.fn().mockResolvedValue({
      paymentIntent: {
        id: 'pi_succ',
        amount: 1000,
        currency: 'usd',
        status: 'Succeeded',
      },
      error: null,
    });

    // invokePayments under the hood uses fetch for 'payments/confirm'
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ ok: true }),
      headers: { get: () => null },
    });

    const result = await stripeService.confirmPayment('pi_succ_secret_abc', 'pm_1', 'auth-jwt');
    expect(result.status).toBe('succeeded');
    expect(result.id).toBe('pi_succ');
    expect(mockSdk.confirmPayment).toHaveBeenCalled();
  });

  it('normalizes SDK Canceled errors', async () => {
    mockSdk.confirmPayment = jest.fn().mockResolvedValue({
      paymentIntent: null,
      error: { code: 'Canceled', message: 'user cancelled' },
    });
    await expect(stripeService.confirmPayment('pi_x_secret_a', 'pm_1')).rejects.toMatchObject({
      message: expect.any(String),
    });
  });

  it('normalizes other SDK errors', async () => {
    mockSdk.confirmPayment = jest.fn().mockResolvedValue({
      paymentIntent: null,
      error: { code: 'card_declined', type: 'card_error', message: 'declined' },
    });
    await expect(stripeService.confirmPayment('pi_x_secret_a', 'pm_1')).rejects.toMatchObject({
      message: expect.stringMatching(/declined/i),
    });
  });

  it('throws api_error when SDK returns empty result', async () => {
    mockSdk.confirmPayment = jest.fn().mockResolvedValue({ paymentIntent: null, error: null });
    await expect(stripeService.confirmPayment('pi_x_secret_a', 'pm_1')).rejects.toMatchObject({
      message: expect.any(String),
    });
  });

  it('falls back to simulated success when SDK lacks confirmPayment', async () => {
    // No mockSdk methods → facade takes fallback path and simulates success.
    const result = await stripeService.confirmPayment('pi_fallback_secret_xyz', 'pm_1');
    expect(result.status).toBe('succeeded');
    expect(result.id).toBe('pi_fallback');
  });

  it('invokes handleNextAction flow when SDK returns requires_action', async () => {
    mockSdk.confirmPayment = jest.fn().mockResolvedValue({
      paymentIntent: {
        id: 'pi_3ds',
        amount: 1000,
        currency: 'usd',
        status: 'RequiresAction',
      },
      error: null,
    });
    mockSdk.handleNextAction = jest.fn().mockResolvedValue({
      paymentIntent: { id: 'pi_3ds', amount: 1000, currency: 'usd', status: 'Succeeded' },
      error: null,
    });

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ ok: true }),
      headers: { get: () => null },
    });

    const result = await stripeService.confirmPayment('pi_3ds_secret_a', 'pm_1');
    expect(result.status).toBe('succeeded');
    expect(mockSdk.handleNextAction).toHaveBeenCalled();
  });

  it('does not fail if backend confirm notification throws', async () => {
    mockSdk.confirmPayment = jest.fn().mockResolvedValue({
      paymentIntent: { id: 'pi_s', amount: 100, currency: 'usd', status: 'Succeeded' },
      error: null,
    });
    (global.fetch as jest.Mock).mockRejectedValue(new Error('backend offline'));
    const result = await stripeService.confirmPayment('pi_s_secret_a', 'pm_1');
    expect(result.status).toBe('succeeded');
  });
});

describe('stripeService: presentPaymentSheet', () => {
  beforeEach(() => {
    clearSdk();
    jest.clearAllMocks();
  });

  it('returns not_supported when SDK lacks payment sheet methods', async () => {
    const result = await stripeService.presentPaymentSheet('pi_secret_a');
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('not_supported');
  });

  it('returns init error when initPaymentSheet fails', async () => {
    mockSdk.initPaymentSheet = jest
      .fn()
      .mockResolvedValue({ error: { code: 'init_err', message: 'boom' } });
    mockSdk.presentPaymentSheet = jest.fn();
    const result = await stripeService.presentPaymentSheet('pi_secret_a');
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('init_err');
    expect(mockSdk.presentPaymentSheet).not.toHaveBeenCalled();
  });

  it('returns cancelled error when user cancels', async () => {
    mockSdk.initPaymentSheet = jest.fn().mockResolvedValue({ error: null });
    mockSdk.presentPaymentSheet = jest
      .fn()
      .mockResolvedValue({ error: { code: 'Canceled', message: 'cancel' } });
    const result = await stripeService.presentPaymentSheet('pi_secret_a');
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('canceled');
    expect(result.error?.type).toBe('card_error');
  });

  it('returns other present errors as-is', async () => {
    mockSdk.initPaymentSheet = jest.fn().mockResolvedValue({ error: null });
    mockSdk.presentPaymentSheet = jest.fn().mockResolvedValue({
      error: { code: 'card_declined', type: 'card_error', message: 'declined' },
    });
    const result = await stripeService.presentPaymentSheet('pi_secret_a');
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('card_declined');
  });

  it('returns success when sheet completes cleanly', async () => {
    mockSdk.initPaymentSheet = jest.fn().mockResolvedValue({ error: null });
    mockSdk.presentPaymentSheet = jest.fn().mockResolvedValue({ error: null });
    const result = await stripeService.presentPaymentSheet('pi_secret_a');
    expect(result.success).toBe(true);
  });

  it('returns structured error when thrown', async () => {
    mockSdk.initPaymentSheet = jest.fn().mockImplementation(() => {
      throw new Error('unexpected');
    });
    mockSdk.presentPaymentSheet = jest.fn();
    const result = await stripeService.presentPaymentSheet('pi_secret_a');
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});

describe('stripeService: handleNextAction', () => {
  beforeEach(() => {
    clearSdk();
    jest.clearAllMocks();
  });

  it('rejects when clientSecret is empty', async () => {
    await expect(stripeService.handleNextAction('')).rejects.toBeDefined();
  });

  it('returns simulated succeeded PaymentIntent when SDK lacks handleNextAction', async () => {
    const result = await stripeService.handleNextAction('pi_abc_secret_x');
    expect(result.status).toBe('succeeded');
    expect(result.id).toBe('pi_abc');
  });

  it('returns mapped PaymentIntent on SDK success', async () => {
    mockSdk.handleNextAction = jest.fn().mockResolvedValue({
      paymentIntent: { id: 'pi_1', amount: 500, currency: 'usd', status: 'Succeeded' },
      error: null,
    });
    const result = await stripeService.handleNextAction('pi_1_secret_x');
    expect(result.status).toBe('succeeded');
    expect(result.amount).toBe(500);
  });

  it('throws when SDK returns error', async () => {
    mockSdk.handleNextAction = jest.fn().mockResolvedValue({
      paymentIntent: null,
      error: { code: 'x', message: 'auth failed', type: 'card_error' },
    });
    await expect(stripeService.handleNextAction('pi_1_secret_x')).rejects.toBeInstanceOf(Error);
  });

  it('throws when SDK returns no intent and no error', async () => {
    mockSdk.handleNextAction = jest.fn().mockResolvedValue({
      paymentIntent: null,
      error: null,
    });
    await expect(stripeService.handleNextAction('pi_1_secret_x')).rejects.toBeInstanceOf(Error);
  });
});

describe('stripeService: secure wrappers', () => {
  beforeEach(() => {
    clearSdk();
    (global as any).fetch = jest.fn();
    jest.clearAllMocks();
    payErr.checkDuplicatePayment.mockReturnValue(false);
    payErr.withPaymentRetry.mockImplementation(async (fn: any) => fn());
  });

  it('createPaymentIntentSecure: delegates to createPaymentIntent on success', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ clientSecret: 'pi_a_secret', paymentIntentId: 'pi_a' }),
      headers: { get: () => null },
    });

    const result = await stripeService.createPaymentIntentSecure(10, 'usd', 'auth', {
      userId: 'u1',
    });
    expect(result.id).toBe('pi_a');
    expect(payErr.recordPaymentAttempt).toHaveBeenCalledWith('key_123');
    expect(payErr.completePaymentAttempt).toHaveBeenCalledWith('key_123');
  });

  it('createPaymentIntentSecure: rejects duplicate submissions without network call', async () => {
    payErr.checkDuplicatePayment.mockReturnValueOnce(true);
    await expect(
      stripeService.createPaymentIntentSecure(10, 'usd', 'auth', { userId: 'u1' })
    ).rejects.toMatchObject({ code: 'duplicate_transaction' });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(payErr.recordPaymentAttempt).not.toHaveBeenCalled();
  });

  it('createPaymentIntentSecure: logs error and rethrows on failure', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => JSON.stringify({ error: 'boom' }),
      headers: { get: () => null },
    });

    await expect(stripeService.createPaymentIntentSecure(10, 'usd', 'auth')).rejects.toBeInstanceOf(
      Error
    );

    expect(payErr.logPaymentError).toHaveBeenCalled();
    expect(payErr.completePaymentAttempt).toHaveBeenCalled();
  });

  it('confirmPaymentSecure: delegates to confirmPayment', async () => {
    mockSdk.confirmPayment = jest.fn().mockResolvedValue({
      paymentIntent: { id: 'pi_ok', amount: 100, currency: 'usd', status: 'Succeeded' },
      error: null,
    });
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ ok: true }),
      headers: { get: () => null },
    });

    const result = await stripeService.confirmPaymentSecure('pi_ok_secret_a', 'pm_1', 'auth', {
      userId: 'u1',
    });
    expect(result.status).toBe('succeeded');
  });

  it('confirmPaymentSecure: logs error and rethrows on failure', async () => {
    mockSdk.confirmPayment = jest.fn().mockRejectedValue(new Error('SDK crash'));

    await expect(
      stripeService.confirmPaymentSecure('pi_x_secret_a', 'pm_1', 'auth', { userId: 'u1' })
    ).rejects.toBeInstanceOf(Error);
    expect(payErr.logPaymentError).toHaveBeenCalled();
  });
});

describe('stripeService: parseStripeError', () => {
  it('returns default for null/undefined', () => {
    expect(stripeService.parseStripeError(null)).toMatch(/unknown/i);
  });

  it('classifies TIMEOUT code as service-unavailable', () => {
    expect(stripeService.parseStripeError({ code: 'TIMEOUT', message: 'timed out' })).toMatch(
      /temporarily unavailable/i
    );
  });

  it('classifies network_error timed-out message as service-unavailable', () => {
    expect(stripeService.parseStripeError({ type: 'network_error', message: 'timed out' })).toMatch(
      /temporarily unavailable/i
    );
  });

  it('classifies TimeoutError', () => {
    expect(
      stripeService.parseStripeError(Object.assign(new Error('x'), { name: 'TimeoutError' }))
    ).toMatch(/connection timed out/i);
  });

  it('classifies AbortError', () => {
    expect(
      stripeService.parseStripeError(Object.assign(new Error('x'), { name: 'AbortError' }))
    ).toMatch(/interrupted/i);
  });

  it('classifies NetworkError', () => {
    expect(
      stripeService.parseStripeError(
        Object.assign(new Error('fetch failed'), { name: 'NetworkError' })
      )
    ).toMatch(/unable to connect/i);
  });

  it('detects live-vs-test key mismatch for setupintent', () => {
    expect(
      stripeService.parseStripeError({
        message:
          'No such setupintent: seti_123; a similar object exists in live mode, but a test mode key was used',
      })
    ).toMatch(/different modes/i);
  });

  it('detects test-vs-live key mismatch for paymentintent', () => {
    expect(
      stripeService.parseStripeError({
        message:
          'No such paymentintent: pi_123; a similar object exists in test mode, but a live mode key was used',
      })
    ).toMatch(/different modes/i);
  });

  it('returns original message when nothing matches', () => {
    expect(stripeService.parseStripeError({ message: 'some other error' })).toBe(
      'some other error'
    );
  });
});

describe('stripeService: small utilities', () => {
  beforeEach(() => {
    clearSdk();
    jest.clearAllMocks();
  });

  it('formatCardDisplay formats brand + last4', () => {
    expect(
      stripeService.formatCardDisplay({
        id: 'pm_1',
        type: 'card',
        card: { brand: 'visa', last4: '4242', exp_month: 1, exp_year: 2030 },
        created: 0,
      } as any)
    ).toBe('VISA •••• •••• •••• 4242');
  });

  it('validateCardNumber delegates to Luhn', () => {
    expect(stripeService.validateCardNumber('4242424242424242')).toBe(true);
    expect(stripeService.validateCardNumber('1234')).toBe(false);
  });

  it('getKeyMode / getPublishableKeyMode / isSDKAvailable / getStripeSDK delegate to stripeSdk', () => {
    expect(stripeService.getKeyMode('pk_test_x')).toBe('test');
    expect(stripeService.getPublishableKeyMode()).toBe('test');
    expect(typeof stripeService.isSDKAvailable()).toBe('boolean');
    // getStripeSDK returns whatever mockSdk returns (null when empty).
    expect(stripeService.getStripeSDK()).toBeNull();
    expect(sdkManager.getSDK).toHaveBeenCalled();
  });
});

describe('stripeService: confirmPayment error codes', () => {
  beforeEach(() => {
    clearSdk();
    jest.clearAllMocks();
  });

  it("reports the Stripe code, not the SDK's 'Failed', on payment_failed", async () => {
    const analytics = jest.requireMock('../../../lib/services/analytics-service').analyticsService;
    mockSdk.confirmPayment = jest.fn().mockResolvedValue({
      paymentIntent: null,
      error: {
        code: 'Failed',
        type: 'card_error',
        stripeErrorCode: 'expired_card',
        message: 'Your card has expired.',
      },
    });

    await expect(stripeService.confirmPayment('pi_e_secret_a', 'pm_1')).rejects.toMatchObject({
      code: 'expired_card',
    });

    const failed = analytics.trackEvent.mock.calls.find((c: any[]) => c[0] === 'payment_failed');
    expect(failed[1]).toMatchObject({
      error_code: 'expired_card',
      code: 'expired_card',
      type: 'card_error',
      sdk_code: 'Failed',
      payment_method_type: 'card',
      stage: 'confirm',
    });
  });
});

describe('stripeService: payWithPaymentSheet', () => {
  const analytics = () =>
    jest.requireMock('../../../lib/services/analytics-service').analyticsService;
  const eventsNamed = (name: string) =>
    analytics().trackEvent.mock.calls.filter((c: any[]) => c[0] === name).map((c: any[]) => c[1]);

  const intentResponse = (body: Record<string, unknown>) => ({
    ok: true,
    text: async () => JSON.stringify(body),
    headers: { get: () => null },
  });

  beforeEach(() => {
    clearSdk();
    (global as any).fetch = jest.fn();
    jest.clearAllMocks();
    payErr.checkDuplicatePayment.mockReturnValue(false);
    payErr.withPaymentRetry.mockImplementation(async (fn: any) => fn());
    mockSdk.initPaymentSheet = jest.fn().mockResolvedValue({ error: null });
    mockSdk.presentPaymentSheet = jest.fn().mockResolvedValue({ error: null });
    mockSdk.retrievePaymentIntent = jest
      .fn()
      .mockResolvedValue({ paymentIntent: { lastPaymentError: null } });
  });

  it('asks for an ephemeral key and hands it to the sheet so saved cards are listed', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      intentResponse({
        clientSecret: 'pi_s_secret_x',
        paymentIntentId: 'pi_s',
        customerId: 'cus_1',
        ephemeralKey: 'ek_test_1',
      })
    );

    const result = await stripeService.payWithPaymentSheet(30, { authToken: 'jwt', userId: 'u1' });

    expect(result).toEqual({ outcome: 'succeeded', paymentIntentId: 'pi_s' });
    const sentBody = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(sentBody).toMatchObject({ amountCents: 3000, includeEphemeralKey: true });
    expect(mockSdk.initPaymentSheet).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentIntentClientSecret: 'pi_s_secret_x',
        customerId: 'cus_1',
        customerEphemeralKeySecret: 'ek_test_1',
        allowsDelayedPaymentMethods: false,
        applePay: expect.any(Object),
        googlePay: expect.any(Object),
      })
    );
    expect(eventsNamed('payment_initiated')[0]).toMatchObject({ payment_method_type: 'payment_sheet' });
    expect(eventsNamed('payment_completed')[0]).toMatchObject({
      paymentIntentId: 'pi_s',
      payment_method_type: 'payment_sheet',
    });
  });

  it('still works without an ephemeral key (older server): no customer config', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      intentResponse({ clientSecret: 'pi_o_secret_x', paymentIntentId: 'pi_o' })
    );
    const result = await stripeService.payWithPaymentSheet(30);
    expect(result.outcome).toBe('succeeded');
    const config = mockSdk.initPaymentSheet.mock.calls[0][0];
    expect(config.customerId).toBeUndefined();
    expect(config.customerEphemeralKeySecret).toBeUndefined();
  });

  it('a plain close with no decline is a cancel and emits no payment_failed', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      intentResponse({ clientSecret: 'pi_c_secret_x', paymentIntentId: 'pi_c' })
    );
    mockSdk.presentPaymentSheet.mockResolvedValue({ error: { code: 'Canceled', message: 'x' } });

    const result = await stripeService.payWithPaymentSheet(30);

    expect(result).toEqual({ outcome: 'cancelled', paymentIntentId: 'pi_c' });
    expect(eventsNamed('payment_failed')).toHaveLength(0);
  });

  it('declined inside the sheet then closed = a failure with the real Stripe codes', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      intentResponse({ clientSecret: 'pi_d_secret_x', paymentIntentId: 'pi_d' })
    );
    mockSdk.presentPaymentSheet.mockResolvedValue({ error: { code: 'Canceled', message: 'x' } });
    mockSdk.retrievePaymentIntent.mockResolvedValue({
      paymentIntent: {
        lastPaymentError: {
          code: 'card_declined',
          declineCode: 'insufficient_funds',
          type: 'card_error',
          message: 'Your card has insufficient funds.',
          paymentMethod: { paymentMethodType: 'Card' },
        },
      },
    });

    const result = await stripeService.payWithPaymentSheet(30);

    expect(result.outcome).toBe('failed');
    expect(result.failure).toMatchObject({
      error_code: 'insufficient_funds',
      decline_code: 'insufficient_funds',
      code: 'card_declined',
      type: 'card_error',
      payment_method_type: 'payment_sheet',
      payment_intent_id: 'pi_d',
    });
    expect(eventsNamed('payment_failed')[0]).toMatchObject({
      error_code: 'insufficient_funds',
      stage: 'confirm',
      sheet_closed_after_decline: true,
    });
  });

  it('a hard sheet failure reports its Stripe code', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      intentResponse({ clientSecret: 'pi_f_secret_x', paymentIntentId: 'pi_f' })
    );
    mockSdk.presentPaymentSheet.mockResolvedValue({
      error: { code: 'Failed', stripeErrorCode: 'processing_error', type: 'card_error', message: 'x' },
    });

    const result = await stripeService.payWithPaymentSheet(30);

    expect(result.failure).toMatchObject({ error_code: 'processing_error', sdk_code: 'Failed' });
    expect(eventsNamed('payment_failed')[0]).toMatchObject({ sheet_closed_after_decline: false });
  });

  it('a failure to create the intent is a failure, without opening the sheet', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => JSON.stringify({ error: 'boom', code: 'customer_resolution_failed' }),
      headers: { get: () => null },
    });

    const result = await stripeService.payWithPaymentSheet(30);

    expect(result.outcome).toBe('failed');
    expect(mockSdk.presentPaymentSheet).not.toHaveBeenCalled();
  });
});
