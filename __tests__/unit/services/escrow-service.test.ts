/**
 * Unit tests for lib/services/escrow-service.ts
 *
 * Covers createEscrow / releaseEscrow / refundEscrow:
 *  - Happy paths (both `escrowId`/`paymentIntentClientSecret` and
 *    nested `{escrow: {id}}` / `{clientSecret}` response shapes).
 *  - Input validation rejections.
 *  - Non-ok HTTP responses → api_error.
 *  - Missing identifiers in response body → api_error.
 *  - Auth header forwarding.
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

// The escrowService calls stripeSdk.initialize() before making requests.
jest.mock('../../../lib/services/stripe-sdk', () => ({
  stripeSdk: {
    initialize: jest.fn().mockResolvedValue(undefined),
  },
}));

import { escrowService } from '../../../lib/services/escrow-service';

describe('escrowService', () => {
  beforeEach(() => {
    (global as any).fetch = jest.fn();
    jest.clearAllMocks();
  });

  // ── createEscrow ─────────────────────────────────────────────────────────
  describe('createEscrow', () => {
    const baseParams = {
      bountyId: 'b1',
      amount: 12.5,
      posterId: 'p1',
      hunterId: 'h1',
    };

    it('creates an escrow and returns normalized identifiers', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          escrowId: 'esc_1',
          paymentIntentId: 'pi_1',
          paymentIntentClientSecret: 'pi_1_secret_abc',
          status: 'requires_payment_method',
        }),
      });

      const result = await escrowService.createEscrow(baseParams, 'auth-jwt');

      expect(result).toEqual({
        escrowId: 'esc_1',
        paymentIntentId: 'pi_1',
        paymentIntentClientSecret: 'pi_1_secret_abc',
        status: 'requires_payment_method',
      });

      const [url, opts] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toBe('https://api.test/payments/escrows');
      expect(opts.method).toBe('POST');
      expect(opts.headers.Authorization).toBe('Bearer auth-jwt');
      expect(JSON.parse(opts.body)).toEqual({
        bountyId: 'b1',
        amountCents: 1250,
        posterId: 'p1',
        hunterId: 'h1',
        currency: 'usd',
      });
    });

    it('supports alternate response shape {escrow:{id}, clientSecret}', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          escrow: { id: 'esc_2' },
          clientSecret: 'pi_2_secret_xyz',
        }),
      });

      const result = await escrowService.createEscrow(baseParams);
      expect(result.escrowId).toBe('esc_2');
      expect(result.paymentIntentId).toBe('pi_2');
      expect(result.paymentIntentClientSecret).toBe('pi_2_secret_xyz');
      expect(result.status).toBe('requires_payment_method');
    });

    it('omits Authorization header when no token provided', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({
          escrowId: 'e',
          paymentIntentId: 'pi',
          paymentIntentClientSecret: 'pi_secret_1',
          status: 'requires_payment_method',
        }),
      });
      await escrowService.createEscrow(baseParams);
      const headers = (global.fetch as jest.Mock).mock.calls[0][1].headers;
      expect(headers.Authorization).toBeUndefined();
    });

    it.each([
      { ...{ amount: 0 }, label: 'zero amount' },
      { ...{ amount: -1 }, label: 'negative amount' },
      { ...{ bountyId: '' }, label: 'missing bountyId' },
      { ...{ posterId: '' }, label: 'missing posterId' },
      { ...{ hunterId: '' }, label: 'missing hunterId' },
    ])('rejects invalid params: $label', async overrides => {
      const params = { ...baseParams, ...overrides };
      await expect(escrowService.createEscrow(params)).rejects.toMatchObject({
        message: expect.stringMatching(/invalid|required/i),
      });
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('surfaces non-ok HTTP status as api_error', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({}),
      });

      await expect(escrowService.createEscrow(baseParams)).rejects.toMatchObject({
        message: expect.stringMatching(/temporarily unavailable|failed to create escrow/i),
      });
    });

    it('throws when response omits escrowId or clientSecret', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ status: 'requires_payment_method' }),
      });
      await expect(escrowService.createEscrow(baseParams)).rejects.toBeDefined();
    });

    it('wraps raw fetch failure via handleStripeError', async () => {
      (global.fetch as jest.Mock).mockRejectedValue(new Error('network is down'));
      await expect(escrowService.createEscrow(baseParams)).rejects.toBeInstanceOf(Error);
    });
  });

  // ── releaseEscrow ────────────────────────────────────────────────────────
  describe('releaseEscrow', () => {
    it('releases escrow and returns transfer/intent IDs', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({
          transferId: 'tr_1',
          paymentIntentId: 'pi_1',
          status: 'released',
        }),
      });

      const result = await escrowService.releaseEscrow('esc_1', 'auth');
      expect(result).toEqual({
        transferId: 'tr_1',
        paymentIntentId: 'pi_1',
        status: 'released',
      });

      const [url, opts] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toBe('https://api.test/payments/escrows/esc_1/release');
      expect(opts.method).toBe('POST');
      expect(opts.headers.Authorization).toBe('Bearer auth');
    });

    it('supports alternate response shape {transfer:{id}, paymentIntent:{id}}', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({
          transfer: { id: 'tr_alt' },
          paymentIntent: { id: 'pi_alt' },
          status: 'released',
        }),
      });
      const result = await escrowService.releaseEscrow('esc_alt');
      expect(result.transferId).toBe('tr_alt');
      expect(result.paymentIntentId).toBe('pi_alt');
    });

    it('URL-encodes the escrowId', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ status: 'released' }),
      });
      await escrowService.releaseEscrow('weird id/with slashes');
      const url = (global.fetch as jest.Mock).mock.calls[0][0];
      expect(url).toContain(encodeURIComponent('weird id/with slashes'));
    });

    it('rejects when escrowId is empty', async () => {
      await expect(escrowService.releaseEscrow('')).rejects.toBeDefined();
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('rejects on non-ok response', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({}),
      });
      await expect(escrowService.releaseEscrow('esc_missing')).rejects.toBeDefined();
    });
  });

  // ── refundEscrow ─────────────────────────────────────────────────────────
  describe('refundEscrow', () => {
    it('refunds escrow and returns refund details', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({
          paymentIntentId: 'pi_r',
          refundAmount: 1000,
          status: 'refunded',
        }),
      });

      const result = await escrowService.refundEscrow('esc_r', 'auth');
      expect(result).toEqual({
        paymentIntentId: 'pi_r',
        refundAmount: 1000,
        status: 'refunded',
      });
      const [url, opts] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toBe('https://api.test/payments/escrows/esc_r/refund');
      expect(opts.method).toBe('POST');
    });

    it('supports alternate response shape {paymentIntent:{id}}', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ paymentIntent: { id: 'pi_alt' }, status: 'canceled' }),
      });
      const result = await escrowService.refundEscrow('esc');
      expect(result.paymentIntentId).toBe('pi_alt');
      expect(result.status).toBe('canceled');
    });

    it('rejects when escrowId is empty', async () => {
      await expect(escrowService.refundEscrow('')).rejects.toBeDefined();
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('rejects on non-ok response', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({}),
      });
      await expect(escrowService.refundEscrow('esc')).rejects.toBeDefined();
    });

    it('wraps raw fetch failure', async () => {
      (global.fetch as jest.Mock).mockRejectedValue(new Error('boom'));
      await expect(escrowService.refundEscrow('esc')).rejects.toBeInstanceOf(Error);
    });
  });
});
