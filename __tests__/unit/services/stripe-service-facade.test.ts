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
