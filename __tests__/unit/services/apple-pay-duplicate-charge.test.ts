/**
 * Regression tests for the Apple Pay double-charge defect.
 *
 * Two guarantees are covered:
 *  1. Re-taps of the same deposit inside the idempotency window send the SAME
 *     idempotency key, so Stripe returns one PaymentIntent instead of charging
 *     twice.
 *  2. A non-cancel confirm error is treated as indeterminate: the service polls
 *     the intent status and reports success when the charge already went
 *     through, instead of inviting a duplicate charge.
 */

const mockConfirmPlatformPayPayment = jest.fn();

jest.mock('@stripe/stripe-react-native', () => ({
  confirmPlatformPayPayment: (...args: unknown[]) => mockConfirmPlatformPayPayment(...args),
  isPlatformPaySupported: jest.fn().mockResolvedValue(true),
  PlatformPay: {
    PaymentType: { Immediate: 'Immediate' },
    ContactField: { PostalAddress: 'PostalAddress' },
  },
  PlatformPayError: { Canceled: 'Canceled' },
}));

jest.mock('lib/config/api', () => ({ API_BASE_URL: 'https://api.example.com' }));

jest.mock('lib/services/analytics-service', () => ({
  analyticsService: { trackEvent: jest.fn().mockResolvedValue(undefined) },
}));

jest.mock('lib/services/stripe-sdk', () => ({
  stripeSdk: {
    initialize: jest.fn().mockResolvedValue(undefined),
    isSDKAvailable: jest.fn(() => true),
    getApplePayInitError: jest.fn(() => undefined),
  },
}));

const mockGetSession = jest.fn();
jest.mock('lib/supabase', () => ({
  supabase: { auth: { getSession: (...args: unknown[]) => mockGetSession(...args) } },
}));

jest.mock('lib/utils/error-logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), warning: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
jest.mock('expo-constants', () => ({ nativeAppVersion: '1.0.0', expoConfig: { version: '1.0.0' } }));

import { applePayService } from 'lib/services/apple-pay-service';

const USER_ID = 'user-123';

function paymentIntentBody(id: string) {
  return { clientSecret: `${id}_secret`, paymentIntentId: id };
}

describe('ApplePayService duplicate-charge guards', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: 'tok', user: { id: USER_ID } } },
    });
    fetchMock = jest.fn();
    (global as any).fetch = fetchMock;
  });

  afterEach(() => {
    (Date.now as jest.Mock).mockRestore?.();
  });

  function jsonResponse(body: unknown) {
    return { ok: true, json: async () => body } as Response;
  }

  it('reuses one idempotency key for re-taps of the same deposit in the window', async () => {
    const sentKeys: string[] = [];
    fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      if (url.endsWith('/payment-intent')) {
        sentKeys.push(body.idempotencyKey);
        return jsonResponse(paymentIntentBody('pi_1'));
      }
      // Backend confirm reports the charge succeeded.
      return jsonResponse({ success: true, status: 'succeeded' });
    });
    mockConfirmPlatformPayPayment.mockResolvedValue({ error: null });

    await applePayService.processPayment({ amount: 1, description: 'Add Money to Wallet' }, 'tok');
    await applePayService.processPayment({ amount: 1, description: 'Add Money to Wallet' }, 'tok');

    expect(sentKeys).toHaveLength(2);
    expect(sentKeys[0]).toBe(sentKeys[1]);
    expect(sentKeys[0]).toContain(USER_ID);
    expect(sentKeys[0]).not.toContain(String(Date.now()));
  });

  it('reports success when a non-cancel confirm error hides an already-succeeded charge', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/payment-intent')) {
        return jsonResponse(paymentIntentBody('pi_2'));
      }
      // Status poll: the charge actually went through.
      return jsonResponse({ success: true, status: 'succeeded' });
    });
    // Native confirm rejects because the reused intent is already succeeded.
    mockConfirmPlatformPayPayment.mockResolvedValue({
      error: { code: 'Failed', message: 'PaymentIntent already succeeded' },
    });

    const result = await applePayService.processPayment(
      { amount: 1, description: 'Add Money to Wallet' },
      'tok'
    );

    expect(result.success).toBe(true);
    expect(result.paymentIntentId).toBe('pi_2');
  });

  it('reports failure when a confirm error reflects a terminally failed intent', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/payment-intent')) {
        return jsonResponse(paymentIntentBody('pi_3'));
      }
      // Status poll: the charge will never complete.
      return jsonResponse({ success: false, status: 'requires_payment_method' });
    });
    mockConfirmPlatformPayPayment.mockResolvedValue({
      error: { code: 'Failed', message: 'card declined' },
    });

    const result = await applePayService.processPayment(
      { amount: 1, description: 'Add Money to Wallet' },
      'tok'
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe('card declined');
  });

  it('does not report cancellation as a failure', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(paymentIntentBody('pi_4')));
    mockConfirmPlatformPayPayment.mockResolvedValue({
      error: { code: 'Canceled', message: 'user cancelled' },
    });

    const result = await applePayService.processPayment(
      { amount: 1, description: 'Add Money to Wallet' },
      'tok'
    );

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('cancelled');
  });
});
