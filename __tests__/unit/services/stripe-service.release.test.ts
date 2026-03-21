import { stripeService } from '../../../lib/services/stripe-service';

describe('stripeService.releaseEscrow', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV };
  });

  afterEach(() => {
    process.env = OLD_ENV;
    jest.restoreAllMocks();
  });

  it('parses and returns platformFee and hunterAmount from backend response', async () => {
    const mockData = {
      transferId: 'tr_456',
      paymentIntentId: 'pi_456',
      platformFee: 2.5,
      hunterAmount: 17.5,
      status: 'released',
    };

    // Mock global fetch
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => mockData,
    });

    const res = await stripeService.releaseEscrow('escrow-456');

    expect(res.transferId).toBe('tr_456');
    expect(res.paymentIntentId).toBe('pi_456');
    expect(res.platformFee).toBe(2.5);
    expect(res.hunterAmount).toBe(17.5);
    expect(res.status).toBe('released');
  });

  it('throws when backend responds non-ok', async () => {
    (global as any).fetch = jest.fn().mockResolvedValue({ ok: false, status: 500 });

    await expect(stripeService.releaseEscrow('escrow-500')).rejects.toBeDefined();
  });
});
