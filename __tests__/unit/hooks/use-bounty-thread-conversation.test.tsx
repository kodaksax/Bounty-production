/**
 * The bounty thread keys its chat on the bounty, and the conversation it
 * passes in only changes when a read finds a different one: a failed
 * conversations read on a reload keeps the conversation already found.
 */
import { act, renderHook, waitFor } from '@testing-library/react-native';

const mockFetchConversations = jest.fn();

jest.mock('expo-router', () => ({ useFocusEffect: jest.fn() }));
jest.mock('lib/services/bounty-request-service', () => ({
  bountyRequestService: {
    getAll: jest.fn().mockResolvedValue([]),
    getAllWithDetails: jest.fn().mockResolvedValue([]),
  },
}));
jest.mock('lib/services/bounty-service', () => ({
  bountyService: {
    getById: jest.fn().mockResolvedValue({ id: 'b1', status: 'in_progress', poster_id: 'poster-1', accepted_by: 'h1' }),
  },
}));
jest.mock('lib/services/cancellation-service', () => ({
  cancellationService: { getCancellationByBountyId: jest.fn().mockResolvedValue(null) },
}));
jest.mock('lib/services/completion-service', () => ({
  completionService: {
    getSubmission: jest.fn().mockResolvedValue(null),
    getReady: jest.fn().mockResolvedValue(null),
    subscribeSubmission: jest.fn(() => () => {}),
  },
}));
jest.mock('lib/services/dispute-service', () => ({
  disputeService: { getDisputeByBountyId: jest.fn().mockResolvedValue(null) },
}));
jest.mock('lib/services/supabase-messaging', () => ({
  fetchConversations: (...a: unknown[]) => mockFetchConversations(...a),
}));
jest.mock('lib/services/userProfile', () => ({
  userProfileService: { getProfile: jest.fn().mockResolvedValue({ username: 'ana' }) },
}));
jest.mock('lib/supabase', () => {
  const channel: any = { on: jest.fn(() => channel), subscribe: jest.fn(() => channel) };
  return { supabase: { channel: jest.fn(() => channel), removeChannel: jest.fn() } };
});

import { useBountyThread } from '../../../hooks/useBountyThread';

const CONV = { id: 'c1', isGroup: false, name: 'ana', bountyId: 'b1', participantIds: ['poster-1', 'h1'] };

beforeEach(() => {
  jest.clearAllMocks();
  mockFetchConversations.mockResolvedValue([CONV]);
});

describe('useBountyThread conversation', () => {
  it('keeps the conversation it found when a later read fails', async () => {
    const { result } = renderHook(() =>
      useBountyThread({ bountyId: 'b1', role: 'poster', viewerId: 'poster-1', counterpartId: 'h1' })
    );
    await waitFor(() => expect(result.current.conversation?.id).toBe('c1'));

    mockFetchConversations.mockRejectedValue(new Error('offline'));
    await act(async () => {
      await result.current.refresh();
    });
    expect(mockFetchConversations).toHaveBeenCalledTimes(2);
    expect(result.current.conversation?.id).toBe('c1');
  });

  it('picks up a conversation that appears on a reload', async () => {
    mockFetchConversations.mockResolvedValue([]);
    const { result } = renderHook(() =>
      useBountyThread({ bountyId: 'b1', role: 'poster', viewerId: 'poster-1', counterpartId: 'h1' })
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.conversation).toBeNull();

    mockFetchConversations.mockResolvedValue([CONV]);
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.conversation?.id).toBe('c1');
  });

  it('keeps a fallback conversation when a conversations read fails', async () => {
    mockFetchConversations.mockResolvedValue([]);
    const { result } = renderHook(() =>
      useBountyThread({ bountyId: 'b1', role: 'poster', viewerId: 'poster-1', counterpartId: 'h1' })
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    const fallback = { ...CONV, id: 'fallback-conversation' };
    act(() => result.current.setConversation(fallback));
    mockFetchConversations.mockRejectedValue(new Error('offline'));

    await act(async () => {
      await result.current.refresh();
    });

    expect(mockFetchConversations).toHaveBeenLastCalledWith('poster-1', { throwOnError: true });
    expect(result.current.conversation).toEqual(fallback);
  });
});
