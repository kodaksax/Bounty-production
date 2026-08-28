// Integration of the pay-at-accept gate into hooks/useAcceptRequest.
//
// The DB is the thing that actually enforces "no work without funding" (see
// the trigger tests in the migration and the audit notes). What this suite
// pins down is the CLIENT contract around it, which is where the damaging
// user-visible failures would be:
//
//   * the poster is never told a hunter was selected when they weren't;
//   * declining the charge accepts nothing at all;
//   * a funding failure recovers in place and retries at most once, so a
//     double tap or a stuck server cannot fan out into repeated attempts on
//     the money path;
//   * a legacy (already-escrowed) bounty is completely unaffected.

import { act, renderHook } from '@testing-library/react-native';

const mockAcceptRequest = jest.fn();
const mockTrackEvent = jest.fn();
const mockRpc = jest.fn().mockResolvedValue({ data: 'conv-1', error: null });

jest.mock('lib/services/bounty-request-service', () => ({
  bountyRequestService: { acceptRequest: (...a: unknown[]) => mockAcceptRequest(...a) },
}));
jest.mock('lib/services/bounty-service', () => ({ bountyService: { getById: jest.fn() } }));
jest.mock('lib/services/message-service', () => ({
  messageService: {
    getOrCreateConversation: jest.fn().mockResolvedValue({ id: 'local-1' }),
    sendMessage: jest.fn().mockResolvedValue(undefined),
  },
}));
jest.mock('lib/services/analytics-service', () => ({
  analyticsService: { trackEvent: (...a: unknown[]) => mockTrackEvent(...a) },
}));
jest.mock('lib/services/monitoring', () => ({
  logClientError: jest.fn(),
  logClientInfo: jest.fn(),
}));
jest.mock('lib/services/navigation-intent', () => ({
  navigationIntent: { setPendingConversationId: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('lib/services/supabase-messaging', () => ({
  sendMessage: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: { rpc: (...a: unknown[]) => mockRpc(...a) },
}));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { useAcceptRequest } = require('hooks/useAcceptRequest');

function makeRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: 'req-1',
    bounty_id: 'b1',
    hunter_id: 'hunter-1',
    status: 'pending',
    profile: { username: 'Ada' },
    bounty: {
      id: 'b1',
      title: 'Walk my dog',
      amount: 50,
      is_for_honor: false,
      funding_mode: 'at_accept',
      ...(overrides.bounty as object),
    },
    ...overrides,
  };
}

function setup(params: Record<string, unknown> = {}, request = makeRequest()) {
  const noop = jest.fn();
  const asyncNoop = jest.fn().mockResolvedValue(undefined);
  const { result } = renderHook(() =>
    useAcceptRequest({
      currentUserId: 'poster-1',
      bountyRequests: [request],
      myBounties: [],
      setBountyRequests: noop,
      setMyBounties: noop,
      setInProgressBounties: noop,
      setIsLoading: noop,
      setError: noop,
      loadMyBounties: asyncNoop,
      loadInProgress: asyncNoop,
      loadRequestsForMyBounties: asyncNoop,
      setActiveScreen: noop,
      ...params,
    })
  );
  return result;
}

const eventNames = () => mockTrackEvent.mock.calls.map(c => c[0]);

describe('useAcceptRequest + pay-at-accept gate', () => {
  beforeEach(() => {
    mockAcceptRequest.mockReset();
    mockTrackEvent.mockReset();
    mockRpc.mockClear();
  });

  test('declining the charge accepts nothing', async () => {
    const ensureFunded = jest.fn().mockResolvedValue(false);
    const result = setup({ ensureFunded });

    await act(async () => {
      await result.current.handleAcceptRequest('req-1');
    });

    expect(ensureFunded).toHaveBeenCalledWith('b1', expect.objectContaining({ hunterName: 'Ada' }));
    // The single most important assertion in this file.
    expect(mockAcceptRequest).not.toHaveBeenCalled();
    expect(eventNames()).not.toContain('bounty_claimed');
    expect(eventNames()).not.toContain('bounty_work_started');
  });

  test('refreshes the wallet after a deferred acceptance charges the poster', async () => {
    // The escrow is taken server-side inside the acceptance transaction, so
    // nothing on this device knows the balance changed. Without this the poster
    // sees their pre-charge balance until some unrelated event refreshes it.
    const refreshWallet = jest.fn().mockResolvedValue(undefined);
    mockAcceptRequest.mockResolvedValue({ id: 'req-1', hunter_id: 'hunter-1', bounty_id: 'b1' });

    const result = setup({ ensureFunded: jest.fn().mockResolvedValue(true), refreshWallet });
    await act(async () => {
      await result.current.handleAcceptRequest('req-1');
    });

    expect(refreshWallet).toHaveBeenCalledTimes(1);
  });

  test('does not refresh the wallet for a legacy at_post bounty', async () => {
    // Nothing was charged at acceptance — the money moved when it was posted —
    // so there is no reason to spend a round-trip re-reading the balance.
    const refreshWallet = jest.fn().mockResolvedValue(undefined);
    mockAcceptRequest.mockResolvedValue({ id: 'req-1', hunter_id: 'hunter-1', bounty_id: 'b1' });

    const result = setup(
      { ensureFunded: jest.fn().mockResolvedValue(true), refreshWallet },
      makeRequest({ bounty: { funding_mode: 'at_post' } })
    );
    await act(async () => {
      await result.current.handleAcceptRequest('req-1');
    });

    expect(refreshWallet).not.toHaveBeenCalled();
  });

  test('a failing wallet refresh never fails an acceptance that succeeded', async () => {
    const refreshWallet = jest.fn().mockRejectedValue(new Error('network down'));
    mockAcceptRequest.mockResolvedValue({ id: 'req-1', hunter_id: 'hunter-1', bounty_id: 'b1' });

    const result = setup({ ensureFunded: jest.fn().mockResolvedValue(true), refreshWallet });
    await act(async () => {
      await result.current.handleAcceptRequest('req-1');
    });

    // The hunter IS accepted and the money IS escrowed; a stale displayed
    // number must not surface as a failed acceptance.
    expect(mockAcceptRequest).toHaveBeenCalled();
    expect(eventNames()).toContain('bounty_work_started');
  });

  test('the gate runs BEFORE the acceptance, not after', async () => {
    const order: string[] = [];
    const ensureFunded = jest.fn().mockImplementation(async () => {
      order.push('gate');
      return true;
    });
    mockAcceptRequest.mockImplementation(async () => {
      order.push('accept');
      return { id: 'req-1', hunter_id: 'hunter-1', bounty_id: 'b1' };
    });

    const result = setup({ ensureFunded });
    await act(async () => {
      await result.current.handleAcceptRequest('req-1');
    });

    expect(order).toEqual(['gate', 'accept']);
  });

  test('a funded acceptance emits the funding and work-started funnel steps', async () => {
    mockAcceptRequest.mockResolvedValue({ id: 'req-1', hunter_id: 'hunter-1', bounty_id: 'b1' });
    const result = setup({ ensureFunded: jest.fn().mockResolvedValue(true) });

    await act(async () => {
      await result.current.handleAcceptRequest('req-1');
    });

    const names = eventNames();
    expect(names).toEqual(
      expect.arrayContaining([
        'bounty_claimed',
        'accept_funding_succeeded',
        'escrow_funded',
        'bounty_work_started',
      ])
    );
    // escrow_funded must say WHEN it happened, or the two arms are
    // indistinguishable in the funnel.
    const escrow = mockTrackEvent.mock.calls.find(c => c[0] === 'escrow_funded')?.[1];
    expect(escrow).toMatchObject({ timing: 'at_accept', architecture: 'v1' });
  });

  test('a legacy at_post bounty emits no deferred-funding events', async () => {
    mockAcceptRequest.mockResolvedValue({ id: 'req-1', hunter_id: 'hunter-1', bounty_id: 'b1' });
    const result = setup(
      { ensureFunded: jest.fn().mockResolvedValue(true) },
      makeRequest({ bounty: { funding_mode: 'at_post' } })
    );

    await act(async () => {
      await result.current.handleAcceptRequest('req-1');
    });

    const names = eventNames();
    expect(names).not.toContain('accept_funding_succeeded');
    // No second escrow claim — the money was taken when the bounty was posted.
    expect(names).not.toContain('escrow_funded');
    // The shared step still fires, tagged as control.
    const work = mockTrackEvent.mock.calls.find(c => c[0] === 'bounty_work_started')?.[1];
    expect(work).toMatchObject({ fundingMode: 'at_post', variant: 'control' });
  });

  test('a funding failure retries exactly once after recovery', async () => {
    mockAcceptRequest
      .mockRejectedValueOnce(Object.assign(new Error('insufficient_funds_for_escrow'), { status: 402 }))
      .mockResolvedValueOnce({ id: 'req-1', hunter_id: 'hunter-1', bounty_id: 'b1' });

    const handleAcceptFailure = jest.fn().mockResolvedValue(true);
    const result = setup({
      ensureFunded: jest.fn().mockResolvedValue(true),
      handleAcceptFailure,
    });

    await act(async () => {
      await result.current.handleAcceptRequest('req-1');
    });

    expect(handleAcceptFailure).toHaveBeenCalledTimes(1);
    expect(mockAcceptRequest).toHaveBeenCalledTimes(2);
    expect(eventNames()).toContain('bounty_claimed');
  });

  test('a failure that keeps failing does not loop the money path', async () => {
    mockAcceptRequest.mockRejectedValue(
      Object.assign(new Error('insufficient_funds_for_escrow'), { status: 402 })
    );
    // The poster keeps saying "I fixed it" but the server keeps refusing.
    const handleAcceptFailure = jest.fn().mockResolvedValue(true);
    const result = setup({
      ensureFunded: jest.fn().mockResolvedValue(true),
      handleAcceptFailure,
    });

    await act(async () => {
      await result.current.handleAcceptRequest('req-1');
    });

    // Bounded: one original attempt + exactly one retry.
    expect(mockAcceptRequest).toHaveBeenCalledTimes(2);
    expect(eventNames()).not.toContain('bounty_claimed');
    expect(eventNames()).not.toContain('bounty_work_started');
  });

  test('an unrecovered failure never claims the bounty was accepted', async () => {
    mockAcceptRequest.mockRejectedValue(
      Object.assign(new Error('insufficient_funds_for_escrow'), { status: 402 })
    );
    const result = setup({
      ensureFunded: jest.fn().mockResolvedValue(true),
      handleAcceptFailure: jest.fn().mockResolvedValue(false),
    });

    await act(async () => {
      await result.current.handleAcceptRequest('req-1');
    });

    expect(mockAcceptRequest).toHaveBeenCalledTimes(1);
    expect(eventNames()).not.toContain('bounty_work_started');
    // And no conversation was opened telling the hunter they have a funded job.
    expect(mockRpc).not.toHaveBeenCalledWith('rpc_create_conversation', expect.anything());
  });

  test('a null acceptance result (already claimed) starts no work', async () => {
    mockAcceptRequest.mockResolvedValue(null);
    const result = setup({ ensureFunded: jest.fn().mockResolvedValue(true) });

    await act(async () => {
      await result.current.handleAcceptRequest('req-1');
    });

    expect(eventNames()).not.toContain('bounty_work_started');
    expect(mockRpc).not.toHaveBeenCalledWith('rpc_create_conversation', expect.anything());
  });

  test('works without a gate wired in (legacy call sites keep functioning)', async () => {
    mockAcceptRequest.mockResolvedValue({ id: 'req-1', hunter_id: 'hunter-1', bounty_id: 'b1' });
    const result = setup();

    await act(async () => {
      await result.current.handleAcceptRequest('req-1');
    });

    expect(mockAcceptRequest).toHaveBeenCalledTimes(1);
  });
});
