/**
 * The "Post a job" card at the top of the home feed
 * (components/home-post-card.tsx), as BountyFeed renders it.
 *
 * A poster (primary_role 'poster', or anyone who has posted) lands on a Home
 * whose first thing is "Post a job". A hunter who never posted sees the feed
 * exactly as before. Harness copied from bounty-feed-local-default.test.tsx.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

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
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
  useIsFocused: () => true,
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('../../components/notifications/notification-bell', () => ({
  NotificationBell: () => null,
}));
jest.mock('../../components/ui/branding-logo', () => ({ BrandingLogo: () => null }));
jest.mock('../../components/ui/wallet-balance-button', () => ({ WalletBalanceButton: () => null }));
jest.mock('../../components/bounty-compact-item', () => ({ BountyCompactItem: () => null }));
jest.mock('../../components/bounty-grid-feed', () => ({ BountyGridFeed: () => null }));
jest.mock('../../components/bounty-list-item', () => ({ BountyListItem: () => null }));
jest.mock('../../components/ui/skeleton-loaders', () => ({
  PostingsListSkeleton: () => require('react').createElement('View', { testID: 'skeleton' }),
}));
jest.mock('../../components/ui/empty-state', () => ({
  EmptyState: ({ title }: any) =>
    require('react').createElement('Text', { testID: 'empty-state' }, title),
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
let mockDevice: { location: any; permission: any } = {
  location: null,
  permission: { granted: false },
};
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
      functions: {
        invoke: jest.fn().mockResolvedValue({ data: { variant: 'control' }, error: null }),
      },
    },
  };
});

let BountyFeed: any;

// The poster's latest bounty, as useLatestPostedBounty reports it.
let mockLatest: any = { status: 'loaded', bounty: null };
const mockReloadLatest = jest.fn(async () => {});
jest.mock('../../hooks/useLatestPostedBounty', () => ({
  useLatestPostedBounty: () => ({ state: mockLatest, reload: mockReloadLatest }),
}));

const PAST = { id: 'b-1', title: 'Mow the front lawn' };

const renderFeed = (props: Record<string, unknown> = {}) =>
  render(
    React.createElement(BountyFeed, {
      activeScreen: 'bounty',
      setActiveScreen: jest.fn(),
      currentUserId: 'user-123',
      ...props,
    })
  );

describe('BountyFeed home post card', () => {
  beforeAll(() => {
    ({ BountyFeed } = require('../../components/bounty-feed'));
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockStore.clear();
    mockDevice = { location: null, permission: { granted: false } };
    mockLatest = { status: 'loaded', bounty: null };
    require('../../lib/services/bounty-location-service').getMyCoordinates.mockResolvedValue({
      ok: true,
      coords: null,
    });
  });

  afterEach(() => cleanup());

  it('puts "Post a job" first on Home for a poster', async () => {
    const tree = renderFeed({ primaryRole: 'poster' });
    await act(async () => {});

    expect(screen.getByTestId('home-post-card')).toBeTruthy();
    expect(screen.getByText('Post a job')).toBeTruthy();
    // First child of the feed's root: above the search row and the list.
    const root: any = tree.toJSON();
    expect(root.children[0].props.testID).toBe('home-post-card');
  });

  it.each([
    ['poster with no past bounty', 'poster', null, true],
    ['poster with a past bounty', 'poster', PAST, true],
    ['hunter who has posted', 'hunter', PAST, true],
    ['"both" who has posted', 'both', PAST, true],
    ['unset role who has posted', null, PAST, true],
    ['hunter who never posted', 'hunter', null, false],
    ['"both" who never posted', 'both', null, false],
    ['unset role who never posted', null, null, false],
  ])('%s: card shown = %s', async (_label, primaryRole, bounty, shown) => {
    mockLatest = { status: 'loaded', bounty };
    renderFeed({ primaryRole });
    await act(async () => {});
    expect(screen.queryByTestId('home-post-card') != null).toBe(shown);
  });

  it('shows a hunter no card while their history is loading or failed to load', async () => {
    mockLatest = { status: 'loading' };
    const { rerender } = renderFeed({ primaryRole: 'hunter' });
    await act(async () => {});
    expect(screen.queryByTestId('home-post-card')).toBeNull();

    mockLatest = { status: 'error' };
    rerender(
      React.createElement(BountyFeed, {
        activeScreen: 'bounty',
        setActiveScreen: jest.fn(),
        currentUserId: 'user-123',
        primaryRole: 'hunter',
      })
    );
    expect(screen.queryByTestId('home-post-card')).toBeNull();
  });

  it('hides "Post again" until a Post-again flow is wired in', async () => {
    mockLatest = { status: 'loaded', bounty: PAST };
    renderFeed({ primaryRole: 'poster' });
    await act(async () => {});
    expect(screen.getByTestId('home-post-card')).toBeTruthy();
    expect(screen.queryByTestId('home-post-card-post-again')).toBeNull();
  });

  it('offers "Post again: <title>" for the latest bounty once onPostAgain is set', async () => {
    mockLatest = { status: 'loaded', bounty: PAST };
    const onPostAgain = jest.fn();
    renderFeed({ primaryRole: 'poster', onPostAgain });
    await act(async () => {});

    fireEvent.press(screen.getByTestId('home-post-card-post-again'));
    expect(onPostAgain).toHaveBeenCalledWith('b-1');
    expect(screen.getByLabelText('Post again: Mow the front lawn')).toBeTruthy();
  });

  it('opens the composer with entry point home_post_card', async () => {
    const onOpenComposer = jest.fn();
    renderFeed({ primaryRole: 'poster', onOpenComposer });
    await act(async () => {});

    fireEvent.press(screen.getByTestId('home-post-card-post-new'));
    expect(onOpenComposer).toHaveBeenCalledWith('home_post_card');
  });

  it('opens My Bounties from "See all my posts"', async () => {
    const onSeeMyPosts = jest.fn();
    renderFeed({ primaryRole: 'poster', onSeeMyPosts });
    await act(async () => {});

    fireEvent.press(screen.getByTestId('home-post-card-see-all'));
    expect(onSeeMyPosts).toHaveBeenCalledTimes(1);
  });

  it('reloads the latest bounty after a publish (feed refresh)', async () => {
    const ref = React.createRef<any>();
    render(
      React.createElement(BountyFeed, {
        ref,
        activeScreen: 'bounty',
        setActiveScreen: jest.fn(),
        currentUserId: 'user-123',
        primaryRole: 'poster',
      })
    );
    await act(async () => {});
    mockReloadLatest.mockClear();
    await act(async () => {
      ref.current.refresh();
    });
    expect(mockReloadLatest).toHaveBeenCalledTimes(1);
  });

  it('fires home_post_card_shown only while Home is the on-screen tab', async () => {
    const { analyticsService } = require('../../lib/services/analytics-service');
    const track = jest.spyOn(analyticsService, 'trackEvent');
    const { rerender } = renderFeed({ primaryRole: 'poster', activeScreen: 'elsewhere' });
    await act(async () => {});
    expect(track).not.toHaveBeenCalledWith('home_post_card_shown', expect.anything());

    rerender(
      React.createElement(BountyFeed, {
        activeScreen: 'bounty',
        setActiveScreen: jest.fn(),
        currentUserId: 'user-123',
        primaryRole: 'poster',
      })
    );
    await waitFor(() =>
      expect(track).toHaveBeenCalledWith(
        'home_post_card_shown',
        expect.objectContaining({ primary_role: 'poster', has_posted: false, layout: 'card' })
      )
    );
    track.mockRestore();
  });
});
