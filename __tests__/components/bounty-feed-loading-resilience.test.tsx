/**
 * Regression tests for Bounty feed loading resilience.
 *
 * These tests lock in the guarantee that the feed can NEVER remain on the
 * skeleton loader indefinitely. The feed skeleton is gated on
 * `isLoadingBounties || !applicationsLoaded`, and historically the applications
 * request that clears `applicationsLoaded` had no timeout — so a hung request
 * would leave the feed stuck on the skeleton forever (especially for new users
 * / empty datasets where the bounty list itself is empty).
 *
 * The feed must always terminate in exactly one of: loaded, empty, or error.
 */

// Force a short network timeout so the resilience paths resolve quickly under
// real timers. Read at import time by lib/config/network, so it must be set
// before the component (required lazily in beforeAll) is loaded. Restored in
// afterAll so the short timeout never leaks into other suites sharing the
// worker process.
const PREV_API_TIMEOUT = process.env.API_TIMEOUT;
process.env.API_TIMEOUT = '150';

import { render, waitFor } from '@testing-library/react-native';
import React from 'react';

// --- Rich react-native mock (the global jest.setup mock lacks Animated.FlatList
// / RefreshControl / Animated.event that this component relies on). ---
jest.mock('react-native', () => {
  const ReactMock = require('react');
  const passthrough = (name: string) =>
    ({ children, ...props }: any) => ReactMock.createElement(name, props, children);

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
          typeof ListHeaderComponent === 'function' ? ListHeaderComponent : () => ListHeaderComponent,
        )
      : null;
    const footer = ListFooterComponent
      ? ReactMock.createElement(
          typeof ListFooterComponent === 'function' ? ListFooterComponent : () => ListFooterComponent,
        )
      : null;
    let body: any;
    if (!data || data.length === 0) {
      body = ListEmptyComponent
        ? ReactMock.createElement(
            typeof ListEmptyComponent === 'function' ? ListEmptyComponent : () => ListEmptyComponent,
          )
        : null;
    } else {
      body = data.map((item: any, index: number) =>
        ReactMock.createElement(
          ReactMock.Fragment,
          { key: keyExtractor ? keyExtractor(item, index) : index },
          renderItem ? renderItem({ item, index }) : null,
        ),
      );
    }
    return ReactMock.createElement('FlatList', {}, header, body, footer);
  });

  const Animated = {
    Value: jest.fn().mockImplementation((value: number) => ({
      _value: value,
      setValue: jest.fn(),
      interpolate: jest.fn().mockReturnValue(value),
    })),
    event: jest.fn().mockReturnValue(jest.fn()),
    createAnimatedComponent: (c: any) => c,
    View: passthrough('Animated.View'),
    FlatList,
  };

  return {
    Platform: { OS: 'ios', select: (obj: any) => obj.ios ?? obj.default },
    StyleSheet: { create: (s: any) => s, flatten: (s: any) => s },
    Dimensions: { get: () => ({ width: 375, height: 812 }) },
    Animated,
    FlatList,
    RefreshControl: passthrough('RefreshControl'),
    View: passthrough('View'),
    Text: passthrough('Text'),
    TouchableOpacity: passthrough('TouchableOpacity'),
    ScrollView: passthrough('ScrollView'),
    Alert: { alert: jest.fn() },
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

jest.mock('../../components/notifications-bell', () => ({ NotificationsBell: () => null }));
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
        require('react').createElement('Text', { key: b.id, testID: 'bounty-item' }, b.title),
      ),
    ),
}));
jest.mock('../../components/bounty-list-item', () => ({
  BountyListItem: ({ title }: any) =>
    require('react').createElement('Text', { testID: 'bounty-item' }, title),
}));
jest.mock('../../components/ui/skeleton-loaders', () => ({
  PostingsListSkeleton: () =>
    require('react').createElement('View', { testID: 'skeleton' }),
}));
jest.mock('../../components/ui/empty-state', () => ({
  EmptyState: ({ title }: any) =>
    require('react').createElement('Text', { testID: 'empty-state' }, title),
}));

jest.mock('../../hooks/useValidUserId', () => ({ useValidUserId: () => 'user-123' }));
jest.mock(
  'app/hooks/useLocation',
  () => ({ useLocation: () => ({ location: null, permission: { granted: false } }) }),
  { virtual: true },
);

jest.mock('../../lib/services/location-service', () => ({
  locationService: { calculateDistance: jest.fn().mockReturnValue(1) },
}));
jest.mock('../../lib/storage', () => ({
  storage: { getItem: jest.fn().mockResolvedValue(null), setItem: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('../../lib/services/search-service', () => ({
  searchService: { getTrendingBounties: jest.fn().mockResolvedValue([]) },
}));
jest.mock('../../lib/services/bounty-service', () => ({
  bountyService: { getAll: jest.fn() },
}));
jest.mock('../../lib/services/bounty-request-service', () => ({
  bountyRequestService: { getAll: jest.fn() },
}));

// Lazily required after env + mocks are in place.
let BountyFeed: any;
let bountyService: any;
let bountyRequestService: any;

const neverResolves = () => new Promise<never>(() => {});

const renderFeed = () =>
  render(
    React.createElement(BountyFeed, {
      activeScreen: 'bounty',
      setActiveScreen: jest.fn(),
      currentUserId: 'user-123',
    }),
  );

describe('BountyFeed loading resilience', () => {
  beforeAll(() => {
    ({ BountyFeed } = require('../../components/bounty-feed'));
    ({ bountyService } = require('../../lib/services/bounty-service'));
    ({ bountyRequestService } = require('../../lib/services/bounty-request-service'));
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(() => {
    if (PREV_API_TIMEOUT === undefined) {
      delete process.env.API_TIMEOUT;
    } else {
      process.env.API_TIMEOUT = PREV_API_TIMEOUT;
    }
  });

  it('renders bounties when the feed loads successfully', async () => {
    bountyService.getAll.mockResolvedValue([
      { id: '1', title: 'Fix my bike', amount: 50, is_for_honor: false, work_type: 'in_person' },
    ]);
    bountyRequestService.getAll.mockResolvedValue([]);

    const { getAllByTestId, queryByTestId } = renderFeed();

    await waitFor(() => {
      expect(getAllByTestId('bounty-item').length).toBeGreaterThan(0);
    });
    expect(queryByTestId('skeleton')).toBeNull();
  });

  it('shows the empty state (never an infinite skeleton) for an empty dataset', async () => {
    bountyService.getAll.mockResolvedValue([]);
    bountyRequestService.getAll.mockResolvedValue([]);

    const { getByTestId, queryByTestId } = renderFeed();

    await waitFor(() => {
      expect(getByTestId('empty-state')).toBeTruthy();
    });
    expect(queryByTestId('skeleton')).toBeNull();
  });

  it('clears the skeleton even when the applications request hangs forever', async () => {
    // Empty bounty list + a never-resolving applications fetch is the classic
    // infinite-skeleton trap: without a timeout, `applicationsLoaded` would stay
    // false forever and the skeleton would persist behind the empty list.
    bountyService.getAll.mockResolvedValue([]);
    bountyRequestService.getAll.mockImplementation(neverResolves);

    const { getByTestId, queryByTestId } = renderFeed();

    await waitFor(
      () => {
        expect(getByTestId('empty-state')).toBeTruthy();
      },
      { timeout: 3000 },
    );
    expect(queryByTestId('skeleton')).toBeNull();
  });

  it('surfaces the error state when the bounties request hangs forever', async () => {
    bountyService.getAll.mockImplementation(neverResolves);
    bountyRequestService.getAll.mockResolvedValue([]);

    const { getByTestId, queryByTestId } = renderFeed();

    await waitFor(
      () => {
        // EmptyState mock renders its `title`; the error title is distinct.
        expect(getByTestId('empty-state').props.children).toBe('Unable to load bounties');
      },
      { timeout: 3000 },
    );
    expect(queryByTestId('skeleton')).toBeNull();
  });

  it('surfaces the error state even if the applications request also hangs', async () => {
    // A hung applications request must not hide a legitimate bounty-load error
    // behind the skeleton.
    bountyService.getAll.mockImplementation(neverResolves);
    bountyRequestService.getAll.mockImplementation(neverResolves);

    const { getByTestId, queryByTestId } = renderFeed();

    await waitFor(
      () => {
        expect(getByTestId('empty-state').props.children).toBe('Unable to load bounties');
      },
      { timeout: 3000 },
    );
    expect(queryByTestId('skeleton')).toBeNull();
  });
});
