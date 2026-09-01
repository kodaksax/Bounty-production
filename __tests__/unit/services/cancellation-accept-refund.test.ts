jest.mock('../../../lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: { from: jest.fn() },
}));
jest.mock('../../../lib/utils/error-logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../../lib/services/analytics-service', () => ({
  analyticsService: { trackEvent: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('../../../lib/services/bounty-service', () => ({
  bountyService: {
    getById: jest.fn(),
    update: jest.fn().mockResolvedValue({}),
  },
}));

import { cancellationService } from '../../../lib/services/cancellation-service';
import { bountyService } from '../../../lib/services/bounty-service';
import { supabase } from '../../../lib/supabase';

describe('cancellationService.acceptCancellation refund gating', () => {
  const cancellation = {
    id: 'c1',
    bountyId: 'b1',
    requesterId: 'u1',
    requesterType: 'poster' as const,
    refundPercentage: 100,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(cancellationService, 'getCancellationById').mockResolvedValue(cancellation as any);
    jest.spyOn(cancellationService, 'updateUserStats').mockResolvedValue(undefined as any);
    (bountyService.getById as jest.Mock).mockResolvedValue({ id: 'b1', amount: 50, title: 't' });
    (supabase.from as jest.Mock).mockReturnValue({
      update: jest.fn(() => ({ eq: jest.fn(() => Promise.resolve({ error: null })) })),
    });
  });

  it('does not cancel the bounty when the refund returns false', async () => {
    const refund = jest.fn().mockResolvedValue(false);
    const ok = await cancellationService.acceptCancellation('c1', 'u2', undefined, refund);
    expect(ok).toBe(false);
    expect(refund).toHaveBeenCalledTimes(1);
    expect(bountyService.update).not.toHaveBeenCalled();
    expect(supabase.from).not.toHaveBeenCalledWith('bounty_cancellations');
  });

  it('does not cancel the bounty when the refund throws', async () => {
    const refund = jest.fn().mockRejectedValue(new Error('network'));
    const ok = await cancellationService.acceptCancellation('c1', 'u2', undefined, refund);
    expect(ok).toBe(false);
    expect(bountyService.update).not.toHaveBeenCalled();
  });

  it('cancels the bounty only after a successful refund', async () => {
    const refund = jest.fn().mockResolvedValue(true);
    const ok = await cancellationService.acceptCancellation('c1', 'u2', undefined, refund);
    expect(ok).toBe(true);
    expect(refund).toHaveBeenCalledTimes(1);
    expect(bountyService.update).toHaveBeenCalledWith('b1', { status: 'cancelled' });
  });
});
