/**
 * Unit tests for lib/services/payment-methods-service.ts
 *
 * Focus: uncovered branches in
 *  - createPaymentMethod (native SDK happy + error paths, fallback validation)
 *  - createSetupIntent (success + error)
 *  - confirmSetupIntent (no-SDK fallback, init error, present error,
 *    cancellation, success)
 *  - detachPaymentMethod (auth required, success)
 *  - attachPaymentMethod (invalid response shapes)
 *
 * listPaymentMethods and basic attach/detach happy paths are already
 * covered by __tests__/unit/services/stripe-service.test.ts via the
 * facade. Here we add the missing branches.
 */

beforeAll(() => {
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
});
afterAll(() => {
  delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
});

jest.mock('../../../lib/config/api', () => ({
  API_BASE_URL: 'https://api.test',
  FINANCIAL_API_BASE_URL: 'https://api.test',
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

jest.mock('../../../lib/services/analytics-service', () => ({
  analyticsService: { trackEvent: jest.fn() },
}));

jest.mock('../../../lib/services/performance-service', () => ({
  performanceService: { startMeasurement: jest.fn(), endMeasurement: jest.fn() },
}));

// Provide a mutable mock SDK so individual tests can flip capabilities on/off.
const mockSdk: {
  createPaymentMethod?: jest.Mock;
  initPaymentSheet?: jest.Mock;
  presentPaymentSheet?: jest.Mock;
} = {};

jest.mock('../../../lib/services/stripe-sdk', () => ({
  stripeSdk: {
    initialize: jest.fn().mockResolvedValue(undefined),
    getSDK: jest.fn(() => (Object.keys(mockSdk).length > 0 ? mockSdk : null)),
    getPublishableKey: jest.fn(() => 'pk_test_xxx'),
  },
}));

// Supabase mock: provide .from(...) for the direct-DB fallback, and
// auth.refreshSession for the 401 retry path.
const mockSupabase = {
  auth: {
    refreshSession: jest.fn(),
  },
  from: jest.fn(),
  functions: {},
};
jest.mock('../../../lib/supabase', () => ({
  supabase: mockSupabase,
  isSupabaseConfigured: true,
}));

jest.mock('../../../lib/config/app', () => ({
  DEEP_LINK_SCHEME: 'bounty-test',
}));

import { paymentMethodsService } from '../../../lib/services/payment-methods-service';

describe('paymentMethodsService.createPaymentMethod', () => {
  beforeEach(() => {
    for (const k of Object.keys(mockSdk)) delete (mockSdk as any)[k];
    jest.clearAllMocks();
  });

  it('uses the native SDK path when available and no manual card fields given', async () => {
    mockSdk.createPaymentMethod = jest.fn().mockResolvedValue({
      paymentMethod: {
        id: 'pm_native',
        Card: { brand: 'visa', last4: '4242', expMonth: 12, expYear: 2026 },
      },
      error: null,
    });

    const result = await paymentMethodsService.createPaymentMethod({
      cardNumber: '',
      expiryDate: '',
      securityCode: '',
      cardholderName: 'Test',
    });

    expect(mockSdk.createPaymentMethod).toHaveBeenCalled();
    expect(result.id).toBe('pm_native');
    expect(result.card.brand).toBe('visa');
    expect(result.card.last4).toBe('4242');
    expect(result.card.exp_month).toBe(12);
    expect(result.card.exp_year).toBe(2026);
  });

  it('propagates native SDK errors as card_error', async () => {
    mockSdk.createPaymentMethod = jest.fn().mockResolvedValue({
      paymentMethod: null,
      error: { code: 'invalid_number', message: 'Your card number is incorrect' },
    });

    await expect(
      paymentMethodsService.createPaymentMethod({
        cardNumber: '',
        expiryDate: '',
        securityCode: '',
        cardholderName: 'Test',
      })
    ).rejects.toMatchObject({
      message: expect.stringMatching(/incorrect|declined/i),
    });
  });

  it('rejects invalid card numbers on the fallback path', async () => {
    await expect(
      paymentMethodsService.createPaymentMethod({
        cardNumber: '1234', // too short + invalid Luhn
        expiryDate: '12/25',
        securityCode: '123',
        cardholderName: 'Test',
      })
    ).rejects.toMatchObject({ message: expect.stringMatching(/invalid/i) });
  });

  it('rejects invalid expiry dates on the fallback path', async () => {
    await expect(
      paymentMethodsService.createPaymentMethod({
        cardNumber: '4242424242424242',
        expiryDate: '13/25', // month > 12
        securityCode: '123',
        cardholderName: 'Test',
      })
    ).rejects.toMatchObject({ message: expect.stringMatching(/invalid|expired/i) });
  });

  it('returns a well-formed payment method on valid fallback input', async () => {
    const result = await paymentMethodsService.createPaymentMethod({
      cardNumber: '4242 4242 4242 4242',
      expiryDate: '12/25',
      securityCode: '123',
      cardholderName: 'Test User',
    });
    expect(result.id).toMatch(/^pm_/);
    expect(result.card.brand).toBe('visa');
    expect(result.card.last4).toBe('4242');
    expect(result.card.exp_month).toBe(12);
    expect(result.card.exp_year).toBe(2025);
  });
});

describe('paymentMethodsService.detachPaymentMethod', () => {
  beforeEach(() => {
    (global as any).fetch = jest.fn();
    jest.clearAllMocks();
  });

  it('throws when no auth token provided', async () => {
    await expect(paymentMethodsService.detachPaymentMethod('pm_1')).rejects.toMatchObject({
      message: expect.stringMatching(/auth/i),
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('sends a DELETE with Authorization header on success', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      text: async () => '',
      headers: { get: () => null },
    });
    await paymentMethodsService.detachPaymentMethod('pm_1', 'auth');
    const [url, opts] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain('/payments/methods/pm_1');
    expect(opts.method).toBe('DELETE');
    expect(opts.headers.Authorization).toBe('Bearer auth');
  });

  it('surfaces api_error on non-ok response', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => JSON.stringify({ error: 'not found' }),
      headers: { get: () => null },
    });
    await expect(
      paymentMethodsService.detachPaymentMethod('pm_missing', 'auth')
    ).rejects.toBeInstanceOf(Error);
  });
});

describe('paymentMethodsService.attachPaymentMethod', () => {
  beforeEach(() => {
    (global as any).fetch = jest.fn();
    jest.clearAllMocks();
  });

  it('throws a structured error when response is not an object', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      text: async () => 'null',
      headers: { get: () => null },
    });

    await expect(paymentMethodsService.attachPaymentMethod('pm_x', 'auth')).rejects.toMatchObject({
      message: expect.stringMatching(/invalid response|failed/i),
    });
  });

  it('throws a structured error when paymentMethod is missing', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ success: true }),
      headers: { get: () => null },
    });
    await expect(paymentMethodsService.attachPaymentMethod('pm_x', 'auth')).rejects.toMatchObject({
      message: expect.stringMatching(/missing payment method|failed/i),
    });
  });

  it('tolerates partial card data in the response', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({
          paymentMethod: { id: 'pm_ok' }, // no card / created fields
        }),
      headers: { get: () => null },
    });
    const result = await paymentMethodsService.attachPaymentMethod('pm_ok', 'auth');
    expect(result.id).toBe('pm_ok');
    expect(result.card.brand).toBe('unknown');
    expect(result.card.last4).toBe('****');
    expect(result.created).toBeGreaterThan(0);
  });
});

describe('paymentMethodsService.createSetupIntent', () => {
  beforeEach(() => {
    (global as any).fetch = jest.fn();
    jest.clearAllMocks();
  });

  it('returns a SetupIntent on success', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({ clientSecret: 'seti_1_secret_x', setupIntentId: 'seti_1' }),
      headers: { get: () => null },
    });

    const result = await paymentMethodsService.createSetupIntent('auth');
    expect(result.id).toBe('seti_1');
    expect(result.client_secret).toBe('seti_1_secret_x');
    expect(result.status).toBe('requires_payment_method');
  });

  it('throws a normalized error on API failure', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => JSON.stringify({ error: 'boom' }),
      headers: { get: () => null },
    });
    await expect(paymentMethodsService.createSetupIntent('auth')).rejects.toBeInstanceOf(Error);
  });
});

describe('paymentMethodsService.confirmSetupIntent', () => {
  beforeEach(() => {
    for (const k of Object.keys(mockSdk)) delete (mockSdk as any)[k];
    jest.clearAllMocks();
  });

  it('returns not_supported when SDK lacks payment sheet methods', async () => {
    // No SDK methods mocked → service treats SDK as unavailable.
    const result = await paymentMethodsService.confirmSetupIntent('seti_1_secret_x');
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('not_supported');
  });

  it('returns init error when initPaymentSheet fails', async () => {
    mockSdk.initPaymentSheet = jest
      .fn()
      .mockResolvedValue({ error: { code: 'init_failed', message: 'init boom' } });
    mockSdk.presentPaymentSheet = jest.fn();

    const result = await paymentMethodsService.confirmSetupIntent('seti_1_secret_x');
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('init_failed');
    expect(mockSdk.presentPaymentSheet).not.toHaveBeenCalled();
  });

  it('returns cancelled error when user cancels the sheet', async () => {
    mockSdk.initPaymentSheet = jest.fn().mockResolvedValue({ error: null });
    mockSdk.presentPaymentSheet = jest
      .fn()
      .mockResolvedValue({ error: { code: 'Canceled', message: 'user cancelled' } });

    const result = await paymentMethodsService.confirmSetupIntent('seti_1_secret_x');
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('canceled');
    expect(result.error?.type).toBe('card_error');
  });

  it('returns presentation error when sheet fails for other reasons', async () => {
    mockSdk.initPaymentSheet = jest.fn().mockResolvedValue({ error: null });
    mockSdk.presentPaymentSheet = jest.fn().mockResolvedValue({
      error: { code: 'card_declined', type: 'card_error', message: 'declined' },
    });

    const result = await paymentMethodsService.confirmSetupIntent('seti_1_secret_x');
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('card_declined');
  });

  it('returns success when sheet completes cleanly', async () => {
    mockSdk.initPaymentSheet = jest.fn().mockResolvedValue({ error: null });
    mockSdk.presentPaymentSheet = jest.fn().mockResolvedValue({ error: null });

    const result = await paymentMethodsService.confirmSetupIntent('seti_1_secret_x');
    expect(result.success).toBe(true);
  });

  it('returns a structured error when SDK throws', async () => {
    mockSdk.initPaymentSheet = jest.fn().mockImplementation(() => {
      throw new Error('unexpected');
    });
    mockSdk.presentPaymentSheet = jest.fn();

    const result = await paymentMethodsService.confirmSetupIntent('seti_1_secret_x');
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});

describe('paymentMethodsService.listPaymentMethods: direct DB fallback', () => {
  beforeEach(() => {
    (global as any).fetch = jest.fn();
    jest.clearAllMocks();
  });

  it('returns [] when no auth token is provided', async () => {
    const result = await paymentMethodsService.listPaymentMethods();
    expect(result).toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('falls back to direct DB query when Edge Function returns 500', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => JSON.stringify({ error: 'boom' }),
      headers: { get: () => null },
    });

    // Build a chainable Supabase query builder.
    const chain = {
      select: jest.fn().mockReturnThis(),
      order: jest.fn().mockResolvedValue({
        data: [
          {
            stripe_payment_method_id: 'pm_db_1',
            type: 'card',
            card_brand: 'visa',
            card_last4: '4242',
            card_exp_month: 12,
            card_exp_year: 2030,
            created_at: '2024-01-01T00:00:00Z',
          },
        ],
        error: null,
      }),
    };
    mockSupabase.from.mockReturnValue(chain);

    const methods = await paymentMethodsService.listPaymentMethods('auth');
    expect(methods).toHaveLength(1);
    expect(methods[0].id).toBe('pm_db_1');
    expect(methods[0].card.last4).toBe('4242');
  });

  it('rethrows handled error when DB fallback also fails', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ error: 'bad' }),
      headers: { get: () => null },
    });
    mockSupabase.auth.refreshSession.mockResolvedValue({
      data: { session: null },
      error: null,
    });
    const chain = {
      select: jest.fn().mockReturnThis(),
      order: jest.fn().mockResolvedValue({ data: null, error: new Error('db down') }),
    };
    mockSupabase.from.mockReturnValue(chain);

    await expect(paymentMethodsService.listPaymentMethods('auth')).rejects.toBeInstanceOf(Error);
  });
});
