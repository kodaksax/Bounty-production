// createCancellationRequest, after it moved off "update the bounty, then insert
// the row" onto the atomic create_bounty_cancellation RPC.
//
// The invariants under test:
//
//   * the status flip and the cancellation row are one call, so a crash between
//     them can no longer leave a bounty in `cancellation_requested` with nothing
//     to respond to;
//   * the RPC carries the bounty status the caller READ as p_expected_status, so
//     the database can reject the write if someone else moved the bounty first;
//   * for-honor bounties still short-circuit the dispute flow (cancelled +
//     pre-accepted row + resolved_at), and only that path touches user stats;
//   * an omitted refund percentage reaches the RPC as NULL rather than
//     `undefined`, which postgrest would drop from the payload entirely;
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

/** The shape create_bounty_cancellation returns: the inserted row. */
const row = (overrides: Record<string, unknown> = {}) => ({
  id: 'c1',
  bounty_id: 42,
  requester_id: 'poster-1',
  requester_type: 'poster',
  reason: '[category:changed_mind] not needed',
  status: 'pending',
  responder_id: null,
  response_message: null,
  refund_amount: null,
  refund_percentage: 50,
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

  it('creates the row and the status flip in a single atomic RPC', async () => {
    const result = await cancellationService.createCancellationRequest(
      42,
      'poster-1',
      'poster',
      '  not needed  ',
      50,
      'changed_mind'
    );

    expect(rpc).toHaveBeenCalledTimes(1);
    const [fn, params] = rpc.mock.calls[0];
    expect(fn).toBe('create_bounty_cancellation');
    expect(params).toMatchObject({
      p_bounty_id: 42,
      // The status the caller READ — the RPC compare-and-sets against it.
      p_expected_status: 'in_progress',
      p_target_status: 'cancellation_requested',
      p_requester_id: 'poster-1',
      p_requester_type: 'poster',
      p_reason: '[category:changed_mind] not needed',
      p_status: 'pending',
      p_refund_percentage: 50,
      p_refund_amount: null,
      p_response_message: null,
      p_resolved_at: null,
    });

    // The pre-RPC bounty UPDATE is gone; the RPC owns the transition.
    expect(bountyService.update).not.toHaveBeenCalled();
    expect(result).not.toBeNull();
    expect(result?.id).toBe('c1');
    // bounty_id comes back numeric and must be normalised to a string.
    expect(result?.bountyId).toBe('42');
  });

  it('sends NULL, not undefined, when no refund percentage was chosen', async () => {
    await cancellationService.createCancellationRequest(42, 'poster-1', 'poster', 'reason');

    expect(rpc.mock.calls[0][1].p_refund_percentage).toBeNull();
  });

  it('auto-accepts and auto-cancels for-honor bounties', async () => {
    (bountyService.getById as jest.Mock).mockResolvedValue({
      id: 42,
      status: 'in_progress',
      is_for_honor: true,
    });
    resolveRpcWith({
      data: row({ status: 'accepted', refund_percentage: 0, refund_amount: 0 }),
      error: null,
    });

    const result = await cancellationService.createCancellationRequest(
      42,
      'poster-1',
      'poster',
      'reason',
      100
    );

    const params = rpc.mock.calls[0][1];
    expect(params.p_target_status).toBe('cancelled');
    expect(params.p_status).toBe('accepted');
    // No money is escrowed on a for-honor bounty, so the requested percentage
    // is discarded rather than honoured.
    expect(params.p_refund_percentage).toBe(0);
    expect(params.p_refund_amount).toBe(0);
    expect(params.p_response_message).toEqual(expect.stringContaining('Auto-accepted'));
    expect(typeof params.p_resolved_at).toBe('string');

    // Only the auto-cancelled path settles stats immediately; the disputed path
    // waits for the other party to respond.
    expect(cancellationService.updateUserStats).toHaveBeenCalledWith('poster-1', 'cancellation');
    expect(result?.status).toBe('accepted');
  });

  it('attributes a hunter-initiated auto-cancellation as a withdrawal', async () => {
    (bountyService.getById as jest.Mock).mockResolvedValue({
      id: 42,
      status: 'in_progress',
      is_for_honor: true,
    });

    await cancellationService.createCancellationRequest(42, 'hunter-1', 'hunter', 'reason');

    expect(cancellationService.updateUserStats).toHaveBeenCalledWith('hunter-1', 'withdrawal');
  });

  it('leaves stats alone while a non-honor request is still pending', async () => {
    await cancellationService.createCancellationRequest(42, 'poster-1', 'poster', 'reason', 50);

    expect(cancellationService.updateUserStats).not.toHaveBeenCalled();
  });

  it('maps nullable row columns to undefined rather than null', async () => {
    const result = await cancellationService.createCancellationRequest(
      42,
      'poster-1',
      'poster',
      'reason',
      50
    );

    expect(result?.responderId).toBeUndefined();
    expect(result?.responseMessage).toBeUndefined();
    expect(result?.refundAmount).toBeUndefined();
    expect(result?.updatedAt).toBeUndefined();
    expect(result?.resolvedAt).toBeUndefined();
    expect(result?.refundPercentage).toBe(50);
  });

  it('returns null when the RPC rejects the transition', async () => {
    resolveRpcWith({ data: null, error: { message: 'bounty status changed' } });

    const result = await cancellationService.createCancellationRequest(
      42,
      'poster-1',
      'poster',
      'reason',
      50
    );

    expect(result).toBeNull();
    // A rejected transition must not be reported to analytics as a cancellation.
    expect(analyticsService.trackEvent).not.toHaveBeenCalled();
  });

  it('returns null without calling the RPC when the bounty is gone', async () => {
    (bountyService.getById as jest.Mock).mockResolvedValue(null);

    const result = await cancellationService.createCancellationRequest(
      42,
      'poster-1',
      'poster',
      'reason'
    );

    expect(result).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('still returns the cancellation when analytics tracking throws', async () => {
    (analyticsService.trackEvent as jest.Mock).mockRejectedValueOnce(new Error('posthog down'));

    const result = await cancellationService.createCancellationRequest(
      42,
      'poster-1',
      'poster',
      'reason',
      50
    );

    expect(result?.id).toBe('c1');
  });
});
