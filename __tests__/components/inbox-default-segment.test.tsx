/**
 * SBA-10 (3): the Inbox opens on My Bounties for anyone with an open bounty
 * they posted, because that is where its applications arrive. Hunter-only
 * accounts keep My Work, and an explicit link (SBA-12) always wins.
 *
 * The active segment is read from the `active` argument InboxScreen passes to
 * useApplicantListViewed (true only while My Bounties is showing), which is
 * also exactly what drives the done-when event, applicant_list_viewed.
 */
import { render, waitFor } from '@testing-library/react-native';
import React from 'react';
import { lightTheme } from '../../lib/themes/lightTheme';

const mockGetByUserId = jest.fn();
const mockApplicantListViewed = jest.fn();
let mockUserId: string | null = 'poster-1';

jest.mock('../../hooks/useValidUserId', () => ({ useValidUserId: () => mockUserId }));
jest.mock('../../hooks/useApplicantListViewed', () => ({
  useApplicantListViewed: (...args: unknown[]) => mockApplicantListViewed(...args),
}));
jest.mock('../../hooks/useConversations', () => ({
  useConversations: () => ({ conversations: [], loading: false, refresh: jest.fn() }),
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
    getAllWithDetails: jest.fn().mockResolvedValue([]),
    getAllWithDetailsBatch: jest.fn().mockResolvedValue([]),
    getAll: jest.fn().mockResolvedValue([]),
  },
}));
jest.mock('../../lib/supabase', () => {
  const channel: any = { on: jest.fn(() => channel), subscribe: jest.fn(() => channel) };
  return {
    supabase: { channel: jest.fn(() => channel), removeChannel: jest.fn() },
    isSupabaseConfigured: true,
  };
});

jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('../../components/ui/skeleton-loaders', () => ({ PostingsListSkeleton: () => null }));

import { InboxScreen } from '../../app/tabs/inbox-screen';

const OPEN = { id: 'b-open', status: 'open', title: 'Fix a fence', amount: 30, poster_id: 'poster-1' };
const WORKING = { id: 'b-work', status: 'in_progress', title: 'Paint', amount: 50, poster_id: 'poster-1', accepted_by: 'h1' };

/** The last `active` flag InboxScreen gave the applicants-viewed hook. */
function myBountiesShowing(): boolean {
  const calls = mockApplicantListViewed.mock.calls;
  return calls.length > 0 && calls[calls.length - 1][1] === true;
}

function renderInbox(initialTab?: string) {
  return render(
    <InboxScreen initialTab={initialTab} activeScreen="postings" setActiveScreen={jest.fn()} />
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUserId = 'poster-1';
});

describe('InboxScreen default segment', () => {
  it('opens on My Bounties once a poster’s open bounty loads', async () => {
    mockGetByUserId.mockResolvedValue([OPEN]);
    renderInbox();
    await waitFor(() => expect(myBountiesShowing()).toBe(true));
  });

  it('keeps My Work when nothing the user posted is open', async () => {
    mockGetByUserId.mockResolvedValue([WORKING]);
    renderInbox();
    await waitFor(() => expect(mockGetByUserId).toHaveBeenCalled());
    // Let the load settle, then confirm it never moved.
    await waitFor(() => expect(mockApplicantListViewed.mock.calls.length).toBeGreaterThan(1));
    expect(myBountiesShowing()).toBe(false);
  });

  it('keeps My Work for a hunter-only account', async () => {
    mockGetByUserId.mockResolvedValue([]);
    renderInbox();
    await waitFor(() => expect(mockGetByUserId).toHaveBeenCalled());
    await waitFor(() => expect(mockApplicantListViewed.mock.calls.length).toBeGreaterThan(1));
    expect(myBountiesShowing()).toBe(false);
  });

  it('an explicit My Work link wins over the default', async () => {
    mockGetByUserId.mockResolvedValue([OPEN]);
    renderInbox('inProgress');
    await waitFor(() => expect(mockGetByUserId).toHaveBeenCalled());
    await waitFor(() => expect(mockApplicantListViewed.mock.calls.length).toBeGreaterThan(1));
    expect(myBountiesShowing()).toBe(false);
  });

  it('an explicit My Bounties link opens there immediately', () => {
    mockGetByUserId.mockReturnValue(new Promise(() => {}));
    renderInbox('requests');
    expect(myBountiesShowing()).toBe(true);
  });

  it('does not decide before the user id resolves', async () => {
    mockUserId = null;
    mockGetByUserId.mockResolvedValue([OPEN]);
    const view = renderInbox();
    expect(myBountiesShowing()).toBe(false);
    mockUserId = 'poster-1';
    view.rerender(
      <InboxScreen activeScreen="postings" setActiveScreen={jest.fn()} />
    );
    await waitFor(() => expect(myBountiesShowing()).toBe(true));
  });
});
