import { paymentService } from '../../../lib/services/payment-service';
import { queuedOperationsService } from '../../../lib/services/queued-operations-service';
import { supabase } from '../../../lib/supabase';

describe('queuedOperationsService.processQueuedOperation', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('processes release_escrow via paymentService when escrowId present', async () => {
    jest.spyOn(supabase.auth, 'getSession').mockResolvedValue({ data: { session: { access_token: 'tok' } } } as any);
    jest.spyOn(paymentService, 'releaseEscrow').mockResolvedValue({ success: true, transferId: 'tr' } as any);

    const res = await queuedOperationsService.processQueuedOperation({ opType: 'release_escrow', payload: { escrowId: 'esc_1' } });
    expect(res).toBe(true);
    expect(paymentService.releaseEscrow).toHaveBeenCalled();
    expect((paymentService.releaseEscrow as jest.Mock).mock.calls[0][0]).toBe('esc_1');
  });

  it('falls back to server release endpoint when escrowId missing', async () => {
    jest.spyOn(supabase.auth, 'getSession').mockResolvedValue({ data: { session: { access_token: 'tok2' } } } as any);
    (global as any).fetch = jest.fn().mockResolvedValue({ ok: true, text: async () => 'ok' });

    const res = await queuedOperationsService.processQueuedOperation({ opType: 'release_escrow', payload: { bountyId: 'b1', hunterId: 'h1' }, idempotencyKey: 'id1' });
    expect(res).toBe(true);
    expect((global as any).fetch).toHaveBeenCalled();
  });

  it('throws for unsupported op type', async () => {
    await expect(queuedOperationsService.processQueuedOperation({ opType: 'nope', payload: {} } as any)).rejects.toBeDefined();
  });

  it('validates refund_escrow payload and throws when invalid', async () => {
    await expect(queuedOperationsService.processQueuedOperation({ opType: 'refund_escrow', payload: {} } as any)).rejects.toBeDefined();
  });

  it('processes refund_escrow via paymentService when escrowId present', async () => {
    jest.spyOn(supabase.auth, 'getSession').mockResolvedValue({ data: { session: { access_token: 'tok3' } } } as any);
    jest.spyOn(paymentService, 'refundEscrow').mockResolvedValue({ success: true } as any);

    const res = await queuedOperationsService.processQueuedOperation({ opType: 'refund_escrow', payload: { escrowId: 'esc_2' } });
    expect(res).toBe(true);
    expect(paymentService.refundEscrow).toHaveBeenCalled();
    expect((paymentService.refundEscrow as jest.Mock).mock.calls[0][0]).toBe('esc_2');
  });

  it('falls back to server refund endpoint when bountyId present', async () => {
    jest.spyOn(supabase.auth, 'getSession').mockResolvedValue({ data: { session: { access_token: undefined } } } as any);
    (global as any).fetch = jest.fn().mockResolvedValue({ ok: true, text: async () => 'ok' });

    const res = await queuedOperationsService.processQueuedOperation({ opType: 'refund_escrow', payload: { bountyId: 'b2', refundPercentage: 50 }, idempotencyKey: 'id2' });
    expect(res).toBe(true);
    expect((global as any).fetch).toHaveBeenCalled();
  });
});
