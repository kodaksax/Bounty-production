/**
 * Realtime INSERTs under a radius (SBA-02 local default, or a picked radius).
 *
 * A matching insert renders from the realtime payload in the same tick, with
 * no network read first; the poster's avatar is filled in afterwards. Only a
 * payload Realtime trimmed (no title) is read back with getById.
 *
 * The feed used to show every new bounty under a radius as a "New bounties"
 * pill, because the INSERT payload carries no distance. The feed now runs the
 * check search_bounties_nearby runs: an online job, or an in-person bounty
 * whose approximate point is inside the radius, renders live; one outside the
 * radius stays out; one with no known distance still gets the pill.
 */
import { act, cleanup, render, waitFor } from '@testing-library/react-native';
import React from 'react';


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
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }), useIsFocused: () => true }));
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
  EmptyState: ({ title }: any) => require('react').createElement('Text', { testID: 'empty-state' }, title),
}));

jest.mock('../../hooks/useValidUserId', () => ({ useValidUserId: () => 'user-123' }));
jest.mock('../../hooks/useActiveHunters', () => ({
  useActiveHunters: () => ({ count: null, radiusMiles: 30, refresh: jest.fn() }),
}));
const BALTIMORE = { latitude: 39.29, longitude: -76.61 };
jest.mock(
  'app/hooks/useLocation',
  () => ({ useLocation: () => ({ location: BALTIMORE, permission: { granted: true } }) }),
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
jest.mock('../../lib/services/bounty-service', () => ({
  bountyService: {
    getAll: jest.fn().mockResolvedValue([]),
    getOpenCount: jest.fn().mockResolvedValue(0),
    getById: jest.fn(),
    attachPosterProfiles: jest.fn(),
  },
}));
jest.mock('../../lib/services/bounty-request-service', () => ({
  bountyRequestService: { getAll: jest.fn().mockResolvedValue([]) },
}));
jest.mock('../../lib/services/bounty-location-service', () => ({
  searchBountiesNearby: jest.fn(),
  getMyCoordinates: jest.fn().mockResolvedValue({ ok: true, coords: null }),
}));
// Records the handlers the feed registers, so a test can deliver an INSERT
// the way Supabase would.
const realtimeHandlers: { event: string; handler: (payload: any) => void }[] = [];
// The status callbacks passed to subscribe(), so a test can drop and rejoin.
const subscribeCallbacks: ((status: string) => void)[] = [];
jest.mock('../../lib/supabase', () => {
  const channel: any = {
    on: jest.fn((_type: string, config: any, handler: any) => {
      realtimeHandlers.push({ event: config?.event, handler });
      return channel;
    }),
    subscribe: jest.fn((cb?: (status: string) => void) => {
      if (cb) subscribeCallbacks.push(cb);
      return channel;
    }),
  };
  return {
    supabase: {
      channel: jest.fn(() => channel),
      removeChannel: jest.fn(),
      functions: { invoke: jest.fn().mockResolvedValue({ data: { variant: 'control' }, error: null }) },
    },
  };
});

function emitInsert(row: Record<string, unknown>) {
  realtimeHandlers
    .filter(h => h.event === 'INSERT')
    .forEach(h => act(() => h.handler({ new: { status: 'open', poster_id: 'someone-else', ...row } })));
}

let BountyFeed: any;
let bountyService: any;
let searchBountiesNearby: jest.Mock;
let supabaseMock: any;

// About 0.9 mi from BALTIMORE, and about 90 mi away (Philadelphia).
const NEAR = { approx_latitude: 39.3, approx_longitude: -76.62 };
const FAR = { approx_latitude: 39.95, approx_longitude: -75.17 };

const nearbyRow = (over: Record<string, unknown>) => ({
  id: 'n1',
  title: 'Loaded nearby',
  amount: 40,
  is_for_honor: false,
  status: 'open',
  work_type: 'in_person',
  description: 'Rake the leaves in the back yard',
  neighborhood: 'Hampden',
  approx_latitude: 39.31,
  approx_longitude: -76.63,
  distance_miles: 2,
  ...over,
});

const renderFeed = () =>
  render(
    React.createElement(BountyFeed, {
      activeScreen: 'bounty',
      setActiveScreen: jest.fn(),
      currentUserId: 'user-123',
    })
  );

const titles = (queryAllByTestId: any) =>
  queryAllByTestId('bounty-item').map((n: any) => n.props.children);

describe('BountyFeed realtime INSERT under a radius', () => {
  beforeAll(() => {
    ({ BountyFeed } = require('../../components/bounty-feed'));
    ({ bountyService } = require('../../lib/services/bounty-service'));
    ({ searchBountiesNearby } = require('../../lib/services/bounty-location-service'));
    ({ supabase: supabaseMock } = require('../../lib/supabase'));
  });

  beforeEach(() => {
    jest.clearAllMocks();
    realtimeHandlers.length = 0;
    subscribeCallbacks.length = 0;
    searchBountiesNearby.mockResolvedValue([nearbyRow({})]);
    bountyService.attachPosterProfiles.mockImplementation(async (rows: any[]) =>
      rows.map(r => ({ ...r, poster_avatar: 'https://cdn.example/avatar.png' }))
    );
    supabaseMock.functions.invoke.mockResolvedValue({ data: { variant: 'control' }, error: null });
  });

  afterEach(() => cleanup());

  const renderLoaded = async () => {
    const utils = renderFeed();
    await waitFor(() => expect(titles(utils.queryAllByTestId)).toEqual(['Loaded nearby']));
    expect(searchBountiesNearby.mock.calls[0][0]).toMatchObject({ radiusMiles: 25, includeOnline: true });
    return utils;
  };

  it('renders an in-person bounty inside the radius live, sorted by distance', async () => {
    const posted = {
      id: 'b-near',
      title: 'Posted nearby',
      amount: 30,
      work_type: 'in_person',
      description: 'Carry a couch up two floors',
      location: 'Remington',
      username: 'poster',
      ...NEAR,
    };
    const { queryAllByTestId, queryByText } = await renderLoaded();

    emitInsert(posted);

    // Same tick as the event: nothing was awaited before the row rendered.
    expect(titles(queryAllByTestId)).toEqual(['Posted nearby', 'Loaded nearby']);
    expect(bountyService.getById).not.toHaveBeenCalled();
    expect(searchBountiesNearby).toHaveBeenCalledTimes(1);
    expect(queryByText(/new bount/)).toBeNull();
  });

  it('renders an online job live, at the top', async () => {
    const posted = { id: 'b-online', title: 'Posted online', amount: 20, work_type: 'online' };
    const { queryAllByTestId, queryByText } = await renderLoaded();

    emitInsert(posted);

    expect(titles(queryAllByTestId)).toEqual(['Posted online', 'Loaded nearby']);
    expect(queryByText(/new bount/)).toBeNull();
  });

  // The cases below get a payload with no title, the way Realtime trims an
  // oversized row, so the feed reads the row back before rendering it.
  it('reads a trimmed payload back and renders the fetched row', async () => {
    bountyService.getById.mockResolvedValue({
      id: 'b-trimmed',
      title: 'Read back in full',
      status: 'open',
      work_type: 'in_person',
      ...NEAR,
    });
    const { queryAllByTestId } = await renderLoaded();

    emitInsert({ id: 'b-trimmed', work_type: 'in_person', ...NEAR });

    await waitFor(() =>
      expect(titles(queryAllByTestId)).toEqual(['Read back in full', 'Loaded nearby'])
    );
    expect(bountyService.getById).toHaveBeenCalledWith('b-trimmed');
  });

  it('keeps the pill when reading a trimmed payload back returns null', async () => {
    bountyService.getById.mockResolvedValue(null);
    const { queryAllByTestId, getByText } = await renderLoaded();

    emitInsert({
      id: 'b-missing',
      work_type: 'in_person',
      ...NEAR,
    });

    await waitFor(() => expect(getByText('1 new bounty')).toBeTruthy());
    expect(titles(queryAllByTestId)).toEqual(['Loaded nearby']);
  });

  it('rechecks the fetched location and leaves an out-of-radius bounty out', async () => {
    const posted = {
      id: 'b-moved',
      work_type: 'in_person',
      ...NEAR,
    };
    bountyService.getById.mockResolvedValue({
      ...posted,
      title: 'Moved outside the radius',
      approx_latitude: FAR.approx_latitude,
      approx_longitude: FAR.approx_longitude,
      status: 'open',
    });
    const { queryAllByTestId, queryByText } = await renderLoaded();

    emitInsert(posted);
    await waitFor(() => expect(bountyService.getById).toHaveBeenCalledWith('b-moved'));
    await act(async () => {});

    expect(titles(queryAllByTestId)).toEqual(['Loaded nearby']);
    expect(queryByText(/new bount/)).toBeNull();
  });

  it('shows the pill when the fetched location has become unknown', async () => {
    const posted = {
      id: 'b-location-unknown',
      work_type: 'in_person',
      ...NEAR,
    };
    bountyService.getById.mockResolvedValue({
      ...posted,
      title: 'Location no longer available',
      approx_latitude: undefined,
      approx_longitude: undefined,
      status: 'open',
    });
    const { queryAllByTestId, getByText } = await renderLoaded();

    emitInsert(posted);

    await waitFor(() => expect(getByText('1 new bounty')).toBeTruthy());
    expect(titles(queryAllByTestId)).toEqual(['Loaded nearby']);
  });

  it('leaves out an in-person bounty outside the radius, with no pill', async () => {
    const { queryAllByTestId, queryByText } = await renderLoaded();

    emitInsert({ id: 'b-far', title: 'Posted far away', work_type: 'in_person', ...FAR });
    await act(async () => {});

    expect(bountyService.getById).not.toHaveBeenCalled();
    expect(titles(queryAllByTestId)).toEqual(['Loaded nearby']);
    expect(queryByText(/new bount/)).toBeNull();
  });

  it('keeps the pill for an in-person bounty with no known distance', async () => {
    const { queryAllByTestId, getByText } = await renderLoaded();

    emitInsert({ id: 'b-unknown', title: 'Posted, no point', work_type: 'in_person' });

    await waitFor(() => expect(getByText('1 new bounty')).toBeTruthy());
    expect(bountyService.getById).not.toHaveBeenCalled();
    expect(titles(queryAllByTestId)).toEqual(['Loaded nearby']);
  });
  it('fills in the poster avatar after the row is on screen, with one profile read', async () => {
    const { queryAllByTestId } = await renderLoaded();

    emitInsert({ id: 'b-avatar', title: 'Needs an avatar', work_type: 'online', poster_id: 'p-9' });

    expect(titles(queryAllByTestId)).toContain('Needs an avatar');
    await waitFor(() => expect(bountyService.attachPosterProfiles).toHaveBeenCalledTimes(1));
    expect(bountyService.attachPosterProfiles.mock.calls[0][0][0]).toMatchObject({
      id: 'b-avatar',
      poster_id: 'p-9',
    });
    expect(bountyService.getById).not.toHaveBeenCalled();
  });

  it('reuses a loaded row by the same poster instead of reading the profile', async () => {
    searchBountiesNearby.mockResolvedValue([
      nearbyRow({ poster_id: 'p-known', avatar: 'https://cdn.example/known.png' }),
    ]);
    const { queryAllByTestId } = await renderLoaded();

    emitInsert({ id: 'b-same', title: 'Same poster', work_type: 'online', poster_id: 'p-known' });
    await act(async () => {});

    expect(titles(queryAllByTestId)).toContain('Same poster');
    expect(bountyService.attachPosterProfiles).not.toHaveBeenCalled();
  });

  it('shows a live insert in the ranking test arm before the next ranking returns', async () => {
    supabaseMock.functions.invoke.mockResolvedValueOnce({
      data: {
        variant: 'test',
        sections: { main: [{ id: 'n1', rank_score: 1 }], dormant: [], honor: [] },
      },
      error: null,
    });
    const { queryAllByTestId } = await renderLoaded();
    await waitFor(() => expect(supabaseMock.functions.invoke).toHaveBeenCalledTimes(1));
    await act(async () => {});
    // The re-rank for the new row never answers, as on a slow edge function.
    supabaseMock.functions.invoke.mockReturnValue(new Promise(() => {}));

    emitInsert({ id: 'b-ranked', title: 'Not ranked yet', work_type: 'online' });

    expect(titles(queryAllByTestId)).toEqual(['Not ranked yet', 'Loaded nearby']);
  });

  it('reloads page one when the channel rejoins after a drop', async () => {
    await renderLoaded();
    expect(subscribeCallbacks.length).toBeGreaterThan(0);
    const status = (s: string) => act(() => subscribeCallbacks.forEach(cb => cb(s)));

    status('SUBSCRIBED');
    expect(searchBountiesNearby).toHaveBeenCalledTimes(1);

    status('CHANNEL_ERROR');
    status('SUBSCRIBED');
    await waitFor(() => expect(searchBountiesNearby).toHaveBeenCalledTimes(2));
    expect(searchBountiesNearby.mock.calls[1][0]).toMatchObject({ offset: 0 });
  });
  it('reports how long each new bounty took to arrive, and what the feed did with it', async () => {
    const { analyticsService } = require('../../lib/services/analytics-service');
    const track = jest.spyOn(analyticsService, 'trackEvent').mockResolvedValue(undefined);
    await renderLoaded();
    const events = () =>
      track.mock.calls.filter(([name]: any[]) => name === 'feed_realtime_insert_received');

    const createdAt = new Date(Date.now() - 1500).toISOString();
    emitInsert({ id: 'b-timed', title: 'Timed', work_type: 'online', created_at: createdAt });
    emitInsert({ id: 'b-far-timed', title: 'Far', work_type: 'in_person', ...FAR });

    expect(events()).toHaveLength(2);
    const [rendered, far] = events().map(([, props]: any[]) => props);
    expect(rendered).toMatchObject({ outcome: 'rendered', radius_miles: 25, is_own: false });
    expect(rendered.latency_ms).toBeGreaterThanOrEqual(1500);
    expect(rendered.latency_ms).toBeLessThan(10000);
    expect(far).toMatchObject({ outcome: 'out_of_radius', latency_ms: undefined });
    track.mockRestore();
  });
  // Regression: an online "Walk my dog" with no location or timing is both
  // distance-less and "Limited details", so the sort put it at the very bottom.
  it('keeps a just-posted bounty on top even when it is incomplete and has no distance', async () => {
    searchBountiesNearby.mockResolvedValue([
      nearbyRow({ id: 'n1', title: 'Close one', distance_miles: 1 }),
      nearbyRow({ id: 'n2', title: 'Further one', distance_miles: 9 }),
    ]);
    const utils = renderFeed();
    await waitFor(() =>
      expect(titles(utils.queryAllByTestId)).toEqual(['Close one', 'Further one'])
    );

    emitInsert({
      id: 'b-dog',
      title: 'Walk my dog',
      amount: 20,
      work_type: 'online',
      description: 'Walk my dog around the block twice',
      created_at: new Date().toISOString(),
    });
    emitInsert({ id: 'b-newer', title: 'Newer post', work_type: 'online' });

    expect(titles(utils.queryAllByTestId)).toEqual([
      'Newer post',
      'Walk my dog',
      'Close one',
      'Further one',
    ]);
  });

  it('sorts live arrivals normally again after a reload', async () => {
    const { queryAllByTestId } = await renderLoaded();
    emitInsert({ id: 'b-dog', title: 'Walk my dog', work_type: 'online' });
    expect(titles(queryAllByTestId)).toEqual(['Walk my dog', 'Loaded nearby']);

    // A reset reload (here, the reconnect catch-up) returns the dog post with
    // no distance, so it now sorts after the row that has one.
    searchBountiesNearby.mockResolvedValue([
      nearbyRow({}),
      nearbyRow({ id: 'b-dog', title: 'Walk my dog', work_type: 'online', distance_miles: null }),
    ]);
    act(() => subscribeCallbacks.forEach(cb => cb('CHANNEL_ERROR')));
    act(() => subscribeCallbacks.forEach(cb => cb('SUBSCRIBED')));

    await waitFor(() => expect(searchBountiesNearby).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(titles(queryAllByTestId)).toEqual(['Loaded nearby', 'Walk my dog'])
    );
  });
});
