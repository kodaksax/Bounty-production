/**
 * Unit tests for lib/services/connect-service.ts (client-side).
 *
 * Note: this is the React Native client wrapper that calls
 * `/payments/create-connect-account`, `/payments/create-account-link`,
 * and `/payments/connect/accounts/:id/verify` on our backend. It is
 * distinct from `services/api/src/services/stripe-connect-service.ts`
 * (the server-side service tested in stripe-connect-service.test.ts).
 */

jest.mock('../../../lib/config/api', () => ({
  API_BASE_URL: 'https://api.test',
  FINANCIAL_API_BASE_URL: 'https://api.test',
}));

jest.mock('../../../lib/utils/error-logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../../../lib/services/performance-service', () => ({
  performanceService: {
    startMeasurement: jest.fn(),
    endMeasurement: jest.fn(),
  },
}));

jest.mock('../../../lib/services/stripe-sdk', () => ({
  stripeSdk: { initialize: jest.fn().mockResolvedValue(undefined) },
}));

import { connectService } from '../../../lib/services/connect-service';

describe('connectService', () => {
  beforeEach(() => {
    (global as any).fetch = jest.fn();
    jest.clearAllMocks();
  });

  // ── createConnectAccount ─────────────────────────────────────────────────
  describe('createConnectAccount', () => {
    it('returns accountId on success', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ accountId: 'acct_123' }),
      });

      const result = await connectService.createConnectAccount(
        'user-1',
        'test@example.com',
        'auth-jwt'
      );
      expect(result).toEqual({ accountId: 'acct_123' });

      const [url, opts] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toBe('https://api.test/payments/create-connect-account');
      expect(opts.method).toBe('POST');
      expect(opts.headers.Authorization).toBe('Bearer auth-jwt');
      expect(JSON.parse(opts.body)).toEqual({ userId: 'user-1', email: 'test@example.com' });
    });

    it('extracts accountId from alternate nested response shape', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ account: { id: 'acct_nested' } }),
      });
      const result = await connectService.createConnectAccount('u', 'e@x.com');
      expect(result.accountId).toBe('acct_nested');
    });

    it.each([
      ['', 'test@example.com'],
      ['user-1', ''],
      ['', ''],
    ])('rejects invalid params (userId=%s, email=%s)', async (userId, email) => {
      await expect(connectService.createConnectAccount(userId, email)).rejects.toBeDefined();
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('throws api_error on non-ok response', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({}),
      });
      await expect(connectService.createConnectAccount('u', 'e@x.com')).rejects.toBeDefined();
    });

    it('throws when response body is missing accountId', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({}),
      });
      await expect(connectService.createConnectAccount('u', 'e@x.com')).rejects.toBeDefined();
    });

    it('wraps raw network failures', async () => {
      (global.fetch as jest.Mock).mockRejectedValue(new Error('ECONNRESET'));
      await expect(connectService.createConnectAccount('u', 'e@x.com')).rejects.toBeInstanceOf(
        Error
      );
    });
  });

  // ── createConnectAccountLink ─────────────────────────────────────────────
  describe('createConnectAccountLink', () => {
    it('returns URL on success', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ url: 'https://connect.stripe.com/setup/x' }),
      });

      const url = await connectService.createConnectAccountLink('acct_1', 'auth');
      expect(url).toBe('https://connect.stripe.com/setup/x');

      const [reqUrl, opts] = (global.fetch as jest.Mock).mock.calls[0];
      expect(reqUrl).toBe('https://api.test/payments/create-account-link');
      expect(opts.method).toBe('POST');
      expect(opts.headers.Authorization).toBe('Bearer auth');
      expect(JSON.parse(opts.body)).toEqual({ accountId: 'acct_1' });
    });

    it('extracts url from nested accountLink shape', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ accountLink: { url: 'https://nested.test' } }),
      });
      const url = await connectService.createConnectAccountLink('acct_1');
      expect(url).toBe('https://nested.test');
    });

    it('rejects when accountId is empty', async () => {
      await expect(connectService.createConnectAccountLink('')).rejects.toBeDefined();
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('throws on non-ok response', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({}),
      });
      await expect(connectService.createConnectAccountLink('acct_1')).rejects.toBeDefined();
    });

    it('throws when response body is missing url', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({}),
      });
      await expect(connectService.createConnectAccountLink('acct_1')).rejects.toBeDefined();
    });
  });

  // ── verifyConnectAccount ─────────────────────────────────────────────────
  describe('verifyConnectAccount', () => {
    it('returns detailsSubmitted + capabilities', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({
          detailsSubmitted: true,
          capabilities: { card_payments: 'active', transfers: 'active' },
        }),
      });

      const result = await connectService.verifyConnectAccount('acct_1', 'auth');
      expect(result.detailsSubmitted).toBe(true);
      expect(result.capabilities).toEqual({
        card_payments: 'active',
        transfers: 'active',
      });

      const [url, opts] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toBe('https://api.test/payments/connect/accounts/acct_1/verify');
      expect(opts.method).toBe('GET');
      expect(opts.headers.Authorization).toBe('Bearer auth');
    });

    it('falls back to nested account.details_submitted shape', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({
          account: { details_submitted: true, capabilities: { transfers: 'pending' } },
        }),
      });
      const result = await connectService.verifyConnectAccount('acct_1');
      expect(result.detailsSubmitted).toBe(true);
      expect(result.capabilities).toEqual({ transfers: 'pending' });
    });

    it('defaults detailsSubmitted to false when absent', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({}),
      });
      const result = await connectService.verifyConnectAccount('acct_1');
      expect(result.detailsSubmitted).toBe(false);
      expect(result.capabilities).toEqual({});
    });

    it('URL-encodes the accountId', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ detailsSubmitted: false }),
      });
      await connectService.verifyConnectAccount('acct/with/slash');
      expect((global.fetch as jest.Mock).mock.calls[0][0]).toContain(
        encodeURIComponent('acct/with/slash')
      );
    });

    it('rejects when accountId is empty', async () => {
      await expect(connectService.verifyConnectAccount('')).rejects.toBeDefined();
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('throws on non-ok response', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({}),
      });
      await expect(connectService.verifyConnectAccount('acct_1')).rejects.toBeDefined();
    });
  });
});
