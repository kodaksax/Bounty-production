/**
 * My Jobs (app/tabs/my-jobs-screen.tsx) end to end against mocked services:
 * the featured job, Who offered (with its analytics gate), switching, the
 * manage actions moved over from the old Inbox (edit, take down, discard,
 * archive, withdraw), the empty and error states, and links that ask for a
 * side.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import React from 'react';
import { Alert } from 'react-native';
import { lightTheme } from '../../lib/themes/lightTheme';

const mockPush = jest.fn();
const mockGetByUserId = jest.fn();
const mockUpdate = jest.fn();
const mockHunterRequests = jest.fn();
const mockBatch = jest.fn();
const mockGetAll = jest.fn();
const mockPlan = jest.fn();
const mockCancel = jest.fn();
const mockWithdraw = jest.fn();
const mockDiscard = jest.fn();
const mockListViews = jest.fn((_args: { enabled: boolean }) => ({}));
let mockConversations: unknown[] = [];
const mockStore = new Map<string, string>();

jest.mock('../../hooks/useValidUserId', () => ({ useValidUserId: () => 'me' }));
jest.mock('../../hooks/useApplicationListViews', () => ({
  useApplicationListViews: (args: { enabled: boolean }) => mockListViews(args),
}));
jest.mock('../../hooks/useConversations', () => ({
  useConversations: () => ({
    conversations: mockConversations,
    totalUnreadCount: 3,
    loading: false,
    refresh: jest.fn().mockResolvedValue(undefined),
  }),
}));
jest.mock('../../lib/themes/AppThemeContext', () => ({ useAppThemeContext: () => ({ theme: lightTheme }) }));
jest.mock('../../lib/wallet-context', () => ({ useWallet: () => ({ refundEscrow: jest.fn() }) }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn() }),
  useFocusEffect: jest.fn(),
}));
jest.mock('lib/services/bounty-service', () => ({
  bountyService: {
    // My Jobs loads posted jobs with getAll({ userId, throwOnError }).
    getAll: (...a: unknown[]) => mockGetByUserId(...a),
    getFundingModes: jest.fn().mockResolvedValue(new Map()),
    update: (...a: unknown[]) => mockUpdate(...a),
  },
}));
jest.mock('lib/services/bounty-request-service', () => ({
  bountyRequestService: {
    getAllWithDetails: (...a: unknown[]) => mockHunterRequests(...a),
    getAllWithDetailsBatch: (...a: unknown[]) => mockBatch(...a),
    getAll: (...a: unknown[]) => mockGetAll(...a),
  },
}));
jest.mock('lib/services/dispute-service', () => ({
  disputeService: { getOpenDisputeBountyIds: jest.fn().mockResolvedValue(new Set()) },
}));
jest.mock('lib/services/cancellation-service', () => ({
  cancellationService: { getPendingCancellationsForBounties: jest.fn().mockResolvedValue(new Map()) },
}));
jest.mock('lib/services/completion-service', () => ({
  completionService: { getLatestSubmissionsForBounties: jest.fn().mockResolvedValue(new Map()) },
}));
jest.mock('lib/services/application-withdrawal', () => ({
  withdrawApplication: (...a: unknown[]) => mockWithdraw(...a),
  discardApplication: (...a: unknown[]) => mockDiscard(...a),
}));
jest.mock('../../lib/services/bounty-cancel-refund', () => ({
  ...jest.requireActual('../../lib/services/bounty-cancel-refund'),
  planCancelRefund: (...a: unknown[]) => mockPlan(...a),
  cancelAndRefundBounty: (...a: unknown[]) => mockCancel(...a),
}));
jest.mock('../../lib/supabase', () => {
  const channel: any = { on: jest.fn(() => channel), subscribe: jest.fn(() => channel) };
  return { supabase: { channel: jest.fn(() => channel), removeChannel: jest.fn() }, isSupabaseConfigured: true };
});
jest.mock('../../lib/storage', () => ({
  storage: {
    getItem: async (k: string) => mockStore.get(k) ?? null,
    setItem: async (k: string, v: string) => void mockStore.set(k, v),
    removeItem: async (k: string) => void mockStore.delete(k),
  },
}));
jest.mock('../../lib/toast', () => ({ showToast: jest.fn() }));
jest.mock('../../components/ui/app-modal', () => ({
  AppModal: ({ visible, children }: { visible: boolean; children: React.ReactNode }) => (visible ? children : null),
}));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('../../components/ui/skeleton-loaders', () => ({ PostingsListSkeleton: () => null }));
jest.mock('../../components/ui/branding-logo', () => ({ BrandingLogo: () => null }));
jest.mock('../../components/offline-status-badge', () => ({ OfflineStatusBadge: () => null }));
jest.mock('../../components/edit-posting-modal', () => {
  const { Text } = require('react-native');
  return { EditPostingModal: ({ bounty }: { bounty: { title: string } }) => <Text>{`Editing ${bounty.title}`}</Text> };
});

// The global react-native mock renders Modal children whether or not it is
// visible, and FlatList never calls renderItem; give this suite versions that
// behave like the real ones for what it checks.
{
  const RN = require('react-native');
  RN.Modal = ({ visible, children }: { visible: boolean; children: React.ReactNode }) =>
    visible ? React.createElement('Modal', {}, children) : null;
  RN.FlatList = function MiniFlatList({ data = [], renderItem, keyExtractor, ListEmptyComponent }: any) {
    if (data.length === 0 && ListEmptyComponent) {
      return React.isValidElement(ListEmptyComponent) ? ListEmptyComponent : React.createElement(ListEmptyComponent);
    }
    return React.createElement(
      'FlatList',
      {},
      data.map((item: any, index: number) =>
        React.createElement(React.Fragment, { key: keyExtractor ? keyExtractor(item, index) : index }, renderItem({ item, index }))
      )
    );
  };
}

import { MyJobsScreen } from '../../app/tabs/my-jobs-screen';
import { BountyRefundFailedError } from '../../lib/services/bounty-cancel-refund';
import { resetRemovedBountiesRegistry } from '../../lib/utils/bounty-visibility';
import { ROUTES } from '../../lib/routes';

const now = new Date().toISOString();
const GARAGE = { id: 'b-garage', status: 'open', title: 'Clear the garage', amount: 60, poster_id: 'me', created_at: now };
const LEAVES = { id: 'b-leaves', status: 'open', title: 'Rake leaves', amount: 20, poster_id: 'me', created_at: now };
const offer = (hunter: string, name: string) => ({
  id: `r-${hunter}`,
  bounty_id: 'b-garage',
  hunter_id: hunter,
  status: 'pending',
  created_at: now,
  message: `Hi, I'm ${name}`,
  profile: { username: name, avatar: null },
});

let alertSpy: jest.SpyInstance;

/** Presses a button on the most recent Alert. */
function pressAlert(text: string) {
  const call = alertSpy.mock.calls.at(-1)!;
  const button = (call[2] ?? []).find((b: { text: string }) => b.text === text);
  if (!button) throw new Error(`No "${text}" button on alert "${call[0]}"`);
  return act(async () => {
    await button.onPress?.();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  // Taking a job down marks it removed in a module-level registry.
  resetRemovedBountiesRegistry();
  mockStore.clear();
  mockConversations = [];
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  mockGetByUserId.mockResolvedValue([GARAGE, LEAVES]);
  mockHunterRequests.mockResolvedValue([]);
  mockBatch.mockResolvedValue([offer('h1', 'Ana'), offer('h2', 'Ben')]);
  mockGetAll.mockResolvedValue([]);
  mockUpdate.mockImplementation(async (id: string, patch: object) => ({ id, ...patch }));
  mockPlan.mockResolvedValue({ refundAmount: 0, destination: null });
  mockCancel.mockResolvedValue({});
  mockWithdraw.mockResolvedValue({ applicationId: 'r' });
});

async function renderMyJobs(props: Partial<React.ComponentProps<typeof MyJobsScreen>> = {}) {
  const setActiveScreen = jest.fn();
  const view = render(<MyJobsScreen setActiveScreen={setActiveScreen} {...props} />);
  await waitFor(() => expect(mockGetByUserId).toHaveBeenCalled());
  return { view, setActiveScreen };
}

describe('My Jobs — the featured job', () => {
  it('features the job with offers, and the CTA opens its workspace (F.1 → C)', async () => {
    await renderMyJobs();
    const card = await screen.findByTestId('featured-job-card');
    expect(within(card).getByText('Clear the garage')).toBeTruthy();
    expect(within(card).getByText('2 people want to help')).toBeTruthy();
    expect(screen.getByText("Here's the job that needs you today.")).toBeTruthy();
    // Poster-only account: no side labels.
    expect(screen.queryByTestId('side-label-posted')).toBeNull();
    // The applicants sheet is closed, so nothing counts as viewed yet.
    expect(mockListViews.mock.calls.every(([args]) => args.enabled === false)).toBe(true);

    fireEvent.press(within(card).getByText('Review the 2 people'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/postings/[bountyId]', params: { bountyId: 'b-garage' } });
  });

  it('Who offered (from a link) opens each person in the workspace', async () => {
    await renderMyJobs({ initialTab: 'requests' });
    const sheet = await screen.findByTestId('applicants-sheet');
    expect(screen.getByText('“Hi, I\'m Ana”')).toBeTruthy();
    expect(mockListViews.mock.calls.at(-1)![0].enabled).toBe(true);
    // An applicant's row never offers to delete the whole job (audit 2026-11-14, fix 5).
    expect(within(sheet).queryByText('Take this job down')).toBeNull();
    fireEvent(within(sheet).getByTestId('applicant-row-h1'), 'longPress');
    expect(mockCancel).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId('applicant-row-h1'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/postings/[bountyId]', params: { bountyId: 'b-garage', person: 'r-h1' } });
  });

  it('when the main action is a message, "See the job" opens the workspace (G)', async () => {
    mockGetByUserId.mockResolvedValue([{ ...GARAGE, status: 'in_progress', accepted_by: 'ada' }]);
    mockBatch.mockResolvedValue([]);
    mockConversations = [{ id: 'c', bountyId: 'b-garage', isGroup: false, name: 'Ada R.', participantIds: ['me', 'ada'], lastMessage: 'Saturday at 9', unread: 0 }];
    await renderMyJobs();
    expect(await screen.findByText('Message Ada')).toBeTruthy();
    fireEvent.press(screen.getByTestId('featured-job-open'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/postings/[bountyId]', params: { bountyId: 'b-garage' } });
  });

  it('the header keeps the way into every conversation', async () => {
    await renderMyJobs();
    fireEvent.press(await screen.findByTestId('my-jobs-messages'));
    expect(mockPush).toHaveBeenCalledWith(ROUTES.TABS.MESSENGER);
    expect(screen.getByLabelText('Messages, 3 unread')).toBeTruthy();
  });

  it('labels each side when the account has jobs on both', async () => {
    const tv = { id: 'b-tv', status: 'in_progress', title: 'Mount a TV', amount: 80, poster_id: 'jordan', username: 'Jordan K.', accepted_by: 'me', created_at: now };
    mockHunterRequests.mockResolvedValue([{ id: 'r-tv', bounty_id: 'b-tv', hunter_id: 'me', status: 'accepted', created_at: now, bounty: tv }]);
    await renderMyJobs();
    const card = await screen.findByTestId('featured-job-card');
    await waitFor(() => expect(within(card).getByTestId('side-label-doing')).toBeTruthy());
  });
});

describe('My Jobs — switching', () => {
  it('lists every job and remembers a pick', async () => {
    await renderMyJobs();
    fireEvent.press(await screen.findByTestId('other-jobs-bar'));
    const sheet = await screen.findByTestId('job-switcher-sheet');
    expect(within(sheet).getByText('Rake leaves')).toBeTruthy();
    fireEvent.press(within(sheet).getByText('Rake leaves'));
    await waitFor(() => expect(within(screen.getByTestId('featured-job-card')).getByText('Rake leaves')).toBeTruthy());
    expect(screen.getByText('You picked this job.')).toBeTruthy();
    await waitFor(() => expect(mockStore.get('@bounty/my_jobs_featured_pick/me')).toContain('posted:b-leaves'));
  });
});

describe('My Jobs — managing a job', () => {
  async function openLeavesMenu() {
    await renderMyJobs();
    fireEvent.press(await screen.findByTestId('other-jobs-bar'));
    fireEvent.press(await screen.findByTestId('switcher-more-posted:b-leaves'));
  }

  it('take down asks first, refunds once, then removes', async () => {
    await openLeavesMenu();
    fireEvent.press(screen.getByTestId('manage-action-take_down'));
    const yes = await screen.findByTestId('confirm-dialog-yes');
    expect(screen.getByText('Take this job down?')).toBeTruthy();
    expect(screen.getByLabelText("Your money. You haven't been charged, so there's nothing to refund.")).toBeTruthy();
    expect(mockCancel).not.toHaveBeenCalled();

    let release!: () => void;
    mockCancel.mockReturnValueOnce(new Promise<void>((r) => (release = r)));
    // A double tap refunds once.
    fireEvent.press(yes);
    fireEvent.press(yes);
    await act(async () => release());
    expect(mockCancel).toHaveBeenCalledTimes(1);
    expect(mockCancel.mock.calls[0][0]).toMatchObject({ id: 'b-leaves' });
  });

  it('a failed refund stops the take-down', async () => {
    mockCancel.mockRejectedValueOnce(new BountyRefundFailedError('nope' as never));
    await openLeavesMenu();
    fireEvent.press(screen.getByTestId('manage-action-take_down'));
    const callsBefore = mockGetByUserId.mock.calls.length;
    const yes = await screen.findByTestId('confirm-dialog-yes');
    await act(async () => fireEvent.press(yes));
    expect(alertSpy.mock.calls.at(-1)![0]).toBe('Refund failed');
    // Not reloaded as if it were gone.
    expect(mockGetByUserId.mock.calls.length).toBe(callsBefore);
  });

  it('edit opens the edit form for a job nobody has offered on', async () => {
    await openLeavesMenu();
    fireEvent.press(screen.getByTestId('manage-action-edit'));
    expect(await screen.findByText('Editing Rake leaves')).toBeTruthy();
  });

  it('edit on a job with offers explains the lock instead', async () => {
    await renderMyJobs();
    fireEvent.press(await screen.findByTestId('featured-job-options'));
    fireEvent.press(screen.getByTestId('manage-action-edit'));
    expect(alertSpy.mock.calls.at(-1)![0]).toBe('Details are locked');
    expect(screen.queryByText('Editing Clear the garage')).toBeNull();
  });

  it('a cancelled job can be removed, a finished one archived', async () => {
    mockGetByUserId.mockResolvedValue([
      { ...LEAVES, status: 'cancelled' },
      { ...GARAGE, status: 'completed', accepted_by: 'ada' },
    ]);
    mockBatch.mockResolvedValue([]);
    await renderMyJobs();
    fireEvent.press(await screen.findByTestId('other-jobs-bar'));
    fireEvent.press(await screen.findByTestId('switcher-finished-toggle'));

    fireEvent.press(screen.getByTestId('switcher-more-posted:b-leaves'));
    fireEvent.press(screen.getByTestId('manage-action-discard_cancelled'));
    await pressAlert('Remove');
    expect(mockUpdate).toHaveBeenCalledWith('b-leaves', { status: 'deleted' });

    // Only the just-finished job is left, featured; it archives from Other options.
    await waitFor(() => expect(screen.queryByTestId('other-jobs-bar')).toBeNull());
    fireEvent.press(screen.getByTestId('featured-job-options'));
    fireEvent.press(screen.getByTestId('manage-action-archive'));
    await pressAlert('Archive');
    expect(mockUpdate).toHaveBeenCalledWith('b-garage', { status: 'archived' });
  });
});

describe('My Jobs — your offers', () => {
  it('withdraws a waiting offer after confirming', async () => {
    mockGetByUserId.mockResolvedValue([])
    mockBatch.mockResolvedValue([])
    const wardrobe = { id: 'b-wardrobe', status: 'open', title: 'Assemble a wardrobe', amount: 50, poster_id: 'sofia', username: 'Sofia L.', created_at: now };
    mockHunterRequests.mockResolvedValue([{ id: 'r-w', bounty_id: 'b-wardrobe', hunter_id: 'me', status: 'pending', created_at: now, bounty: wardrobe }]);
    await renderMyJobs();
    // Only an offer: nothing is featured, and nothing needs you.
    expect(await screen.findByTestId('my-jobs-nothing')).toBeTruthy();
    fireEvent.press(screen.getByTestId('other-jobs-bar'));
    fireEvent.press(await screen.findByTestId('offer-action-withdraw-b-wardrobe'));
    expect(screen.getByText('Withdraw your offer?')).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByTestId('confirm-dialog-yes')));
    expect(mockWithdraw).toHaveBeenCalledWith({ bountyId: 'b-wardrobe', currentUserId: 'me', surface: 'inbox' });
  });
});

describe('My Jobs — an offer opens its own screen', () => {
  it.each(['pending', 'rejected'])('%s', async (status) => {
    mockGetByUserId.mockResolvedValue([]);
    mockBatch.mockResolvedValue([]);
    const sofa = { id: 'b-sofa', status: 'open', title: 'Carry a sofa', amount: 40, poster_id: 'dan', username: 'Dan P.', created_at: now };
    mockHunterRequests.mockResolvedValue([{ id: 'r-s', bounty_id: 'b-sofa', hunter_id: 'me', status, created_at: now, bounty: sofa }]);
    await renderMyJobs();
    fireEvent.press(await screen.findByTestId('other-jobs-bar'));
    fireEvent.press(await screen.findByTestId('offer-open-b-sofa'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/in-progress/[bountyId]/hunter', params: { bountyId: 'b-sofa' } });
  });
});

describe('My Jobs — the offers row', () => {
  it('with one job and some offers, the bar opens Your offers as it says', async () => {
    mockGetByUserId.mockResolvedValue([LEAVES]);
    mockBatch.mockResolvedValue([]);
    const wardrobe = { id: 'b-wardrobe', status: 'open', title: 'Assemble a wardrobe', amount: 50, poster_id: 'sofia', username: 'Sofia L.', created_at: now };
    mockHunterRequests.mockResolvedValue([{ id: 'r-w', bounty_id: 'b-wardrobe', hunter_id: 'me', status: 'pending', created_at: now, bounty: wardrobe }]);
    await renderMyJobs();
    const bar = await screen.findByTestId('other-jobs-bar');
    expect(within(bar).getByText('Your offers · 1 waiting')).toBeTruthy();
    fireEvent.press(bar);
    expect(await screen.findByTestId('your-offers-sheet')).toBeTruthy();
    expect(screen.queryByTestId('job-switcher-sheet')).toBeNull();
  });
});

describe('My Jobs — a failed reload keeps what was shown', () => {
  it('keeps the jobs and says it could not load', async () => {
    await renderMyJobs();
    await screen.findByTestId('featured-job-card');
    mockGetByUserId.mockRejectedValue(new Error('offline'));
    await act(async () => {
      await screen.getByTestId('my-jobs-scroll').props.refreshControl.props.onRefresh();
    });
    expect(screen.getByTestId('featured-job-card')).toBeTruthy();
    expect(screen.getByText("We couldn't load your jobs.")).toBeTruthy();
    expect(screen.queryByTestId('my-jobs-empty')).toBeNull();
  });
});

describe('My Jobs — empty, error and links', () => {
  it('a brand-new account sees how it works and can post', async () => {
    mockGetByUserId.mockResolvedValue([]);
    mockBatch.mockResolvedValue([]);
    const { setActiveScreen } = await renderMyJobs();
    fireEvent.press(await screen.findByTestId('my-jobs-post-first'));
    expect(setActiveScreen).toHaveBeenCalledWith('postings');
  });

  it("couldn't load: says nothing changed, and Try again reloads", async () => {
    mockGetByUserId.mockRejectedValue(new Error('offline'));
    await renderMyJobs();
    expect(await screen.findByText('Nothing about your jobs has changed.')).toBeTruthy();
    const before = mockGetByUserId.mock.calls.length;
    await act(async () => fireEvent.press(screen.getByTestId('my-jobs-retry')));
    expect(mockGetByUserId.mock.calls.length).toBeGreaterThan(before);
  });

  it('a "requests" link (new offer, Review hunters) opens Who offered', async () => {
    await renderMyJobs({ initialTab: 'requests' });
    expect(await screen.findByTestId('applicants-sheet')).toBeTruthy();
  });

  it('a link naming a job opens that job, not the first one with offers', async () => {
    mockBatch.mockResolvedValue([
      offer('h1', 'Ana'),
      { ...offer('h9', 'Zed'), id: 'r-h9', bounty_id: 'b-leaves' },
    ]);
    await renderMyJobs({ initialTab: 'requests', linkBountyId: 'b-leaves' });
    const sheet = await screen.findByTestId('applicants-sheet');
    expect(within(sheet).getByText('Rake leaves')).toBeTruthy();
    expect(within(sheet).getByTestId('applicant-row-h9')).toBeTruthy();
    expect(within(sheet).queryByTestId('applicant-row-h1')).toBeNull();
  });

  it("a link's choice is shown, never saved over the user's own pick", async () => {
    mockStore.set('@bounty/my_jobs_featured_pick/me', JSON.stringify({ key: 'posted:b-garage', outranking: [] }));
    await renderMyJobs({ initialTab: 'myPostings', linkBountyId: 'b-leaves' });
    await waitFor(() => expect(within(screen.getByTestId('featured-job-card')).getByText('Rake leaves')).toBeTruthy());
    expect(screen.queryByText('You picked this job.')).toBeNull();
    expect(mockStore.get('@bounty/my_jobs_featured_pick/me')).toContain('posted:b-garage');
  });

  it('waits until the tab is showing before opening Who offered', async () => {
    const { view } = await renderMyJobs({ initialTab: 'requests', isActive: false });
    await screen.findByTestId('featured-job-card');
    expect(screen.queryByTestId('applicants-sheet')).toBeNull();
    view.rerender(<MyJobsScreen setActiveScreen={jest.fn()} initialTab="requests" isActive />);
    expect(await screen.findByTestId('applicants-sheet')).toBeTruthy();
  });
});
