/**
 * Regression tests: a bounty that is completed, removed or otherwise no longer
 * eligible for the open feed must not come back.
 *
 * The reported bug was that such a bounty disappeared correctly, and then
 * reappeared once the user navigated to another tab and back — the feed trusted
 * the `status = 'open'` query it issued and merged whatever rows came back into
 * state without re-applying any lifecycle rule. These tests pin the two
 * guarantees that fix it: every fetched page is filtered through
 * lib/utils/bounty-visibility, and a bounty this client just saw become
 * ineligible stays out even if a later (stale/cached) response still lists it.
 */

// Match the loading-resilience suite: a short network timeout keeps the
// resilience paths fast under real timers, restored in afterAll.
const PREV_API_TIMEOUT = process.env.API_TIMEOUT;
process.env.API_TIMEOUT = '150';

import { act, cleanup, render, waitFor } from '@testing-library/react-native';
import React from 'react';

// --- Rich react-native mock (the global jest.setup mock lacks Animated.FlatList
// / RefreshControl / Animated.event that this component relies on). ---
jest.mock('react-native', () => {
  const ReactMock = require('react');
  const passthrough =
    (name: string) =>
    ({ children, ...props }: any) =>
      ReactMock.createElement(name, props, children);

  // Minimal FlatList that exercises ListEmptyComponent / renderItem so tests can
  // observe skeleton vs empty vs error states.
  const FlatList = ReactMock.forwardRef((props: any, _ref: any) => {
    const {
      data = [],
      renderItem,
      ListEmptyComponent,
      ListHeaderComponent,
      ListFooterComponent,
      keyExtractor,
    } = props;
    const header = ListHeaderComponent
      ? ReactMock.createElement(
          typeof ListHeaderComponent === 'function'
            ? ListHeaderComponent
            : () => ListHeaderComponent
        )
      : null;
    const footer = ListFooterComponent
      ? ReactMock.createElement(
          typeof ListFooterComponent === 'function'
            ? ListFooterComponent
            : () => ListFooterComponent
        )
      : null;
    let body: any;
    if (!data || data.length === 0) {
      body = ListEmptyComponent
        ? ReactMock.createElement(
            typeof ListEmptyComponent === 'function' ? ListEmptyComponent : () => ListEmptyComponent
          )
        : null;
    } else {
      body = data.map((item: any, index: number) =>
        ReactMock.createElement(
          ReactMock.Fragment,
          { key: keyExtractor ? keyExtractor(item, index) : index },
          renderItem ? renderItem({ item, index }) : null
        )
      );
    }
    return ReactMock.createElement('FlatList', {}, header, body, footer);
  });

  // The search row animates its focus ring on mount, so the driver methods it
  // touches have to exist here — they resolve immediately rather than tick.
  const immediate = () => ({ start: (cb?: () => void) => cb?.() });
  const Animated = {
    Value: jest.fn().mockImplementation((value: number) => ({
      _value: value,
      setValue: jest.fn(),
      interpolate: jest.fn().mockReturnValue(value),
    })),
    event: jest.fn().mockReturnValue(jest.fn()),
    createAnimatedComponent: (c: any) => c,
    timing: jest.fn(immediate),
    spring: jest.fn(immediate),
    parallel: jest.fn(immediate),
    sequence: jest.fn(immediate),
    stagger: jest.fn(immediate),
    loop: jest.fn(() => ({ start: jest.fn(), stop: jest.fn() })),
    View: passthrough('Animated.View'),
    FlatList,
  };

  return {
    Platform: { OS: 'ios', select: (obj: any) => obj.ios ?? obj.default },
    StyleSheet: { create: (s: any) => s, flatten: (s: any) => s },
    Dimensions: { get: () => ({ width: 375, height: 812 }) },
    useWindowDimensions: () => ({ width: 375, height: 812, scale: 2, fontScale: 1 }),
    // AppModal's keyboard avoidance subscribes on mount (see
    // components/ui/keyboard-avoiding); the listener never fires here.
    Keyboard: { addListener: () => ({ remove: () => {} }), dismiss: () => {} },
    Animated,
    FlatList,
    RefreshControl: passthrough('RefreshControl'),
    View: passthrough('View'),
    Text: passthrough('Text'),
    TouchableOpacity: passthrough('TouchableOpacity'),
    ScrollView: passthrough('ScrollView'),
    Alert: { alert: jest.fn() },
    // The progress cards above the feed are draggable.
    PanResponder: { create: () => ({ panHandlers: {} }) },
    Easing: {
      in: (fn: any) => fn,
      out: (fn: any) => fn,
      inOut: (fn: any) => fn,
      cubic: (t: number) => t,
      ease: (t: number) => t,
    },
    AccessibilityInfo: {
      isReduceMotionEnabled: jest.fn().mockResolvedValue(false),
      addEventListener: jest.fn().mockReturnValue({ remove: jest.fn() }),
    },
  };
});

// --- Lightweight child-component + native module mocks. ---
jest.mock('expo-linear-gradient', () => ({
  LinearGradient: ({ children }: any) => require('react').createElement('View', {}, children),
}));
jest.mock('@expo/vector-icons', () => ({ MaterialIcons: () => null }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('../../components/notifications/notification-bell', () => ({ NotificationBell: () => null }));
jest.mock('../../components/ui/branding-logo', () => ({ BrandingLogo: () => null }));
jest.mock('../../components/ui/wallet-balance-button', () => ({ WalletBalanceButton: () => null }));
jest.mock('../../components/bounty-compact-item', () => ({
  BountyCompactItem: ({ bounty }: any) =>
    require('react').createElement('Text', { testID: 'bounty-item' }, bounty?.title),
}));
jest.mock('../../components/bounty-grid-feed', () => ({
  BountyGridFeed: ({ bounties = [] }: any) =>
    require('react').createElement(
      'View',
      {},
      bounties.map((b: any) =>
        require('react').createElement('Text', { key: b.id, testID: 'bounty-item' }, b.title)
      )
    ),
}));
jest.mock('../../components/bounty-list-item', () => ({
  BountyListItem: ({ title }: any) =>
    require('react').createElement('Text', { testID: 'bounty-item' }, title),
}));
jest.mock('../../components/ui/skeleton-loaders', () => ({
  PostingsListSkeleton: () => require('react').createElement('View', { testID: 'skeleton' }),
}));
jest.mock('../../components/ui/empty-state', () => ({
  EmptyState: ({ title }: any) =>
    require('react').createElement('Text', { testID: 'empty-state' }, title),
}));

jest.mock('../../hooks/useValidUserId', () => ({ useValidUserId: () => 'user-123' }));
jest.mock(
  'app/hooks/useLocation',
  () => ({ useLocation: () => ({ location: null, permission: { granted: false } }) }),
  { virtual: true }
);

jest.mock('../../lib/services/location-service', () => ({
  locationService: { calculateDistance: jest.fn().mockReturnValue(1) },
}));
jest.mock('../../lib/storage', () => ({
  storage: {
    getItem: jest.fn().mockResolvedValue(null),
    setItem: jest.fn().mockResolvedValue(undefined),
  },
}));
jest.mock('../../lib/services/search-service', () => ({
  searchService: { getTrendingBounties: jest.fn().mockResolvedValue([]) },
}));
jest.mock('../../lib/services/bounty-service', () => ({
  bountyService: {
    getAll: jest.fn(),
    getById: jest.fn(),
    getOpenCount: jest.fn().mockResolvedValue(0),
  },
}));
jest.mock('../../lib/services/bounty-request-service', () => ({
  bountyRequestService: { getAll: jest.fn() },
}));
jest.mock('../../lib/services/completion-service', () => ({
  completionService: { getLatestSubmissionsForBounties: jest.fn() },
}));
// The progress cards render as "<id>:<stage>" so tests can read what the feed
// handed them; sortByProgress stays real.
jest.mock('../../components/my-bounty-progress-banner', () => ({
  ...jest.requireActual('../../components/my-bounty-progress-banner'),
  MyBountyProgressCarousel: ({ items }: any) =>
    require('react').createElement(
      'View',
      {},
      items.map((i: any) =>
        require('react').createElement(
          'Text',
          { key: i.bounty.id, testID: 'progress-card' },
          `${i.bounty.id}:${i.stage}`
        )
      )
    ),
}));
// Realtime mock that records the handlers the feed registers, so a test can
// deliver a bounties UPDATE/DELETE the way Supabase would.
const realtimeHandlers: { event: string; handler: (payload: any) => void }[] = [];
jest.mock('../../lib/supabase', () => {
  const channel: any = {
    on: jest.fn((_type: string, config: any, handler: any) => {
      realtimeHandlers.push({ event: config?.event, handler });
      return channel;
    }),
    subscribe: jest.fn(() => channel),
    unsubscribe: jest.fn(),
  };
  return {
    supabase: {
      channel: jest.fn(() => channel),
      removeChannel: jest.fn(() => channel),
    },
  };
});

function emitRealtime(event: string, payload: any) {
  realtimeHandlers
    .filter(h => h.event === event)
    .forEach(h => {
      act(() => {
        h.handler(payload);
      });
    });
}

// Lazily required after env + mocks are in place.
let BountyFeed: any;
let bountyService: any;
let bountyRequestService: any;
let completionService: any;
let resetRemovedBountiesRegistry: () => void;

const openBounty = (over: Record<string, unknown> = {}) => ({
  id: '1',
  title: 'Fix my bike',
  amount: 50,
  is_for_honor: false,
  work_type: 'in_person',
  status: 'open',
  ...over,
});

const renderFeed = (ref?: React.Ref<any>) =>
  render(
    React.createElement(BountyFeed, {
      ref,
      activeScreen: 'bounty',
      setActiveScreen: jest.fn(),
      currentUserId: 'user-123',
    })
  );

const titles = (queryAllByTestId: any) =>
  queryAllByTestId('bounty-item').map((n: any) => n.props.children);

// Open-feed page loads only — excludes the "your bounty in progress" banner's
// own getAll({ status: 'in_progress' }) lookup.
const feedLoadCalls = () =>
  bountyService.getAll.mock.calls.filter((c: any[]) => c[0]?.status === 'open').length;

describe('BountyFeed lifecycle visibility', () => {
  beforeAll(() => {
    ({ BountyFeed } = require('../../components/bounty-feed'));
    ({ bountyService } = require('../../lib/services/bounty-service'));
    ({ bountyRequestService } = require('../../lib/services/bounty-request-service'));
    ({ completionService } = require('../../lib/services/completion-service'));
    ({ resetRemovedBountiesRegistry } = require('../../lib/utils/bounty-visibility'));
  });

  beforeEach(() => {
    jest.clearAllMocks();
    realtimeHandlers.length = 0;
    resetRemovedBountiesRegistry();
    bountyRequestService.getAll.mockResolvedValue([]);
    completionService.getLatestSubmissionsForBounties.mockResolvedValue(new Map());
  });

  afterEach(() => {
    cleanup();
  });

  afterAll(() => {
    if (PREV_API_TIMEOUT === undefined) {
      delete process.env.API_TIMEOUT;
    } else {
      process.env.API_TIMEOUT = PREV_API_TIMEOUT;
    }
  });

  it('never renders a bounty the backend returns in a terminal state', async () => {
    bountyService.getAll.mockResolvedValue([
      openBounty({ id: '1', title: 'Still open' }),
      openBounty({ id: '2', title: 'Already completed', status: 'completed' }),
      openBounty({ id: '3', title: 'Removed by poster', status: 'deleted' }),
      openBounty({ id: '4', title: 'Cancelled', status: 'cancelled' }),
    ]);

    const { queryAllByTestId } = renderFeed();

    await waitFor(() => {
      expect(titles(queryAllByTestId)).toContain('Still open');
    });
    expect(titles(queryAllByTestId)).toEqual(['Still open']);
  });

  it('keeps a completed bounty out after a refresh still returns its stale open row', async () => {
    bountyService.getAll.mockResolvedValue([
      openBounty({ id: '1', title: 'Still open' }),
      openBounty({ id: '2', title: 'About to complete' }),
    ]);

    const ref = React.createRef<any>();
    const { queryAllByTestId } = renderFeed(ref);

    await waitFor(() => {
      expect(titles(queryAllByTestId)).toEqual(
        expect.arrayContaining(['Still open', 'About to complete'])
      );
    });

    // The bounty is completed elsewhere (detail screen / other device).
    emitRealtime('UPDATE', { new: { id: '2', title: 'About to complete', status: 'completed' } });
    await waitFor(() => {
      expect(titles(queryAllByTestId)).toEqual(['Still open']);
    });

    // Navigating away and back re-runs the feed's loaders. A response that is
    // stale (in flight before the mutation, or served from a cache/replica)
    // must not resurrect it.
    act(() => {
      ref.current.refresh();
    });

    await waitFor(() => {
      expect(feedLoadCalls()).toBe(2);
    });
    await waitFor(() => {
      expect(titles(queryAllByTestId)).toEqual(['Still open']);
    });
  });

  it('keeps a deleted bounty out after a refresh still returns it', async () => {
    bountyService.getAll.mockResolvedValue([
      openBounty({ id: '1', title: 'Still open' }),
      openBounty({ id: '2', title: 'Deleted by poster' }),
    ]);

    const ref = React.createRef<any>();
    const { queryAllByTestId } = renderFeed(ref);

    await waitFor(() => {
      expect(titles(queryAllByTestId)).toHaveLength(2);
    });

    emitRealtime('DELETE', { old: { id: '2' } });
    await waitFor(() => {
      expect(titles(queryAllByTestId)).toEqual(['Still open']);
    });

    act(() => {
      ref.current.refresh();
    });

    await waitFor(() => {
      expect(feedLoadCalls()).toBe(2);
    });
    await waitFor(() => {
      expect(titles(queryAllByTestId)).toEqual(['Still open']);
    });
  });

  it('shows a bounty again once the backend reports it reopened', async () => {
    bountyService.getAll.mockResolvedValue([
      openBounty({ id: '1', title: 'Still open' }),
      openBounty({ id: '2', title: 'Claimed then released' }),
    ]);

    const ref = React.createRef<any>();
    const { queryAllByTestId } = renderFeed(ref);

    await waitFor(() => {
      expect(titles(queryAllByTestId)).toHaveLength(2);
    });

    emitRealtime('UPDATE', { new: { id: '2', title: 'Claimed then released', status: 'in_progress' } });
    await waitFor(() => {
      expect(titles(queryAllByTestId)).toEqual(['Still open']);
    });

    // The acceptance was withdrawn: the authoritative state is open again, so
    // the local suppression must be lifted rather than outliving the backend.
    emitRealtime('UPDATE', { new: { id: '2', title: 'Claimed then released', status: 'open' } });
    act(() => {
      ref.current.refresh();
    });

    await waitFor(() => {
      expect(titles(queryAllByTestId)).toEqual(
        expect.arrayContaining(['Still open', 'Claimed then released'])
      );
    });
  });
  describe('newly posted bounties', () => {
    it('renders a new bounty live, even with no details, without a refresh', async () => {
      bountyService.getAll.mockResolvedValue([openBounty({ id: '1', title: 'Still open' })]);
      // Title and price only — no description, location or timing.
      const bare = { id: '9', title: 'Just posted', amount: 10, status: 'open' };
      bountyService.getById.mockResolvedValue({ ...bare, username: 'poster' });

      const { queryAllByTestId, queryByText } = renderFeed();
      await waitFor(() => {
        expect(titles(queryAllByTestId)).toEqual(['Still open']);
      });

      emitRealtime('INSERT', { new: { ...bare, poster_id: 'someone-else' } });

      await waitFor(() => {
        expect(titles(queryAllByTestId)).toEqual(
          expect.arrayContaining(['Still open', 'Just posted'])
        );
      });
      expect(bountyService.getById).toHaveBeenCalledWith('9');
      expect(feedLoadCalls()).toBe(1);
      expect(queryByText(/new bount/)).toBeNull();
    });

    it('does not add the same bounty twice', async () => {
      bountyService.getAll.mockResolvedValue([openBounty({ id: '1', title: 'Still open' })]);
      bountyService.getById.mockResolvedValue(openBounty({ id: '9', title: 'Just posted' }));

      const { queryAllByTestId } = renderFeed();
      await waitFor(() => {
        expect(titles(queryAllByTestId)).toEqual(['Still open']);
      });

      emitRealtime('INSERT', { new: { id: '9', status: 'open' } });
      emitRealtime('INSERT', { new: { id: '9', status: 'open' } });

      await waitFor(() => {
        expect(titles(queryAllByTestId)).toHaveLength(2);
      });
    });

    it('leaves test bounties out, as the feed query does', async () => {
      bountyService.getAll.mockResolvedValue([openBounty({ id: '1', title: 'Still open' })]);

      const { queryAllByTestId } = renderFeed();
      await waitFor(() => {
        expect(titles(queryAllByTestId)).toEqual(['Still open']);
      });

      emitRealtime('INSERT', { new: { id: '9', status: 'open', is_test: true } });

      expect(bountyService.getById).not.toHaveBeenCalled();
      expect(titles(queryAllByTestId)).toEqual(['Still open']);
    });
  });

  describe('your-bounty progress cards', () => {
    const mine = (over: Record<string, unknown>) =>
      openBounty({ poster_id: 'user-123', created_at: '2026-09-01T00:00:00Z', ...over });
    // Progress loads are the getAll calls that pass a statuses allowlist.
    const progressCalls = () =>
      bountyService.getAll.mock.calls.filter((c: any[]) => c[0]?.statuses);
    const cards = (queryAllByTestId: any) =>
      queryAllByTestId('progress-card').map((n: any) => n.props.children);

    it('shows only live bounties, even if the backend ignores the status allowlist', async () => {
      bountyService.getAll.mockImplementation(async (opts: any) =>
        opts?.statuses
          ? [
              mine({ id: 'p1', status: 'open' }),
              mine({ id: 'p2', status: 'completed' }),
              mine({ id: 'p3', status: 'cancelled' }),
            ]
          : []
      );

      const { queryAllByTestId } = renderFeed();

      await waitFor(() => expect(cards(queryAllByTestId)).toEqual(['p1:open']));
    });

    it('pages through every live bounty instead of stopping at the first page', async () => {
      const firstPage = Array.from({ length: 100 }, (_, i) =>
        mine({ id: `o${i}`, created_at: '2026-09-10T00:00:00Z' })
      );
      const older = mine({ id: 'old', status: 'in_progress', created_at: '2026-08-01T00:00:00Z' });
      bountyService.getAll.mockImplementation(async (opts: any) => {
        if (!opts?.statuses) return [];
        return opts.offset === 0 ? firstPage : [older];
      });
      completionService.getLatestSubmissionsForBounties.mockResolvedValue(
        new Map([['old', { status: 'pending' }]])
      );

      const { queryAllByTestId } = renderFeed();

      await waitFor(() => expect(cards(queryAllByTestId)[0]).toBe('old:review'));
      expect(cards(queryAllByTestId)).toHaveLength(101);
      expect(progressCalls().map((c: any[]) => c[0].offset)).toEqual([0, 100]);
    });

    it('keeps the last-known cards and stages when a reload fails', async () => {
      bountyService.getAll.mockImplementation(async (opts: any) =>
        opts?.statuses ? [mine({ id: 'w1', status: 'in_progress' })] : []
      );
      completionService.getLatestSubmissionsForBounties.mockResolvedValue(
        new Map([['w1', { status: 'pending' }]])
      );

      const { queryAllByTestId } = renderFeed();
      await waitFor(() => expect(cards(queryAllByTestId)).toEqual(['w1:review']));

      // Submission lookup fails: the card stays in review, not demoted.
      completionService.getLatestSubmissionsForBounties.mockRejectedValue(new Error('offline'));
      const lookupsBefore =
        completionService.getLatestSubmissionsForBounties.mock.calls.length;
      emitRealtime('UPDATE', { new: { id: 'w1', poster_id: 'user-123', status: 'in_progress' } });
      await waitFor(() =>
        expect(completionService.getLatestSubmissionsForBounties.mock.calls.length).toBeGreaterThan(
          lookupsBefore
        )
      );
      await act(async () => {});
      expect(cards(queryAllByTestId)).toEqual(['w1:review']);

      // The bounty load itself fails: the cards stay rather than vanishing.
      const loadsBefore = progressCalls().length;
      bountyService.getAll.mockImplementation(async (opts: any) => {
        if (opts?.statuses) throw new Error('offline');
        return [];
      });
      emitRealtime('UPDATE', { new: { id: 'w1', poster_id: 'user-123', status: 'in_progress' } });
      await waitFor(() => expect(progressCalls().length).toBeGreaterThan(loadsBefore));
      await act(async () => {});
      expect(cards(queryAllByTestId)).toEqual(['w1:review']);
    });
  });
});
