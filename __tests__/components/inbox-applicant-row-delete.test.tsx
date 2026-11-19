/**
 * Senior-first poster audit (2026-11-14), fix 5: the red trash icon on an
 * applicant's row in Inbox → My Bounties deleted the WHOLE job, and every
 * other application with it, from what looks like that one person's row.
 *
 * An applicant row now carries no job-deletion action (neither the trash icon
 * nor the long-press "Delete posting"). A bounty row with no applicants keeps
 * both, and the job screen keeps "Take this job down".
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import { Alert } from 'react-native';
import { lightTheme } from '../../lib/themes/lightTheme';

const mockGetByUserId = jest.fn();
const mockBatch = jest.fn();
const mockCancel = jest.fn();

jest.mock('../../hooks/useValidUserId', () => ({ useValidUserId: () => 'poster-1' }));
jest.mock('../../hooks/useApplicationListViews', () => ({ useApplicationListViews: () => ({}) }));
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
  bountyService: { getByUserId: (...a: unknown[]) => mockGetByUserId(...a), delete: jest.fn() },
}));
jest.mock('lib/services/bounty-request-service', () => ({
  bountyRequestService: {
    getAllWithDetails: jest.fn().mockResolvedValue([]),
    getAllWithDetailsBatch: (...a: unknown[]) => mockBatch(...a),
    getAll: jest.fn().mockResolvedValue([]),
  },
}));
jest.mock('../../lib/services/bounty-cancel-refund', () => ({
  ...jest.requireActual('../../lib/services/bounty-cancel-refund'),
  cancelAndRefundBounty: (...a: unknown[]) => mockCancel(...a),
}));
jest.mock('../../lib/supabase', () => {
  const channel: any = { on: jest.fn(() => channel), subscribe: jest.fn(() => channel) };
  return {
    supabase: { channel: jest.fn(() => channel), removeChannel: jest.fn() },
    isSupabaseConfigured: true,
  };
});
jest.mock('lib/services/userProfile', () => ({
  userProfileService: { getProfile: jest.fn().mockResolvedValue(null) },
}));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('../../components/ui/skeleton-loaders', () => ({ PostingsListSkeleton: () => null }));

// The global jest.setup react-native mock makes FlatList a bare host string
// that never calls renderItem, so give this suite a minimal one that does
// (the same approach as bounty-feed-filter-carousel.test.tsx).
{
  const RN = require('react-native');
  RN.FlatList = function MiniFlatList({ data = [], renderItem, keyExtractor, ListEmptyComponent }: any) {
    return React.createElement(
      'FlatList',
      {},
      data.length === 0 && ListEmptyComponent
        ? React.isValidElement(ListEmptyComponent)
          ? ListEmptyComponent
          : React.createElement(ListEmptyComponent)
        : data.map((item: any, index: number) =>
            React.createElement(
              React.Fragment,
              { key: keyExtractor ? keyExtractor(item, index) : index },
              renderItem({ item, index })
            )
          )
    );
  };
}

import { InboxScreen } from '../../app/tabs/inbox-screen';

const now = new Date().toISOString();
const WITH_OFFERS = { id: 'b-garage', status: 'open', title: 'Clear the garage', amount: 60, poster_id: 'poster-1', created_at: now };
const NO_OFFERS = { id: 'b-leaves', status: 'open', title: 'Rake leaves', amount: 20, poster_id: 'poster-1', created_at: now };
const offer = (hunter: string, name: string) => ({
  id: `r-${hunter}`,
  bounty_id: 'b-garage',
  hunter_id: hunter,
  status: 'pending',
  created_at: now,
  message: `Hi, I'm ${name}`,
  profile: { username: name, avatar: null },
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  mockGetByUserId.mockResolvedValue([WITH_OFFERS, NO_OFFERS]);
  mockBatch.mockResolvedValue([offer('h1', 'Ana'), offer('h2', 'Ben'), offer('h3', 'Cy')]);
});

const LAYOUT = { nativeEvent: { layout: { x: 0, y: 0, width: 400, height: 800 } } };

/** The segment pager and its lists render rows only once they've been measured. */
function layoutAll(view: ReturnType<typeof render>) {
  for (const node of view.UNSAFE_root.findAll(n => typeof n.props?.onLayout === 'function')) {
    act(() => node.props.onLayout(LAYOUT));
  }
}

async function renderInbox() {
  const view = render(<InboxScreen initialTab="requests" activeScreen="postings" setActiveScreen={jest.fn()} />);
  layoutAll(view);
  await waitFor(() => expect(mockBatch).toHaveBeenCalled());
  await waitFor(() => {
    layoutAll(view);
    expect(screen.getByText("Hi, I'm Ana")).toBeTruthy();
  });
  return view;
}

describe('Inbox applicant rows', () => {
  it("never offer to delete the applicant's parent job", async () => {
    await renderInbox();
    expect(screen.getByText("Hi, I'm Ben")).toBeTruthy();
    expect(screen.getByText("Hi, I'm Cy")).toBeTruthy();
    // Three applicant rows for "Clear the garage", none with a trash icon.
    expect(screen.queryAllByLabelText('Delete Clear the garage')).toHaveLength(0);
  });

  it('long-pressing an applicant row offers no "Delete posting"', async () => {
    await renderInbox();
    fireEvent(screen.getByText("Hi, I'm Ana"), 'longPress');
    const calls = (Alert.alert as jest.Mock).mock.calls;
    const offered = calls.flatMap(c => (c[2] ?? []).map((b: { text: string }) => b.text));
    expect(offered).not.toContain('Delete posting');
    expect(mockCancel).not.toHaveBeenCalled();
  });

  it('never shows a job with offers as unanswered while its offers are still loading (16 Nov swarm)', async () => {
    let release: (rows: unknown[]) => void = () => {};
    mockBatch.mockReturnValue(new Promise(r => (release = r)));
    const view = render(<InboxScreen initialTab="requests" activeScreen="postings" setActiveScreen={jest.fn()} />);
    layoutAll(view);
    await waitFor(() => expect(mockBatch).toHaveBeenCalled());
    layoutAll(view);
    // The jobs are known but their offers aren't: no row may claim nobody applied.
    expect(screen.queryByText('Clear the garage')).toBeNull();
    expect(screen.queryByText(/No one has applied yet/)).toBeNull();
    await act(async () => {
      release([offer('h1', 'Ana')]);
    });
    await waitFor(() => {
      layoutAll(view);
      expect(screen.getByText("Hi, I'm Ana")).toBeTruthy();
    });
  });

  it('a job with no applicants keeps its own delete action, behind a confirmation', async () => {
    await renderInbox();
    expect(screen.getByLabelText('Delete Rake leaves')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Delete Rake leaves'));
    const [title] = (Alert.alert as jest.Mock).mock.calls.at(-1)!;
    expect(title).toBe('Delete Posting');
    // Only confirmed, never on the tap itself.
    expect(mockCancel).not.toHaveBeenCalled();
  });
});
