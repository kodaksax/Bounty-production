// Regression test for GitHub #810: repeated taps on "Ask a question" in the
// Requests tab opened the messenger once per tap, because the conversation
// RPC is awaited before navigating and nothing blocked taps in the meantime.

import { act, renderHook } from '@testing-library/react-native';
import { Alert } from 'react-native';

const mockPush = jest.fn();
const mockGetOrCreateConversation = jest.fn();
const mockRpc = jest.fn();

jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('lib/services/message-service', () => ({
  messageService: {
    getOrCreateConversation: (...a: unknown[]) => mockGetOrCreateConversation(...a),
  },
}));
jest.mock('lib/services/analytics-service', () => ({
  analyticsService: { trackEvent: jest.fn() },
}));
jest.mock('lib/services/monitoring', () => ({ logClientError: jest.fn() }));
jest.mock('lib/supabase', () => ({
  supabase: { rpc: (...a: unknown[]) => mockRpc(...a) },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { useAskApplicant, ASK_APPLICANT_NAV_LOCK_MS } = require('hooks/useAskApplicant');

const requests = [
  { id: 'req-1', bounty_id: 'b1', hunter_id: 'hunter-1', status: 'pending' },
  { id: 'req-2', bounty_id: 'b1', hunter_id: 'hunter-2', status: 'pending' },
];

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('useAskApplicant', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockPush.mockReset();
    mockGetOrCreateConversation.mockReset();
    mockRpc.mockReset().mockResolvedValue({ error: null });
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('opens the messenger once no matter how many times the button is tapped', async () => {
    const pending = deferred<{ id: string }>();
    mockGetOrCreateConversation.mockReturnValue(pending.promise);
    const { result } = renderHook(() => useAskApplicant({ bountyRequests: requests }));

    // Three taps before the conversation RPC resolves (same render closure).
    let taps: Promise<void>[] = [];
    act(() => {
      taps = [
        result.current.handleAskApplicant('req-1'),
        result.current.handleAskApplicant('req-1'),
        result.current.handleAskApplicant('req-2'),
      ];
    });
    await act(async () => {
      pending.resolve({ id: 'conv-1' });
      await Promise.all(taps);
    });

    expect(mockGetOrCreateConversation).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith('/tabs/messenger/conv-1');
  });

  it('ignores taps during the navigation transition, then allows a new one', async () => {
    mockGetOrCreateConversation.mockResolvedValue({ id: 'conv-1' });
    const { result } = renderHook(() => useAskApplicant({ bountyRequests: requests }));

    await act(async () => {
      await result.current.handleAskApplicant('req-1');
    });
    expect(result.current.askingRequestId).toBe('req-1');
    expect(result.current.isAskApplicantBusy).toBe(true);

    await act(async () => {
      await result.current.handleAskApplicant('req-1');
    });
    expect(mockPush).toHaveBeenCalledTimes(1);

    act(() => {
      jest.advanceTimersByTime(ASK_APPLICANT_NAV_LOCK_MS);
    });
    expect(result.current.askingRequestId).toBeNull();
    expect(result.current.isAskApplicantBusy).toBe(false);

    await act(async () => {
      await result.current.handleAskApplicant('req-1');
    });
    expect(mockPush).toHaveBeenCalledTimes(2);
  });

  it('releases immediately after a failure so the poster can retry', async () => {
    mockGetOrCreateConversation.mockRejectedValueOnce(new Error('offline'));
    mockGetOrCreateConversation.mockResolvedValueOnce({ id: 'conv-2' });
    const { result } = renderHook(() => useAskApplicant({ bountyRequests: requests }));

    await act(async () => {
      await result.current.handleAskApplicant('req-1');
    });
    expect(Alert.alert).toHaveBeenCalledTimes(1);
    expect(mockPush).not.toHaveBeenCalled();
    expect(result.current.askingRequestId).toBeNull();
    expect(result.current.isAskApplicantBusy).toBe(false);

    await act(async () => {
      await result.current.handleAskApplicant('req-1');
    });
    expect(mockPush).toHaveBeenCalledWith('/tabs/messenger/conv-2');
  });
});
