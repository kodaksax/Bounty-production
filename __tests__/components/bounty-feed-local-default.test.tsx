/**
 * SBA-02: the hunter feed's local default (docs/audits/shoal-behavioral-audit.md).
 *
 * A hunter with a location (device fix or saved profile point) gets in-person
 * work within 25 miles plus every online job by default, and For You stays the
 * active chip. "Any distance" is remembered. A hunter with no location keeps
 * today's unfiltered feed. The first load waits until that is known, so the
 * feed never fetches everything and then snaps to the local set.
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
jest.mock('../../components/bounty-compact-item', () => ({ BountyCompactItem: () => null }));
jest.mock('../../components/bounty-grid-feed', () => ({ BountyGridFeed: () => null }));
// The feed hosts the cards' detail popup (components/bounty-detail-host.tsx);
// its import tree is out of scope here, like the cards themselves.
jest.mock('../../components/bountydetailmodal', () => ({ BountyDetailModal: () => null }));
jest.mock('../../components/bounty-list-item', () => ({ BountyListItem: () => null }));
jest.mock('../../components/ui/skeleton-loaders', () => ({
  PostingsListSkeleton: () => require('react').createElement('View', { testID: 'skeleton' }),
}));
jest.mock('../../components/ui/empty-state', () => ({
  EmptyState: ({ title }: any) => require('react').createElement('Text', { testID: 'empty-state' }, title),
}));
// Records each chip's props so the test can read what's active and pick a distance.
const mockChips: { distance?: any; forYou?: any } = {};
jest.mock('../../components/ui/filter-chip-select', () => ({
  FilterChipSelect: (props: any) => {
    mockChips.distance = props;
    return null;
  },
}));
jest.mock('../../components/ui/filter-chip', () => ({
  FilterChip: (props: any) => {
    if (props.label === 'For You') mockChips.forYou = props;
    return null;
  },
}));

jest.mock('../../hooks/useValidUserId', () => ({ useValidUserId: () => 'user-123' }));
jest.mock('../../hooks/useActiveHunters', () => ({
  useActiveHunters: () => ({ count: null, radiusMiles: 30, refresh: jest.fn() }),
}));
let mockDevice: { location: any; permission: any } = { location: null, permission: { granted: false } };
jest.mock('app/hooks/useLocation', () => ({ useLocation: () => mockDevice }), { virtual: true });

jest.mock('../../lib/services/location-service', () => ({
  locationService: { calculateDistance: jest.fn().mockReturnValue(1) },
}));
const mockStore = new Map<string, string>();
jest.mock('../../lib/storage', () => ({
  storage: {
    getItem: jest.fn(async (k: string) => mockStore.get(k) ?? null),
    setItem: jest.fn(async (k: string, v: string) => {
      mockStore.set(k, v);
    }),
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
  searchBountiesNearby: jest.fn().mockResolvedValue([]),
  getMyCoordinates: jest.fn(),
}));
jest.mock('../../lib/supabase', () => {
  const channel = { on: jest.fn().mockReturnThis(), subscribe: jest.fn().mockReturnThis() };
  return {
    supabase: {
      channel: jest.fn(() => channel),
      removeChannel: jest.fn(),
      functions: { invoke: jest.fn().mockResolvedValue({ data: { variant: 'control' }, error: null }) },
    },
  };
});

let BountyFeed: any;
// The unfiltered feed query (status: 'open'), not the poster's own
// progress-card fetch (statuses: [...]), which also goes through getAll.
const feedQueries = () => bountyService.getAll.mock.calls.filter((c: any[]) => c[0]?.status === 'open');
let bountyService: any;
let searchBountiesNearby: jest.Mock;
let getMyCoordinates: jest.Mock;
let storage: any;

const BALTIMORE = { latitude: 39.29, longitude: -76.61 };

const renderFeed = () =>
  render(
    React.createElement(BountyFeed, {
      activeScreen: 'bounty',
      setActiveScreen: jest.fn(),
      currentUserId: 'user-123',
    })
  );

describe('BountyFeed local distance default (SBA-02)', () => {
  beforeAll(() => {
    ({ BountyFeed } = require('../../components/bounty-feed'));
    ({ bountyService } = require('../../lib/services/bounty-service'));
    ({ searchBountiesNearby, getMyCoordinates } = require('../../lib/services/bounty-location-service'));
    ({ storage } = require('../../lib/storage'));
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockStore.clear();
    delete mockChips.distance;
    delete mockChips.forYou;
    mockDevice = { location: null, permission: { granted: false } };
    getMyCoordinates.mockResolvedValue({ ok: true, coords: null });
  });

  afterEach(() => cleanup());

  it('defaults a located hunter to 25 mi plus online jobs, with For You active', async () => {
    mockDevice = { location: BALTIMORE, permission: { granted: true } };
    renderFeed();

    await waitFor(() => expect(searchBountiesNearby).toHaveBeenCalled());
    expect(searchBountiesNearby).toHaveBeenCalledTimes(1);
    expect(searchBountiesNearby.mock.calls[0][0]).toMatchObject({
      latitude: BALTIMORE.latitude,
      longitude: BALTIMORE.longitude,
      radiusMiles: 25,
      includeOnline: true,
    });
    // Never fetched the unfiltered feed first.
    expect(feedQueries()).toHaveLength(0);
    expect(mockChips.forYou?.active).toBe(true);
    // The Distance chip reads as the baseline, not an engaged filter.
    expect(mockChips.distance?.value).toBe(25);
    expect(mockChips.distance?.neutralValue).toBe(25);
    expect(mockChips.distance?.neutralLabel).toBe('25 mi');
  });

  it('uses the saved profile point when the device has no fix', async () => {
    getMyCoordinates.mockResolvedValue({ ok: true, coords: BALTIMORE });
    renderFeed();

    await waitFor(() => expect(searchBountiesNearby).toHaveBeenCalled());
    expect(searchBountiesNearby.mock.calls[0][0]).toMatchObject({
      latitude: BALTIMORE.latitude,
      radiusMiles: 25,
      includeOnline: true,
    });
    expect(feedQueries()).toHaveLength(0);
  });

  it('keeps today\'s unfiltered feed for a hunter with no location', async () => {
    renderFeed();

    await waitFor(() => expect(feedQueries().length).toBeGreaterThan(0));
    expect(searchBountiesNearby).not.toHaveBeenCalled();
    expect(mockChips.forYou?.active).toBe(true);
    expect(mockChips.distance?.value).toBe('off');
    expect(mockChips.distance?.neutralLabel).toBeUndefined();
  });

  it('honours a remembered "Any distance" choice', async () => {
    mockStore.set('BE:distancePreference', 'any');
    mockDevice = { location: BALTIMORE, permission: { granted: true } };
    renderFeed();

    await waitFor(() => expect(feedQueries().length).toBeGreaterThan(0));
    expect(searchBountiesNearby).not.toHaveBeenCalled();
    expect(mockChips.forYou?.active).toBe(true);
  });

  it('remembers picking "Any distance", and forgets it when a radius is picked', async () => {
    mockDevice = { location: BALTIMORE, permission: { granted: true } };
    renderFeed();
    await waitFor(() => expect(searchBountiesNearby).toHaveBeenCalledTimes(1));

    await act(async () => {
      mockChips.distance.onChange('off');
    });
    await waitFor(() => expect(feedQueries().length).toBeGreaterThan(0));
    expect(storage.setItem).toHaveBeenCalledWith('BE:distancePreference', 'any');
    // "Any distance" is now the default, so For You is active again.
    expect(mockChips.forYou?.active).toBe(true);

    await act(async () => {
      mockChips.distance.onChange(10);
    });
    await waitFor(() => expect(searchBountiesNearby).toHaveBeenCalledTimes(2));
    expect(searchBountiesNearby.mock.calls[1][0]).toMatchObject({ radiusMiles: 10, includeOnline: true });
    expect(mockStore.get('BE:distancePreference')).toBe('local');
    expect(mockChips.forYou?.active).toBe(false);
  });
});
