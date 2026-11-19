/**
 * Realtime INSERTs under a radius (SBA-02 local default, or a picked radius).
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
jest.mock('../../lib/supabase', () => {
  const channel: any = {
    on: jest.fn((_type: string, config: any, handler: any) => {
      realtimeHandlers.push({ event: config?.event, handler });
      return channel;
    }),
    subscribe: jest.fn(() => channel),
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
  });

  beforeEach(() => {
    jest.clearAllMocks();
    realtimeHandlers.length = 0;
    searchBountiesNearby.mockResolvedValue([nearbyRow({})]);
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
      ...NEAR,
    };
    bountyService.getById.mockResolvedValue({ ...posted, status: 'open', username: 'poster' });
    const { queryAllByTestId, queryByText } = await renderLoaded();

    emitInsert(posted);

    await waitFor(() =>
      expect(titles(queryAllByTestId)).toEqual(['Posted nearby', 'Loaded nearby'])
    );
    expect(bountyService.getById).toHaveBeenCalledWith('b-near');
    expect(searchBountiesNearby).toHaveBeenCalledTimes(1);
    expect(queryByText(/new bount/)).toBeNull();
  });

  it('renders an online job live, after the in-person rows', async () => {
    const posted = { id: 'b-online', title: 'Posted online', amount: 20, work_type: 'online' };
    bountyService.getById.mockResolvedValue({ ...posted, status: 'open' });
    const { queryAllByTestId, queryByText } = await renderLoaded();

    emitInsert(posted);

    await waitFor(() =>
      expect(titles(queryAllByTestId)).toEqual(['Loaded nearby', 'Posted online'])
    );
    expect(queryByText(/new bount/)).toBeNull();
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
});
