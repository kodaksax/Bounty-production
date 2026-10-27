/**
 * The Inbox reloads when something opened over the tab shell (a bounty
 * thread, the hunter hub) is popped — silently, and only once it is the tab
 * in view.
 *
 * It used to run its pull-to-refresh path, which turns the RefreshControl
 * spinner on from code: on iOS that shifts the list by the spinner's height
 * on every Back. And it ran for every Back anywhere in the shell, even with
 * another tab showing. It also never re-read the hunter's hidden set, so a
 * card discarded from the hunter hub stayed on the mounted list.
 */
import { NavigationContext } from '@react-navigation/native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';
import { lightTheme } from '../../lib/themes/lightTheme';

const mockGetByUserId = jest.fn();
const mockLoadHidden = jest.fn();

jest.mock('../../hooks/useValidUserId', () => ({ useValidUserId: () => 'hunter-1' }));
jest.mock('../../hooks/useApplicantListViewed', () => ({ useApplicantListViewed: jest.fn() }));
jest.mock('../../hooks/useConversations', () => ({
  useConversations: () => ({ conversations: [], loading: false, refresh: jest.fn(() => Promise.resolve()) }),
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
jest.mock('lib/utils/hunter-hidden-bounties', () => ({
  ...jest.requireActual('lib/utils/hunter-hidden-bounties'),
  loadHunterHiddenBountyIds: (...a: unknown[]) => mockLoadHidden(...a),
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
import { useReturnToTabShell, type TabShellTarget } from '../../lib/navigation/tab-shell-return';

type Listener = () => void;
function fakeNavigation() {
  const listeners: Record<'focus' | 'blur', Set<Listener>> = { focus: new Set(), blur: new Set() };
  return {
    isFocused: () => true,
    // The shell is the screen on top, as when the Inbox is showing.
    getParent: () => undefined,
    getState: () => ({ key: 'tabs', index: 0, routes: [{ key: 'shell', name: 'bounty-app' }] }),
    dispatch: jest.fn(),
    addListener: (event: 'focus' | 'blur', cb: Listener) => {
      listeners[event].add(cb);
      return () => listeners[event].delete(cb);
    },
    emit(event: 'focus' | 'blur') {
      listeners[event].forEach(cb => cb());
    },
  };
}

let returnToTabShell: (target?: TabShellTarget) => void = () => {};
function ReturnProbe() {
  returnToTabShell = useReturnToTabShell();
  return null;
}

function renderInbox(nav: ReturnType<typeof fakeNavigation>, isActive: boolean, initialTab?: string) {
  const element = (active: boolean) => (
    <NavigationContext.Provider value={nav as never}>
      <InboxScreen activeScreen="messages" setActiveScreen={jest.fn()} isActive={active} initialTab={initialTab} />
      <ReturnProbe />
    </NavigationContext.Provider>
  );
  const view = render(element(isActive));
  return { ...view, setActive: (active: boolean) => view.rerender(element(active)) };
}

/** The segment lists only render once their pager has been measured. */
function layOutPager(root: any) {
  const pager = root.find(
    (node: any) => typeof node.type === 'string' && node.props?.style?.overflow === 'hidden' && node.props?.onLayout
  );
  act(() => pager.props.onLayout({ nativeEvent: { layout: { width: 390, height: 700 } } }));
}

/** The `refreshing` flag of every list's RefreshControl (handed over as a prop, not rendered). */
function refreshingValues(root: any): unknown[] {
  return root
    .findAll((node: any) => node.props?.refreshControl?.props?.refreshing !== undefined)
    .map((node: any) => node.props.refreshControl.props.refreshing);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetByUserId.mockResolvedValue([]);
  mockLoadHidden.mockResolvedValue(new Set());
});

describe('InboxScreen refresh on return', () => {
  it('reloads silently when a screen opened over it is popped', async () => {
    const nav = fakeNavigation();
    const { UNSAFE_root } = renderInbox(nav, true);
    await waitFor(() => expect(mockGetByUserId).toHaveBeenCalledTimes(1));
    layOutPager(UNSAFE_root);
    const hiddenLoadsBefore = mockLoadHidden.mock.calls.length;

    // Hold the reload in flight so the spinner state can be observed.
    mockGetByUserId.mockReturnValue(new Promise(() => {}));
    act(() => nav.emit('blur'));
    act(() => nav.emit('focus'));

    expect(mockGetByUserId).toHaveBeenCalledTimes(2);
    expect(mockLoadHidden.mock.calls.length).toBe(hiddenLoadsBefore + 1);
    expect(refreshingValues(UNSAFE_root).length).toBeGreaterThan(0);
    expect(refreshingValues(UNSAFE_root)).not.toContain(true);
  });

  it('holds the reload while another tab is showing, and runs it when the Inbox is shown', async () => {
    const nav = fakeNavigation();
    const { setActive } = renderInbox(nav, false);
    await waitFor(() => expect(mockGetByUserId).toHaveBeenCalledTimes(1));

    act(() => nav.emit('blur'));
    act(() => nav.emit('focus'));
    expect(mockGetByUserId).toHaveBeenCalledTimes(1);

    setActive(true);
    await waitFor(() => expect(mockGetByUserId).toHaveBeenCalledTimes(2));
  });
});

describe('InboxScreen segment on return', () => {
  const selected = (view: ReturnType<typeof render>, label: string) =>
    view.getByLabelText(label).props.accessibilityState?.selected;

  it('Back from a thread keeps the segment the user moved to', async () => {
    const nav = fakeNavigation();
    const view = renderInbox(nav, true);
    await waitFor(() => expect(mockGetByUserId).toHaveBeenCalledTimes(1));

    fireEvent.press(view.getByLabelText('My Bounties'));
    expect(selected(view, 'My Bounties')).toBe(true);

    act(() => nav.emit('blur'));
    act(() => nav.emit('focus'));
    await waitFor(() => expect(mockGetByUserId).toHaveBeenCalledTimes(2));
    await act(async () => {});
    expect(selected(view, 'My Bounties')).toBe(true);
  });

  it('a flow returning to a segment selects it, even when it repeats the last request', async () => {
    // Opened on My Work by an earlier link (the prop keeps that value).
    const nav = fakeNavigation();
    const view = renderInbox(nav, true, 'inProgress');
    await waitFor(() => expect(mockGetByUserId).toHaveBeenCalled());
    expect(selected(view, 'My Work')).toBe(true);

    fireEvent.press(view.getByLabelText('My Bounties'));
    expect(selected(view, 'My Bounties')).toBe(true);

    // Discarding an application from the hunter hub returns to My Work.
    act(() => returnToTabShell({ tab: 'messages', initialTab: 'inProgress' }));
    expect(selected(view, 'My Work')).toBe(true);
  });

  it('a request for another tab leaves the segment alone', async () => {
    const nav = fakeNavigation();
    const view = renderInbox(nav, true);
    await waitFor(() => expect(mockGetByUserId).toHaveBeenCalled());
    fireEvent.press(view.getByLabelText('My Bounties'));

    act(() => returnToTabShell({ tab: 'bounty' }));
    expect(selected(view, 'My Bounties')).toBe(true);
  });
});
