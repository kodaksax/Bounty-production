/**
 * Additional tests for stripe-service.ts Apple Pay methods to lift patch coverage.
 */

beforeAll(() => {
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
  process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_test_mock';
});

jest.mock('../../../lib/services/analytics-service', () => ({
  analyticsService: { trackEvent: jest.fn(), incrementUserProperty: jest.fn() },
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

const mockSdk: any = {};
jest.mock('../../../lib/services/stripe-sdk', () => ({
  stripeSdk: {
    initialize: jest.fn().mockResolvedValue(undefined),
    getSDK: jest.fn(() => (Object.keys(mockSdk).length > 0 ? mockSdk : null)),
    getPublishableKey: jest.fn(() => 'pk_test_mock'),
    isSDKAvailable: jest.fn(() => Object.keys(mockSdk).length > 0),
    getKeyMode: jest.fn(() => 'test'),
    getPublishableKeyMode: jest.fn(() => 'test'),
  },
}));

// Provide a real-ish react-native mock with an adjustable Platform.OS.
jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}));

jest.mock('../../../lib/services/payment-error-handler', () => ({
  checkDuplicatePayment: jest.fn().mockReturnValue(false),
  completePaymentAttempt: jest.fn(),
  generateIdempotencyKey: jest.fn().mockReturnValue('k'),
  logPaymentError: jest.fn(),
  parsePaymentError: jest.fn((e: any) => ({ error: e })),
  recordPaymentAttempt: jest.fn(),
  withPaymentRetry: jest.fn(async (fn: any) => fn()),
}));

import { stripeService } from '../../../lib/services/stripe-service';

const RN = jest.requireMock('react-native');

function clearSdk() {
  for (const k of Object.keys(mockSdk)) delete mockSdk[k];
}

describe('stripeService.isApplePaySupported', () => {
  beforeEach(() => {
    clearSdk();
    jest.clearAllMocks();
  });

  it('returns false when SDK unavailable', async () => {
    await expect(stripeService.isApplePaySupported()).resolves.toBe(false);
  });

  it('returns true when SDK reports supported', async () => {
    mockSdk.isApplePaySupported = jest.fn().mockResolvedValue(true);
    await expect(stripeService.isApplePaySupported()).resolves.toBe(true);
  });

  it('uses nested ApplePay.isApplePaySupported fallback', async () => {
    mockSdk.ApplePay = { isApplePaySupported: jest.fn().mockResolvedValue(true) };
    await expect(stripeService.isApplePaySupported()).resolves.toBe(true);
  });

  it('returns false when no supported function on SDK', async () => {
    mockSdk.somethingElse = () => {};
    await expect(stripeService.isApplePaySupported()).resolves.toBe(false);
  });

  it('returns false when SDK throws', async () => {
    mockSdk.isApplePaySupported = jest.fn().mockImplementation(() => {
      throw new Error('boom');
    });
    await expect(stripeService.isApplePaySupported()).resolves.toBe(false);
  });
});

describe('stripeService.presentApplePay', () => {
  beforeEach(() => {
    clearSdk();
    RN.Platform.OS = 'ios';
    jest.clearAllMocks();
  });

  it('returns platform_not_supported on Android', async () => {
    RN.Platform.OS = 'android';
    const r = await stripeService.presentApplePay(5);
    expect(r.success).toBe(false);
    expect(r.errorCode).toBe('platform_not_supported');
  });

  it('returns invalid_amount when below $0.50', async () => {
    const r = await stripeService.presentApplePay(0.25);
    expect(r.success).toBe(false);
    expect(r.errorCode).toBe('invalid_amount');
  });

  it('returns amount_mismatch when cart total differs from amount', async () => {
    const r = await stripeService.presentApplePay(10, 'desc', [
      { label: 'x', amount: '5.00', type: 'final' },
    ]);
    expect(r.success).toBe(false);
    expect(r.errorCode).toBe('amount_mismatch');
  });

  it('returns sdk_unavailable when no SDK', async () => {
    const r = await stripeService.presentApplePay(10);
    expect(r.success).toBe(false);
    expect(r.errorCode).toBe('sdk_unavailable');
  });

  it('returns apple_pay_unavailable when SDK lacks presentApplePay', async () => {
    mockSdk.noop = true;
    const r = await stripeService.presentApplePay(10);
    expect(r.success).toBe(false);
    expect(r.errorCode).toBe('apple_pay_unavailable');
  });

  it('returns cancelled when user cancels', async () => {
    mockSdk.presentApplePay = jest
      .fn()
      .mockResolvedValue({ error: { code: 'Canceled', message: 'cancel' } });
    const r = await stripeService.presentApplePay(10);
    expect(r.success).toBe(false);
    expect(r.errorCode).toBe('cancelled');
  });

  it('returns error code passthrough on other failures', async () => {
    mockSdk.presentApplePay = jest
      .fn()
      .mockResolvedValue({ error: { code: 'apple_pay_failed', message: 'boom' } });
    const r = await stripeService.presentApplePay(10);
    expect(r.success).toBe(false);
    expect(r.errorCode).toBe('apple_pay_failed');
  });

  it('returns success on clean present', async () => {
    mockSdk.presentApplePay = jest.fn().mockResolvedValue({ error: null });
    const r = await stripeService.presentApplePay(10);
    expect(r.success).toBe(true);
  });

  it('returns unknown_error when SDK call throws', async () => {
    mockSdk.presentApplePay = jest.fn().mockImplementation(() => {
      throw new Error('crash');
    });
    const r = await stripeService.presentApplePay(10);
    expect(r.success).toBe(false);
    expect(r.errorCode).toBe('unknown_error');
  });

  it('uses nested ApplePay.presentApplePay when top-level missing', async () => {
    mockSdk.ApplePay = {
      presentApplePay: jest.fn().mockResolvedValue({ error: null }),
    };
    const r = await stripeService.presentApplePay(10);
    expect(r.success).toBe(true);
    expect(mockSdk.ApplePay.presentApplePay).toHaveBeenCalled();
  });
});
