/**
 * Double-tap protection for Hire (accept) and Decline (reject).
 *
 * Every caller (postings/[bountyId], bounty-thread, postings-screen) guarded
 * these with React state, which a fast double tap gets past before the
 * re-render. The hooks now hold a synchronous lock: a second call made while
 * one is running joins it, so the pay-to-hire sheet opens once, the server is
 * asked once, and the caller's own busy state ends when the real work does.
 */
import { act, renderHook } from '@testing-library/react-native';

const mockAcceptRequest = jest.fn();
const mockDelete = jest.fn();

jest.mock('lib/services/bounty-request-service', () => ({
  bountyRequestService: {
    acceptRequest: (...a: unknown[]) => mockAcceptRequest(...a),
    delete: (...a: unknown[]) => mockDelete(...a),
  },
}));
jest.mock('lib/services/bounty-service', () => ({ bountyService: { getById: jest.fn() } }));
jest.mock('lib/services/message-service', () => ({
  messageService: {
    getOrCreateConversation: jest.fn().mockResolvedValue({ id: 'local-1' }),
    sendMessage: jest.fn().mockResolvedValue(undefined),
  },
}));
jest.mock('lib/services/analytics-service', () => ({
  analyticsService: { trackEvent: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('lib/services/monitoring', () => ({ logClientError: jest.fn(), logClientInfo: jest.fn() }));
jest.mock('lib/services/navigation-intent', () => ({
  navigationIntent: { setPendingConversationId: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('lib/services/supabase-messaging', () => ({ sendMessage: jest.fn().mockResolvedValue(undefined) }));
jest.mock('lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: { rpc: jest.fn().mockResolvedValue({ data: 'conv-1', error: null }) },
}));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { useAcceptRequest } = require('hooks/useAcceptRequest');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { useRejectRequest } = require('hooks/useRejectRequest');

const ACCEPTED = { id: 'req-1', hunter_id: 'hunter-1', bounty_id: 'b1' };

const request = {
  id: 'req-1',
  bounty_id: 'b1',
  hunter_id: 'hunter-1',
  status: 'pending',
  profile: { username: 'Ada' },
  bounty: { id: 'b1', title: 'Walk my dog', amount: 50, is_for_honor: false, funding_mode: 'at_accept' },
};

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function renderAccept(params: Record<string, unknown> = {}) {
  const noop = jest.fn();
  const asyncNoop = jest.fn().mockResolvedValue(undefined);
  return renderHook(() =>
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
      showSuccessAlert: false,
      ...params,
    })
  ).result;
}

function renderReject() {
  return renderHook(() =>
    useRejectRequest({
      bountyRequests: [request],
      setBountyRequests: jest.fn(),
      setIsLoading: jest.fn(),
      setError: jest.fn(),
    })
  ).result;
}

beforeEach(() => {
  mockAcceptRequest.mockReset();
  mockDelete.mockReset();
});

describe('Hire (accept application)', () => {
  test('a double tap opens the pay-to-hire sheet once and accepts once', async () => {
    const funded = deferred<boolean>();
    const ensureFunded = jest.fn(() => funded.promise);
    mockAcceptRequest.mockResolvedValue(ACCEPTED);
    const result = renderAccept({ ensureFunded });

    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = result.current.handleAcceptRequest('req-1');
      second = result.current.handleAcceptRequest('req-1');
    });
    // Slow network / poster still on the pay sheet.
    expect(ensureFunded).toHaveBeenCalledTimes(1);

    await act(async () => {
      funded.resolve(true);
      await Promise.all([first, second]);
    });
    expect(mockAcceptRequest).toHaveBeenCalledTimes(1);
  });

  test('a second applicant tapped while the first hire runs does not start a second hire', async () => {
    const accepted = deferred<unknown>();
    mockAcceptRequest.mockReturnValue(accepted.promise);
    const result = renderAccept({ ensureFunded: jest.fn().mockResolvedValue(true) });

    let first!: Promise<void>;
    await act(async () => {
      first = result.current.handleAcceptRequest('req-1');
      void result.current.handleAcceptRequest('req-2');
    });
    await act(async () => {
      accepted.resolve(ACCEPTED);
      await first;
    });
    expect(mockAcceptRequest).toHaveBeenCalledTimes(1);
    expect(mockAcceptRequest).toHaveBeenCalledWith('req-1');
  });

  test('after a failed hire, the poster can retry', async () => {
    mockAcceptRequest
      .mockRejectedValueOnce(Object.assign(new Error('offline'), { status: 0 }))
      .mockResolvedValueOnce(ACCEPTED);
    const result = renderAccept({ ensureFunded: jest.fn().mockResolvedValue(true) });

    await act(async () => {
      await result.current.handleAcceptRequest('req-1');
    });
    await act(async () => {
      await result.current.handleAcceptRequest('req-1');
    });
    expect(mockAcceptRequest).toHaveBeenCalledTimes(2);
  });
});

describe('Decline (reject application)', () => {
  test('two confirmations delete the request once', async () => {
    const deleted = deferred<boolean>();
    mockDelete.mockReturnValue(deleted.promise);
    const result = renderReject();

    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = result.current.handleRejectRequest('req-1');
      second = result.current.handleRejectRequest('req-1');
    });
    await act(async () => {
      deleted.resolve(true);
      await Promise.all([first, second]);
    });
    expect(mockDelete).toHaveBeenCalledTimes(1);
  });

  test('after a failed decline, the poster can retry', async () => {
    mockDelete.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const result = renderReject();
    await act(async () => {
      await result.current.handleRejectRequest('req-1');
    });
    await act(async () => {
      await result.current.handleRejectRequest('req-1');
    });
    expect(mockDelete).toHaveBeenCalledTimes(2);
  });
});
