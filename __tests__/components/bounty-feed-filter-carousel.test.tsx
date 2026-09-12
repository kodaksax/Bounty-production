/**
 * Regression tests for the bounty feed's filter carousel.
 *
 * The feed used to stack two horizontal carousels — categories, then a
 * separate distance carousel. They were consolidated into ONE carousel whose
 * items come from a single source (`filterItems`), with the Distance chip
 * injected as an ordinary item between Delivery and Other.
 *
 * These tests lock in that shape: one horizontal list, and Distance sitting in
 * the middle of the category chips rather than in a lane of its own.
 */
import { cleanup, render, waitFor } from '@testing-library/react-native';
import React from 'react';

const mockRealtimeChannel = {
  on: jest.fn(),
  subscribe: jest.fn(),
};
mockRealtimeChannel.on.mockReturnValue(mockRealtimeChannel);
mockRealtimeChannel.subscribe.mockReturnValue(mockRealtimeChannel);

// --- Rich react-native mock (the global jest.setup mock lacks Animated.FlatList
// / RefreshControl, which this component relies on). ScrollView is a real
// passthrough here so the carousel's children land in the rendered tree in
// source order — that ordering is what these tests assert on. ---
jest.mock('react-native', () => {
  const ReactMock = require('react');
  const passthrough =
    (name: string) =>
    ({ children, ...props }: any) =>
      ReactMock.createElement(name, props, children);

  const FlatList = ReactMock.forwardRef((props: any, _ref: any) => {
    const { data = [], renderItem, ListHeaderComponent, keyExtractor } = props;
    const header = ListHeaderComponent
      ? ReactMock.createElement(
          typeof ListHeaderComponent === 'function' ? ListHeaderComponent : () => ListHeaderComponent
        )
      : null;
    const body = data.map((item: any, index: number) =>
      ReactMock.createElement(
        ReactMock.Fragment,
        { key: keyExtractor ? keyExtractor(item, index) : index },
        renderItem ? renderItem({ item, index }) : null
      )
    );
    return ReactMock.createElement('FlatList', {}, header, body);
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
    parallel: jest.fn(immediate),
    sequence: jest.fn(immediate),
    stagger: jest.fn(immediate),
    loop: jest.fn(() => ({ start: jest.fn(), stop: jest.fn() })),
    View: passthrough('Animated.View'),
    FlatList,
  };

  return {
    Platform: { OS: 'ios', select: (obj: any) => obj.ios ?? obj.default },
    StyleSheet: { create: (s: any) => s, flatten: (s: any) => s, hairlineWidth: 1 },
    Dimensions: { get: () => ({ width: 375, height: 812 }) },
    useWindowDimensions: () => ({ width: 375, height: 812, scale: 2, fontScale: 1 }),
    // AppModal's keyboard avoidance subscribes on mount (see
    // components/ui/keyboard-avoiding); the listener never fires here.
    Keyboard: { addListener: () => ({ remove: () => {} }), dismiss: () => {} },
    Animated,
    FlatList,
    Modal: passthrough('Modal'),
    Pressable: passthrough('Pressable'),
    RefreshControl: passthrough('RefreshControl'),
    View: passthrough('View'),
    Text: passthrough('Text'),
    TouchableOpacity: passthrough('TouchableOpacity'),
    ScrollView: passthrough('ScrollView'),
    Alert: { alert: jest.fn() },
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

jest.mock('expo-linear-gradient', () => ({
  LinearGradient: ({ children }: any) => require('react').createElement('View', {}, children),
}));
jest.mock('@expo/vector-icons', () => ({ MaterialIcons: () => null }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
// 'compact' keeps the carousel a direct sibling of the list (the grid layout
// renders it inside BountyGridFeed, which is mocked away below).
jest.mock('../../lib/bounty-format-context', () => ({
  useBountyFormat: () => ({ bountyFormat: 'compact', setBountyFormat: jest.fn() }),
}));

jest.mock('../../components/notifications/notification-bell', () => ({ NotificationBell: () => null }));
jest.mock('../../components/bounty-compact-item', () => ({ BountyCompactItem: () => null }));
jest.mock('../../components/bounty-grid-feed', () => ({ BountyGridFeed: () => null }));
jest.mock('../../components/bounty-list-item', () => ({ BountyListItem: () => null }));
jest.mock('../../components/ui/skeleton-loaders', () => ({
  PostingsListSkeleton: () => require('react').createElement('View', { testID: 'skeleton' }),
}));
jest.mock('../../components/ui/empty-state', () => ({
  EmptyState: () => require('react').createElement('View', { testID: 'empty-state' }),
}));

jest.mock('../../hooks/useValidUserId', () => ({ useValidUserId: () => 'user-123' }));
jest.mock('../../hooks/useForegroundRefresh', () => ({ useForegroundRefresh: () => {} }));
jest.mock(
  'app/hooks/useLocation',
  () => ({ useLocation: () => ({ location: null, permission: { granted: true } }) }),
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
  bountyService: { getAll: jest.fn().mockResolvedValue([]), getOpenCount: jest.fn().mockResolvedValue(0) },
}));
jest.mock('../../lib/services/bounty-request-service', () => ({
  bountyRequestService: { getAll: jest.fn().mockResolvedValue([]) },
}));
jest.mock('../../lib/services/bounty-location-service', () => ({
  searchBountiesNearby: jest.fn().mockResolvedValue([]),
}));
jest.mock('../../lib/supabase', () => {
  const channel = {
    on: jest.fn(),
    subscribe: jest.fn(),
  };
  channel.on.mockReturnValue(channel);
  channel.subscribe.mockReturnValue(channel);
  return {
    supabase: {
      channel: jest.fn(() => channel),
      removeChannel: jest.fn(() => channel),
    },
  };
});

import { BountyFeed } from '../../components/bounty-feed';

const renderFeed = () =>
  render(
    <BountyFeed activeScreen="bounty" setActiveScreen={jest.fn()} currentUserId="user-123" />
  );

/**
 * Accessibility labels of the carousel's chips, in rendered (visual) order.
 * Host elements only (`typeof type === 'string'`) — a composite wrapper and the
 * host node it renders both carry the same props, which would double every entry.
 */
function chipLabelsInOrder(root: any): string[] {
  return root
    .findAll(
      (node: any) =>
        typeof node.type === 'string' &&
        typeof node.props?.accessibilityLabel === 'string' &&
        (node.props.accessibilityLabel.startsWith('Filter by ') ||
          node.props.accessibilityLabel.startsWith('Distance filter')),
      { deep: true }
    )
    .map((node: any) => node.props.accessibilityLabel);
}

describe('BountyFeed filter carousel', () => {
  afterEach(cleanup);

  it('renders exactly one horizontal carousel', async () => {
    const { UNSAFE_root } = renderFeed();
    await waitFor(() => expect(chipLabelsInOrder(UNSAFE_root).length).toBeGreaterThan(0));

    const horizontalLists = UNSAFE_root.findAll(
      (node: any) => typeof node.type === 'string' && node.props?.horizontal === true,
      { deep: true }
    );
    expect(horizontalLists).toHaveLength(1);
  });

  it('places the Distance chip between Delivery and Other in the same carousel', async () => {
    const { UNSAFE_root } = renderFeed();
    await waitFor(() => expect(chipLabelsInOrder(UNSAFE_root).length).toBeGreaterThan(0));

    const labels = chipLabelsInOrder(UNSAFE_root);
    const delivery = labels.indexOf('Filter by Delivery');
    const distance = labels.findIndex((l) => l.startsWith('Distance filter'));
    const other = labels.indexOf('Filter by Other');

    expect(delivery).toBeGreaterThanOrEqual(0);
    expect(distance).toBe(delivery + 1);
    expect(other).toBe(distance + 1);
  });

  it('keeps every category chip when the Distance chip is injected', async () => {
    const { UNSAFE_root } = renderFeed();
    await waitFor(() => expect(chipLabelsInOrder(UNSAFE_root).length).toBeGreaterThan(0));

    const labels = chipLabelsInOrder(UNSAFE_root);
    ;['For You', 'Tech', 'Design', 'Writing', 'Labor', 'Delivery', 'Other'].forEach((category) => {
      expect(labels.some((l) => l.startsWith(`Filter by ${category}`))).toBe(true);
    });
  });
});
