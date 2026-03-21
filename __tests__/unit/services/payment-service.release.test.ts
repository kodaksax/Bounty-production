import { paymentService } from '../../../lib/services/payment-service';
import { stripeService } from '../../../lib/services/stripe-service';

describe('paymentService.releaseEscrow', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('forwards platformFee and hunterAmount from stripeService', async () => {
    const mockResp = {
      transferId: 'tr_123',
      paymentIntentId: 'pi_123',
      platformFee: 1.23,
      hunterAmount: 8.77,
      status: 'released',
    } as any;

    jest.spyOn(stripeService, 'releaseEscrow').mockResolvedValue(mockResp);

    const res = await paymentService.releaseEscrow('escrow-123', 'token-abc');

    expect(res.success).toBe(true);
    expect(res.transferId).toBe('tr_123');
    expect(res.paymentIntentId).toBe('pi_123');
    expect(res.platformFee).toBe(1.23);
    expect(res.hunterAmount).toBe(8.77);
  });

  it('returns failure when underlying stripe call throws', async () => {
    jest.spyOn(stripeService, 'releaseEscrow').mockRejectedValue(new Error('network'));

    const res = await paymentService.releaseEscrow('escrow-123');

    expect(res.success).toBe(false);
    expect(res.error).toBeDefined();
  });
});
