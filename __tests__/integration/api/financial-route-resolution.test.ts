/**
 * Integration tests: financial route URL resolution
 *
 * Asserts that when EXPO_PUBLIC_SUPABASE_FUNCTIONS_URL is set, all financial
 * requests (/wallet/* and /payments/*) resolve to the Supabase Edge Function
 * base URL and never fall back to the legacy Express/Fastify server.
 *
 * Tests ALSO verify that when neither Supabase variable is configured the
 * generic API_BASE_URL is used as a local-dev fallback.
 */

const EDGE_FUNCTIONS_URL = 'https://abcxyz.supabase.co/functions/v1';
const SUPABASE_URL = 'https://abcxyz.supabase.co';
const LEGACY_API_URL = 'http://localhost:3001';

// Helpers to isolate module-level constant evaluation across tests.
function isolatedRequire(envOverrides: Record<string, string | undefined>) {
  // Apply env overrides before importing the module.
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(envOverrides)) {
    saved[k] = process.env[k];
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }

  jest.resetModules();

  // Stub Constants so fromExtra() returns empty strings (module is not in
  // an Expo build context during unit tests).
  jest.mock('expo-constants', () => ({
    __esModule: true,
    default: { expoConfig: { extra: {} } },
  }));

  // Stub network helper to avoid real network probes in tests.
  jest.mock('lib/utils/network', () => ({
    getReachableApiBaseUrl: (_preferred: string, _port: number) =>
      _preferred || `http://localhost:${_port}`,
  }));

  // Stub dev-host helper so getApiBaseFallback returns null.
  jest.mock('lib/utils/dev-host', () => ({ __esModule: true, default: () => null }));

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const api = require('lib/config/api');

  // Restore env.
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }

  return api as {
    getApiBaseUrl: () => string;
    getFinancialApiUrl: () => string;
    API_BASE_URL: string;
    FINANCIAL_API_BASE_URL: string;
  };
}

describe('Financial route URL resolution', () => {
  describe('when EXPO_PUBLIC_SUPABASE_FUNCTIONS_URL is set', () => {
    let api: ReturnType<typeof isolatedRequire>;

    beforeAll(() => {
      api = isolatedRequire({
        EXPO_PUBLIC_SUPABASE_FUNCTIONS_URL: EDGE_FUNCTIONS_URL,
        EXPO_PUBLIC_SUPABASE_URL: undefined,
        EXPO_PUBLIC_API_BASE_URL: LEGACY_API_URL,
        EXPO_PUBLIC_API_URL: undefined,
        API_BASE_URL: undefined,
      });
    });

    it('getFinancialApiUrl() returns the Edge Function URL', () => {
      expect(api.getFinancialApiUrl()).toBe(EDGE_FUNCTIONS_URL);
    });

    it('FINANCIAL_API_BASE_URL constant equals the Edge Function URL', () => {
      expect(api.FINANCIAL_API_BASE_URL).toBe(EDGE_FUNCTIONS_URL);
    });

    it('getApiBaseUrl() also returns the Edge Function URL (Supabase takes priority)', () => {
      expect(api.getApiBaseUrl()).toBe(EDGE_FUNCTIONS_URL);
    });

    it('wallet/balance path resolves under the Edge Function URL', () => {
      const balanceUrl = `${api.FINANCIAL_API_BASE_URL}/wallet/balance`;
      expect(balanceUrl.startsWith(EDGE_FUNCTIONS_URL)).toBe(true);
      expect(balanceUrl).not.toContain('localhost');
      expect(balanceUrl).not.toContain('3001');
    });

    it('wallet/transactions path resolves under the Edge Function URL', () => {
      const txUrl = `${api.FINANCIAL_API_BASE_URL}/wallet/transactions`;
      expect(txUrl.startsWith(EDGE_FUNCTIONS_URL)).toBe(true);
    });

    it('payments/create-payment-intent path resolves under the Edge Function URL', () => {
      const url = `${api.FINANCIAL_API_BASE_URL}/payments/create-payment-intent`;
      expect(url.startsWith(EDGE_FUNCTIONS_URL)).toBe(true);
    });

    it('payments/methods path resolves under the Edge Function URL', () => {
      const url = `${api.FINANCIAL_API_BASE_URL}/payments/methods`;
      expect(url.startsWith(EDGE_FUNCTIONS_URL)).toBe(true);
    });

    it('payments/confirm path resolves under the Edge Function URL', () => {
      const url = `${api.FINANCIAL_API_BASE_URL}/payments/confirm`;
      expect(url.startsWith(EDGE_FUNCTIONS_URL)).toBe(true);
    });
  });

  describe('when only EXPO_PUBLIC_SUPABASE_URL is set (derived functions URL)', () => {
    let api: ReturnType<typeof isolatedRequire>;

    beforeAll(() => {
      api = isolatedRequire({
        EXPO_PUBLIC_SUPABASE_FUNCTIONS_URL: undefined,
        EXPO_PUBLIC_SUPABASE_URL: SUPABASE_URL,
        EXPO_PUBLIC_API_BASE_URL: LEGACY_API_URL,
        EXPO_PUBLIC_API_URL: undefined,
        API_BASE_URL: undefined,
      });
    });

    it('getFinancialApiUrl() derives the Edge Function URL from SUPABASE_URL', () => {
      const expected = `${SUPABASE_URL}/functions/v1`;
      expect(api.getFinancialApiUrl()).toBe(expected);
    });

    it('FINANCIAL_API_BASE_URL is derived from SUPABASE_URL', () => {
      const expected = `${SUPABASE_URL}/functions/v1`;
      expect(api.FINANCIAL_API_BASE_URL).toBe(expected);
    });

    it('wallet and payment paths do not point at a localhost server', () => {
      expect(`${api.FINANCIAL_API_BASE_URL}/wallet/balance`).not.toContain('localhost');
      expect(`${api.FINANCIAL_API_BASE_URL}/payments/methods`).not.toContain('localhost');
    });
  });

  describe('when no Supabase variable is set (local-dev fallback)', () => {
    let api: ReturnType<typeof isolatedRequire>;

    beforeAll(() => {
      api = isolatedRequire({
        EXPO_PUBLIC_SUPABASE_FUNCTIONS_URL: undefined,
        EXPO_PUBLIC_SUPABASE_URL: undefined,
        EXPO_PUBLIC_API_BASE_URL: LEGACY_API_URL,
        EXPO_PUBLIC_API_URL: undefined,
        API_BASE_URL: undefined,
      });
    });

    it('getFinancialApiUrl() falls back to getApiBaseUrl() in local-dev', () => {
      // Both should return the same legacy server URL so local dev still works.
      expect(api.getFinancialApiUrl()).toBe(api.getApiBaseUrl());
    });

    it('FINANCIAL_API_BASE_URL equals API_BASE_URL in local-dev', () => {
      expect(api.FINANCIAL_API_BASE_URL).toBe(api.API_BASE_URL);
    });
  });
});
