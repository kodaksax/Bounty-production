/**
 * Unit tests for lib/services/stripe-internal.ts
 *
 * Covers:
 *  - Pure helpers: detectCardBrand, validateCardNumber, mapPaymentIntentStatus
 *  - Error normalization: handleStripeError (all branches)
 *  - Edge-function plumbing: fetchEdgeFunction, invokePayments (anon-key path,
 *    functions.invoke fallback, no-auth last-resort)
 *  - getSupabaseAnonKey env resolution order
 */

// ---- Mocks ----------------------------------------------------------------
jest.mock('../../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn(),
    },
    functions: {
      invoke: jest.fn(),
    },
  },
  isSupabaseConfigured: true,
}));

jest.mock('../../../lib/utils/network-connectivity', () => ({
  getNetworkErrorMessage: jest.fn((err: any) => {
    if (err instanceof Error) return err.message;
    if (err && typeof err === 'object' && err.message) return err.message;
    return 'Network error occurred';
  }),
}));

// Silence logger in the extracted module.
jest.mock('../../../lib/utils/error-logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    warning: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// Short timeouts keep the test fast when we intentionally trigger the
// AbortController path inside fetchEdgeFunction.
jest.mock('../../../lib/config/network', () => ({
  API_TIMEOUTS: { DEFAULT: 1000 },
}));

// Provide a stable FINANCIAL_API_BASE_URL so assertions are deterministic.
jest.mock('../../../lib/config/api', () => ({
  FINANCIAL_API_BASE_URL: 'https://example.test/functions/v1',
  API_BASE_URL: 'https://example.test',
}));

import {
    detectCardBrand,
    fetchEdgeFunction,
    getSupabaseAnonKey,
    handleStripeError,
    invokePayments,
    mapPaymentIntentStatus,
    validateCardNumber,
} from '../../../lib/services/stripe-internal';

const { supabase } = jest.requireMock('../../../lib/supabase');

// ---- Test suite -----------------------------------------------------------
describe('stripe-internal: pure helpers', () => {
  describe('detectCardBrand', () => {
    it.each([
      ['4242424242424242', 'visa'],
      ['5555555555554444', 'mastercard'],
      ['2221000000000009', 'mastercard'],
      ['378282246310005', 'amex'],
      ['6011111111111117', 'discover'],
      ['0000000000000000', 'unknown'],
      ['1234567812345678', 'unknown'],
    ])('maps %s -> %s', (num, brand) => {
      expect(detectCardBrand(num)).toBe(brand);
    });

    it('ignores whitespace in card number', () => {
      expect(detectCardBrand('4242 4242 4242 4242')).toBe('visa');
    });
  });

  describe('validateCardNumber', () => {
    it('accepts a valid Luhn card number', () => {
      expect(validateCardNumber('4242424242424242')).toBe(true);
    });
    it('accepts numbers with spaces', () => {
      expect(validateCardNumber('4242 4242 4242 4242')).toBe(true);
    });
    it('rejects a card number that fails Luhn', () => {
      expect(validateCardNumber('4242424242424241')).toBe(false);
    });
    it('rejects numbers that are too short', () => {
      expect(validateCardNumber('4242424')).toBe(false);
    });
    it('rejects numbers that are too long', () => {
      expect(validateCardNumber('4'.repeat(20))).toBe(false);
    });
  });

  describe('mapPaymentIntentStatus', () => {
    it('maps SDK PascalCase statuses', () => {
      expect(mapPaymentIntentStatus('Succeeded')).toBe('succeeded');
      expect(mapPaymentIntentStatus('RequiresAction')).toBe('requires_action');
      expect(mapPaymentIntentStatus('Canceled')).toBe('canceled');
    });
    it('passes through snake_case statuses', () => {
      expect(mapPaymentIntentStatus('processing')).toBe('processing');
      expect(mapPaymentIntentStatus('requires_capture')).toBe('requires_capture');
    });
    it('defaults unknown statuses to requires_payment_method', () => {
      expect(mapPaymentIntentStatus('SomethingWeird')).toBe('requires_payment_method');
      expect(mapPaymentIntentStatus('')).toBe('requires_payment_method');
    });
  });
});

describe('stripe-internal: handleStripeError', () => {
  it('normalizes known card decline codes to friendly messages', () => {
    const err = handleStripeError({
      type: 'card_error',
      code: 'insufficient_funds',
      decline_code: 'insufficient_funds',
    });
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/insufficient funds/i);
    expect(err.type).toBe('card_error');
    expect(err.code).toBe('insufficient_funds');
    expect(err.decline_code).toBe('insufficient_funds');
  });

  it('handles decline_code without type card_error', () => {
    const err = handleStripeError({ decline_code: 'lost_card' });
    expect(err.message).toMatch(/lost/i);
    expect(err.type).toBe('card_error');
  });

  it('falls back to original message for unknown decline codes', () => {
    const err = handleStripeError({
      type: 'card_error',
      code: 'some_unknown_code',
      message: 'Custom message from API',
    });
    expect(err.message).toBe('Custom message from API');
  });

  it('produces a default card message when no message is provided', () => {
    const err = handleStripeError({ type: 'card_error', code: 'some_new_code' });
    expect(err.message).toMatch(/declined/i);
  });

  it('normalizes validation_error', () => {
    const err = handleStripeError({ type: 'validation_error', message: 'bad' });
    expect(err.message).toMatch(/invalid payment information/i);
    expect(err.type).toBe('validation_error');
  });

  it('normalizes StripeValidationError synonym', () => {
    const err = handleStripeError({ type: 'StripeValidationError' });
    expect(err.type).toBe('validation_error');
  });

  it('preserves api_error custom message when not the default', () => {
    const err = handleStripeError({
      type: 'api_error',
      code: '405',
      message: 'Payment methods request failed (405): Method not allowed',
    });
    expect(err.message).toMatch(/405/);
    expect(err.type).toBe('api_error');
    expect(err.code).toBe('405');
  });

  it('uses default api_error message when none provided', () => {
    const err = handleStripeError({ type: 'api_error' });
    expect(err.message).toMatch(/temporarily unavailable/i);
  });

  it('normalizes rate_limit_error', () => {
    const err = handleStripeError({ type: 'rate_limit_error' });
    expect(err.message).toMatch(/too many requests/i);
    expect(err.type).toBe('rate_limit_error');
  });

  it('normalizes authentication_error', () => {
    const err = handleStripeError({ type: 'authentication_error' });
    expect(err.message).toMatch(/authentication/i);
    expect(err.type).toBe('authentication_error');
  });

  it('preserves structured network_error with code', () => {
    const err = handleStripeError({
      type: 'network_error',
      code: 'TIMEOUT',
      message: 'Request timed out after 5000ms',
    });
    expect(err.message).toMatch(/timed out/i);
    expect(err.type).toBe('network_error');
    expect(err.code).toBe('TIMEOUT');
  });

  it('heuristically classifies unstructured network errors by message', () => {
    const err = handleStripeError(new Error('fetch failed: network is down'));
    expect(err.type).toBe('network_error');
  });

  it('preserves unknown `type` values unchanged', () => {
    const err = handleStripeError({
      type: 'idempotency_error',
      code: 'duplicate_transaction',
      message: 'dup',
    });
    expect(err.type).toBe('idempotency_error');
    expect(err.code).toBe('duplicate_transaction');
    expect(err.message).toBe('dup');
  });

  it('falls back to generic message for plain errors', () => {
    const err = handleStripeError(new Error('something broke'));
    expect(err.message).toBe('something broke');
  });

  it('falls back to default message when error is falsy', () => {
    const err = handleStripeError(undefined);
    expect(err.message).toMatch(/payment processing failed/i);
  });
});

describe('stripe-internal: getSupabaseAnonKey', () => {
  const originalEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('prefers EXPO_PUBLIC_SUPABASE_ANON_KEY', () => {
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'expo-key  ';
    process.env.SUPABASE_ANON_KEY = 'server-key';
    expect(getSupabaseAnonKey()).toBe('expo-key');
  });

  it('falls back to SUPABASE_ANON_KEY', () => {
    delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
    process.env.SUPABASE_ANON_KEY = 'server-key';
    expect(getSupabaseAnonKey()).toBe('server-key');
  });

  it('returns empty string when no key configured', () => {
    delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.SUPABASE_ANON_KEY;
    expect(getSupabaseAnonKey()).toBe('');
  });
});

describe('stripe-internal: fetchEdgeFunction', () => {
  beforeEach(() => {
    (global as any).fetch = jest.fn();
  });

  it('returns parsed JSON body on success', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ hello: 'world' }),
      headers: { get: () => null },
    });

    const result = await fetchEdgeFunction<{ hello: string }>(
      'https://x.test/foo',
      'POST',
      {},
      { a: 1 }
    );
    expect(result).toEqual({ hello: 'world' });
    expect((global.fetch as jest.Mock).mock.calls[0][1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ a: 1 }),
    });
  });

  it('returns null body when response is empty', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      text: async () => '',
      headers: { get: () => null },
    });
    const result = await fetchEdgeFunction<unknown>('https://x.test/foo', 'GET', {}, undefined);
    expect(result).toBeNull();
  });

  it('throws structured api_error on non-ok response with JSON body', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ error: 'Invalid JWT' }),
      headers: { get: () => null },
    });

    await expect(fetchEdgeFunction('https://x.test/foo', 'POST', {}, {})).rejects.toMatchObject({
      type: 'api_error',
      code: '401',
      message: expect.stringMatching(/401.*Invalid JWT/i),
    });
  });

  it('throws structured api_error using raw text when body is non-JSON', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Internal error',
      headers: { get: () => null },
    });

    await expect(fetchEdgeFunction('https://x.test/foo', 'POST', {}, {})).rejects.toMatchObject({
      type: 'api_error',
      code: '500',
    });
  });

  it('throws network_error for malformed fetch responses', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true }); // missing .text()

    await expect(
      fetchEdgeFunction('https://x.test/foo', 'POST', {}, undefined)
    ).rejects.toMatchObject({ type: 'network_error', code: 'NETWORK_ERROR' });
  });

  it('wraps raw fetch failures into network_error', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('DNS resolution failed'));

    await expect(
      fetchEdgeFunction('https://x.test/foo', 'GET', {}, undefined)
    ).rejects.toMatchObject({ type: 'network_error', code: 'NETWORK_ERROR' });
  });

  it('re-throws structured errors untouched (no re-wrapping)', async () => {
    const structured = { type: 'network_error', code: 'X', message: 'raw' };
    (global.fetch as jest.Mock).mockRejectedValue(structured);
    await expect(fetchEdgeFunction('https://x.test/foo', 'GET', {}, undefined)).rejects.toEqual(
      structured
    );
  });

  it('warns on X-Deprecated header but still returns body', async () => {
    const headers = { get: jest.fn((h: string) => (h === 'X-Deprecated' ? 'true' : null)) };
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ ok: true }),
      headers,
    });
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await fetchEdgeFunction<{ ok: boolean }>(
      'https://x.test/foo',
      'GET',
      {},
      undefined
    );
    expect(result).toEqual({ ok: true });
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe('stripe-internal: invokePayments', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    (global as any).fetch = jest.fn();
    process.env = { ...originalEnv };
    jest.clearAllMocks();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('uses direct fetch with anon key + caller accessToken when available', async () => {
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ ok: true }),
      headers: { get: () => null },
    });

    const result = await invokePayments<{ ok: boolean }>('payments/foo', {
      accessToken: 'caller-jwt',
      body: { a: 1 },
    });

    expect(result).toEqual({ ok: true });
    expect(global.fetch).toHaveBeenCalledWith(
      'https://example.test/functions/v1/payments/foo',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          apikey: 'anon-key',
          Authorization: 'Bearer caller-jwt',
        }),
      })
    );
    // No session fetch when caller provides a token.
    expect(supabase.auth.getSession).not.toHaveBeenCalled();
  });

  it('obtains a token from supabase.auth.getSession when accessToken not given', async () => {
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';

    (supabase.auth.getSession as jest.Mock).mockResolvedValue({
      data: { session: { access_token: 'session-jwt' } },
      error: null,
    });

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ ok: true }),
      headers: { get: () => null },
    });

    await invokePayments('payments/bar', { body: {} });

    const callHeaders = (global.fetch as jest.Mock).mock.calls[0][1].headers;
    expect(callHeaders.Authorization).toBe('Bearer session-jwt');
    expect(callHeaders.apikey).toBe('anon-key');
  });

  it('proceeds without Authorization when getSession returns no session', async () => {
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';

    (supabase.auth.getSession as jest.Mock).mockResolvedValue({
      data: { session: null },
      error: null,
    });

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ ok: true }),
      headers: { get: () => null },
    });

    await invokePayments('payments/no-token', { body: {} });
    const callHeaders = (global.fetch as jest.Mock).mock.calls[0][1].headers;
    expect(callHeaders.Authorization).toBeUndefined();
    expect(callHeaders.apikey).toBe('anon-key');
  });

  it('proceeds without token when getSession throws', async () => {
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';

    (supabase.auth.getSession as jest.Mock).mockRejectedValue(new Error('boom'));
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ ok: true }),
      headers: { get: () => null },
    });

    const result = await invokePayments<{ ok: boolean }>('payments/err', { body: {} });
    expect(result).toEqual({ ok: true });
  });

  it('falls back to supabase.functions.invoke when no anon key is configured', async () => {
    delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.SUPABASE_ANON_KEY;

    (supabase.functions.invoke as jest.Mock).mockResolvedValue({
      data: { result: 'ok' },
      error: null,
    });

    const result = await invokePayments<{ result: string }>('payments/baz', {
      body: { x: 1 },
      accessToken: 'tok',
    });

    expect(result).toEqual({ result: 'ok' });
    expect(supabase.functions.invoke).toHaveBeenCalledWith(
      'payments/baz',
      expect.objectContaining({
        method: 'POST',
        body: { x: 1 },
        headers: expect.objectContaining({ Authorization: 'Bearer tok' }),
      })
    );
  });

  it('surfaces error from supabase.functions.invoke as api_error', async () => {
    delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.SUPABASE_ANON_KEY;

    const fakeErr: any = new Error('boom');
    fakeErr.context = {
      status: 500,
      json: async () => ({ error: 'internal' }),
    };

    (supabase.functions.invoke as jest.Mock).mockResolvedValue({
      data: null,
      error: fakeErr,
    });

    await expect(invokePayments('payments/fail', {})).rejects.toMatchObject({
      type: 'api_error',
      code: '500',
      message: expect.stringMatching(/500.*internal/i),
    });
  });

  it('last-resort unauthenticated fetch when no anon key and no functions.invoke', async () => {
    delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.SUPABASE_ANON_KEY;

    // Temporarily drop functions
    const originalFunctions = supabase.functions;
    (supabase as any).functions = undefined;

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ x: 42 }),
      headers: { get: () => null },
    });

    try {
      const result = await invokePayments<{ x: number }>('payments/last-resort', {});
      expect(result).toEqual({ x: 42 });
      const callHeaders = (global.fetch as jest.Mock).mock.calls[0][1].headers;
      expect(callHeaders.Authorization).toBeUndefined();
      expect(callHeaders.apikey).toBeUndefined();
    } finally {
      (supabase as any).functions = originalFunctions;
    }
  });
});
