/**
 * Senior-first poster audit (2026-11-14), fix 7: the poster's chat with one
 * applicant said "1 hunter applied" while the job page showed three, because
 * the thread only ever loaded that one hunter's request.
 *
 * useBountyThread now also counts the bounty's pending offers (the same
 * definition the job page and Inbox use), for the poster of an open bounty.
 */
import { renderHook, waitFor } from '@testing-library/react-native';

const mockGetAll = jest.fn();
const mockGetAllWithDetails = jest.fn();
const mockGetById = jest.fn();

jest.mock('expo-router', () => ({ useFocusEffect: jest.fn() }));
jest.mock('lib/services/bounty-request-service', () => ({
  bountyRequestService: {
    getAll: (...a: unknown[]) => mockGetAll(...a),
    getAllWithDetails: (...a: unknown[]) => mockGetAllWithDetails(...a),
  },
}));
jest.mock('lib/services/bounty-service', () => ({
  bountyService: { getById: (...a: unknown[]) => mockGetById(...a) },
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
jest.mock('lib/services/supabase-messaging', () => ({ fetchConversations: jest.fn().mockResolvedValue([]) }));
jest.mock('lib/services/userProfile', () => ({
  userProfileService: { getProfile: jest.fn().mockResolvedValue({ username: 'ana' }) },
}));
jest.mock('lib/supabase', () => {
  const channel: any = { on: jest.fn(() => channel), subscribe: jest.fn(() => channel) };
  return { supabase: { channel: jest.fn(() => channel), removeChannel: jest.fn() } };
});

import { useBountyThread } from '../../../hooks/useBountyThread';

const pending = (id: string, bountyId = 'b1') => ({ id, bounty_id: bountyId, hunter_id: id, status: 'pending' });

beforeEach(() => {
  jest.clearAllMocks();
  mockGetById.mockResolvedValue({ id: 'b1', status: 'open', poster_id: 'poster-1', title: 'Garage' });
  mockGetAllWithDetails.mockResolvedValue([pending('h1')]);
  mockGetAll.mockResolvedValue([pending('h1'), pending('h2'), pending('h3')]);
});

describe('useBountyThread pendingOfferCount', () => {
  it("counts every pending offer on this bounty for the poster, not just this thread's", async () => {
    const { result } = renderHook(() =>
      useBountyThread({ bountyId: 'b1', role: 'poster', viewerId: 'poster-1', counterpartId: 'h1' })
    );
    await waitFor(() => expect(result.current.pendingOfferCount).toBe(3));
    // Scoped to this bounty, pending only: the same rows the job page counts.
    expect(mockGetAll).toHaveBeenCalledWith({ bountyId: 'b1', status: 'pending' });
  });

  it('a single offer counts as one', async () => {
    mockGetAll.mockResolvedValue([pending('h1')]);
    const { result } = renderHook(() =>
      useBountyThread({ bountyId: 'b1', role: 'poster', viewerId: 'poster-1', counterpartId: 'h1' })
    );
    await waitFor(() => expect(result.current.pendingOfferCount).toBe(1));
  });

  it('is not looked up for a hunter, or once the bounty is no longer open', async () => {
    const hunter = renderHook(() =>
      useBountyThread({ bountyId: 'b1', role: 'hunter', viewerId: 'h1' })
    );
    await waitFor(() => expect(hunter.result.current.loading).toBe(false));
    expect(hunter.result.current.pendingOfferCount).toBeNull();

    mockGetById.mockResolvedValue({ id: 'b1', status: 'in_progress', poster_id: 'poster-1', accepted_by: 'h1' });
    const hired = renderHook(() =>
      useBountyThread({ bountyId: 'b1', role: 'poster', viewerId: 'poster-1', counterpartId: 'h1' })
    );
    await waitFor(() => expect(hired.result.current.loading).toBe(false));
    expect(hired.result.current.pendingOfferCount).toBeNull();
    expect(mockGetAll).not.toHaveBeenCalled();
  });

  it('a failed count is null, never a made-up number', async () => {
    mockGetAll.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() =>
      useBountyThread({ bountyId: 'b1', role: 'poster', viewerId: 'poster-1', counterpartId: 'h1' })
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.pendingOfferCount).toBeNull();
  });

  it('updates when the thread reloads after an accept or pass', async () => {
    const { result } = renderHook(() =>
      useBountyThread({ bountyId: 'b1', role: 'poster', viewerId: 'poster-1', counterpartId: 'h1' })
    );
    await waitFor(() => expect(result.current.pendingOfferCount).toBe(3));
    mockGetAll.mockResolvedValue([pending('h1'), pending('h3')]);
    await result.current.refresh();
    await waitFor(() => expect(result.current.pendingOfferCount).toBe(2));
  });
});
