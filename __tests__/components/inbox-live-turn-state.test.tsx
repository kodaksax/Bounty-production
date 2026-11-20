/**
 * The YOUR MOVE badge follows the other party's move without a manual
 * refresh: the Inbox reloads when the tab pager lands on it (a swipe fires no
 * focus event), and when a listed bounty's row changes.
 */
import { render, waitFor } from '@testing-library/react-native';
import React from 'react';
import { lightTheme } from '../../lib/themes/lightTheme';

const mockGetByUserId = jest.fn();
const mockGetAllWithDetails = jest.fn();
const mockGetLatestSubmissions = jest.fn();
const mockRefreshConversations = jest.fn();
const mockOn = jest.fn();

jest.mock('../../hooks/useValidUserId', () => ({ useValidUserId: () => 'poster-1' }));
jest.mock('../../hooks/useApplicationListViews', () => ({ useApplicationListViews: () => ({}) }));
jest.mock('../../hooks/useConversations', () => ({
  useConversations: () => ({ conversations: [], loading: false, refresh: mockRefreshConversations }),
}));
jest.mock('../../lib/themes/AppThemeContext', () => ({
  useAppThemeContext: () => ({ theme: lightTheme }),
}));
jest.mock('../../lib/wallet-context', () => ({ useWallet: () => ({ refundEscrow: jest.fn() }) }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  useFocusEffect: jest.fn(),
}));
jest.mock('lib/services/bounty-service', () => ({
  bountyService: { getByUserId: (...a: unknown[]) => mockGetByUserId(...a) },
}));
jest.mock('lib/services/bounty-request-service', () => ({
  bountyRequestService: {
    getAllWithDetails: (...a: unknown[]) => mockGetAllWithDetails(...a),
    getAllWithDetailsBatch: jest.fn().mockResolvedValue([]),
    getAll: jest.fn().mockResolvedValue([]),
  },
}));
jest.mock('lib/services/completion-service', () => ({
  completionService: {
    getLatestSubmissionsForBounties: (...a: unknown[]) => mockGetLatestSubmissions(...a),
  },
}));
jest.mock('../../lib/supabase', () => {
  const channel: any = {
    on: jest.fn((...args: unknown[]) => {
      mockOn(...args);
      return channel;
    }),
    subscribe: jest.fn(() => channel),
  };
  return {
    supabase: { channel: jest.fn(() => channel), removeChannel: jest.fn() },
    isSupabaseConfigured: true,
  };
});

jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('../../components/ui/skeleton-loaders', () => ({ PostingsListSkeleton: () => null }));

import { InboxScreen } from '../../app/tabs/inbox-screen';

const POSTED = { id: 'b-posted', status: 'in_progress', title: 'Paint', amount: 50, poster_id: 'poster-1', accepted_by: 'h1' };
const WORK = { id: 'b-work', status: 'in_progress', title: 'Fence', amount: 30, poster_id: 'p2', accepted_by: 'poster-1' };

function renderInbox(isActive: boolean) {
  return render(
    <InboxScreen activeScreen="messages" setActiveScreen={jest.fn()} isActive={isActive} />
  );
}

/** The handler InboxScreen registered for UPDATEs on the bounties table. */
function bountiesHandler(): ((payload: unknown) => void) | undefined {
  const call = mockOn.mock.calls.find(
    c => (c[1] as any)?.table === 'bounties' && (c[1] as any)?.event === 'UPDATE'
  );
  return call?.[2] as any;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetByUserId.mockResolvedValue([POSTED]);
  mockGetAllWithDetails.mockResolvedValue([{ id: 'r1', status: 'accepted', bounty_id: 'b-work', bounty: WORK }]);
  mockGetLatestSubmissions.mockResolvedValue(new Map());
  mockRefreshConversations.mockResolvedValue(undefined);
});

describe('InboxScreen live turn state', () => {
  it('reloads the lists and submissions when the pager lands on the Inbox', async () => {
    const view = renderInbox(false);
    await waitFor(() => expect(mockGetAllWithDetails).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockGetLatestSubmissions).toHaveBeenCalled());
    expect(mockGetByUserId).toHaveBeenCalledTimes(1);
    const submissionReads = mockGetLatestSubmissions.mock.calls.length;

    view.rerender(<InboxScreen activeScreen="messages" setActiveScreen={jest.fn()} isActive />);
    await waitFor(() => expect(mockGetByUserId).toHaveBeenCalledTimes(2));
    expect(mockGetAllWithDetails).toHaveBeenCalledTimes(2);
    // Same bounty ids as before: the hook still re-reads the submissions.
    await waitFor(() => expect(mockGetLatestSubmissions.mock.calls.length).toBeGreaterThan(submissionReads));
    expect(mockRefreshConversations).toHaveBeenCalledTimes(1);
  });

  it('does not reload again while it stays the active tab', async () => {
    const view = renderInbox(true);
    await waitFor(() => expect(mockGetLatestSubmissions).toHaveBeenCalled());
    view.rerender(<InboxScreen activeScreen="messages" setActiveScreen={jest.fn()} isActive />);
    await new Promise(r => setTimeout(r, 0));
    expect(mockGetByUserId).toHaveBeenCalledTimes(1);
    expect(mockRefreshConversations).not.toHaveBeenCalled();
  });

  it('subscribes to updates for every listed bounty and reloads the list that holds it', async () => {
    renderInbox(true);
    await waitFor(() => expect(bountiesHandler()).toBeDefined());
    const filter = (mockOn.mock.calls.find(c => (c[1] as any)?.table === 'bounties')![1] as any).filter;
    expect(filter).toBe('id=in.(b-posted,b-work)');

    bountiesHandler()!({ new: { id: 'b-work', status: 'completed' } });
    await waitFor(() => expect(mockGetAllWithDetails).toHaveBeenCalledTimes(2));
    expect(mockGetByUserId).toHaveBeenCalledTimes(1);

    bountiesHandler()!({ new: { id: 'b-posted', status: 'completed' } });
    await waitFor(() => expect(mockGetByUserId).toHaveBeenCalledTimes(2));
  });
});
