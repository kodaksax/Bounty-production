// createCancellationRequest, after cancellation requests became HUNTER-ONLY and
// moved onto the request_bounty_cancellation RPC.
//
// The invariants under test:
//
//   * the status flip and the cancellation row are one server-side call, so a
//     crash between them can no longer leave a bounty in `cancellation_requested`
//     with nothing to respond to;
//   * the client sends only the bounty and the reason — it does NOT get to pick
//     the requester type or the refund percentage. Both were removed on purpose:
//     the RPC pins them to 'hunter' and 100, and a client-supplied requester type
//     is exactly what let posters file requests against their own escrow;
//   * the reason still carries the category prefix, since that is the only place
//     the category is persisted;
//   * for-honor bounties still short-circuit the dispute flow, and only that path
//     touches user stats — a pending request is not yet a withdrawal;
//   * the row's nullable columns map to `undefined` on the domain object, not to
//     `null`, so optional fields read as absent rather than as an empty value.

jest.mock('lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: { rpc: jest.fn() },
}));
jest.mock('lib/utils/error-logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));
jest.mock('lib/services/analytics-service', () => ({
  analyticsService: { trackEvent: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('lib/services/bounty-service', () => ({
  bountyService: { getById: jest.fn(), update: jest.fn() },
}));

import { cancellationService } from '../../../lib/services/cancellation-service';
import { analyticsService } from '../../../lib/services/analytics-service';
import { bountyService } from '../../../lib/services/bounty-service';
import { supabase } from '../../../lib/supabase';

const rpc = supabase.rpc as unknown as jest.Mock;

/** The shape request_bounty_cancellation returns: the inserted row. */
const row = (overrides: Record<string, unknown> = {}) => ({
  id: 'c1',
  bounty_id: 42,
  requester_id: 'hunter-1',
  requester_type: 'hunter',
  reason: '[category:changed_mind] cannot finish',
  status: 'pending',
  responder_id: null,
  response_message: null,
  refund_amount: null,
  refund_percentage: 100,
  created_at: '2026-09-08T00:00:00.000Z',
  updated_at: null,
  resolved_at: null,
  ...overrides,
});

const resolveRpcWith = (result: { data: unknown; error: unknown }) => {
  rpc.mockReturnValue({ single: jest.fn().mockResolvedValue(result) });
};

describe('cancellationService.createCancellationRequest', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(cancellationService, 'updateUserStats').mockResolvedValue(undefined as never);
    (bountyService.getById as jest.Mock).mockResolvedValue({
      id: 42,
      status: 'in_progress',
      is_for_honor: false,
    });
    resolveRpcWith({ data: row(), error: null });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('files the request through the hunter-only RPC in a single call', async () => {
    const result = await cancellationService.createCancellationRequest(
      42,
      'hunter-1',
      'cannot finish',
      'changed_mind'
    );

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('request_bounty_cancellation', {
      p_bounty_id: 42,
      p_reason: '[category:changed_mind] cannot finish',
    });
    // The status flip is the RPC's job; the client must never attempt it,
    // because RLS would silently drop a hunter's UPDATE.
    expect(bountyService.update).not.toHaveBeenCalled();
    expect(result?.id).toBe('c1');
  });

  it('does not let the caller choose the requester type or the refund split', async () => {
    await cancellationService.createCancellationRequest(42, 'hunter-1', 'reason');

    const payload = rpc.mock.calls[0][1];
    expect(Object.keys(payload).sort()).toEqual(['p_bounty_id', 'p_reason']);
    expect(payload).not.toHaveProperty('p_requester_type');
    expect(payload).not.toHaveProperty('p_refund_percentage');
  });

  it('defaults the reason category to "other"', async () => {
    await cancellationService.createCancellationRequest(42, 'hunter-1', 'reason');
    expect(rpc.mock.calls[0][1].p_reason).toBe('[category:other] reason');
  });

  it('maps nullable row columns to undefined rather than null', async () => {
    const result = await cancellationService.createCancellationRequest(42, 'hunter-1', 'reason');

    expect(result).toMatchObject({
      id: 'c1',
      bountyId: '42',
      requesterId: 'hunter-1',
      requesterType: 'hunter',
      status: 'pending',
      refundPercentage: 100,
    });
    expect(result?.responderId).toBeUndefined();
    expect(result?.responseMessage).toBeUndefined();
    expect(result?.refundAmount).toBeUndefined();
    expect(result?.resolvedAt).toBeUndefined();
  });

  it('counts a withdrawal only for the for-honor path, which resolves immediately', async () => {
    (bountyService.getById as jest.Mock).mockResolvedValue({
      id: 42,
      status: 'in_progress',
      is_for_honor: true,
    });
    resolveRpcWith({
      data: row({ status: 'accepted', resolved_at: '2026-09-08T00:00:01.000Z', refund_percentage: 0 }),
      error: null,
    });

    const result = await cancellationService.createCancellationRequest(42, 'hunter-1', 'reason');

    expect(result?.status).toBe('accepted');
    expect(cancellationService.updateUserStats).toHaveBeenCalledWith('hunter-1', 'withdrawal');
    expect(analyticsService.trackEvent).toHaveBeenCalledWith(
      'bounty_cancelled',
      expect.objectContaining({ requester_type: 'hunter', was_auto_cancelled: true })
    );
  });

  it('does not count a withdrawal while the request is still pending', async () => {
    await cancellationService.createCancellationRequest(42, 'hunter-1', 'reason');
    expect(cancellationService.updateUserStats).not.toHaveBeenCalled();
  });

  it('returns null when the RPC rejects a non-hunter caller', async () => {
    resolveRpcWith({
      data: null,
      error: { code: '42501', message: 'only the accepted hunter may request cancellation' },
    });

    const result = await cancellationService.createCancellationRequest(42, 'poster-1', 'reason');

    expect(result).toBeNull();
    expect(bountyService.update).not.toHaveBeenCalled();
  });

  it('returns null when the bounty cannot be read', async () => {
    (bountyService.getById as jest.Mock).mockResolvedValue(null);

    const result = await cancellationService.createCancellationRequest(42, 'hunter-1', 'reason');

    expect(result).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });
});
