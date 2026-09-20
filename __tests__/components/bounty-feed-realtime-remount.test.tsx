/**
 * Regression test for the "cannot add postgres_changes callbacks after
 * subscribe()" crash (#840).
 *
 * supabase-js returns the SAME RealtimeChannel object for a topic that
 * already exists on the client, and removeChannel() resolves asynchronously.
 * So a brief double-mount of BountyFeed — the previous instance's
 * removeChannel() still in flight when the next instance mounts — used to
 * hand the new mount an already-subscribed channel for the fixed topic
 * 'bounty-feed:bounties', and its first .on('postgres_changes', ...) call
 * threw and escaped the mount effect.
 *
 * The original fix used a useId() value alone. useId() is deterministic for
 * a given tree position, so a component that unmounts and remounts at the
 * same spot can be handed the same id back (this is a documented React
 * behavior, not a bug) — which would silently reintroduce this exact
 * collision. The real fix pairs useId() with a module-level mount counter
 * (bumped once per mount via a useState lazy initializer), so the topic
 * can't repeat even when useId() does.
 *
 * This suite mocks 'react' so useId() ALWAYS returns the same value —
 * reproducing the collision scenario directly rather than relying on
 * whatever useId() happens to do in this test renderer — and a supabase
 * client that behaves like the real one (same channel object returned per
 * topic, .on() throwing once a channel is subscribed). It asserts that an
 * unmount immediately followed by a remount still gets a fresh, distinct
 * topic and never reuses the already-subscribed channel.
 */

// Match the other BountyFeed suites: a short network timeout keeps things
// fast under real timers, restored in afterAll.
const PREV_API_TIMEOUT = process.env.API_TIMEOUT;
process.env.API_TIMEOUT = '150';

import { cleanup, render, waitFor } from '@testing-library/react-native';
import React from 'react';

// Force useId() to return the same value on every call, simulating the
// reported failure mode where a remount at the same tree position gets back
// an identical id. Everything else passes through the real React module.
jest.mock('react', () => {
  const actualReact = jest.requireActual('react');
  return {
    ...actualReact,
    useId: () => '_collided_id_',
  };
});

// --- Rich react-native mock (the global jest.setup mock lacks Animated.FlatList
// / RefreshControl / Animated.event that this component relies on). ---
jest.mock('react-native', () => {
  const ReactMock = require('react');
  const passthrough =
    (name: string) =>
    ({ children, ...props }: any) =>
      ReactMock.createElement(name, props, children);

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
    StyleSheet: { create: (s: any) => s, flatten: (s: any) => s },
    Dimensions: { get: () => ({ width: 375, height: 812 }) },
    useWindowDimensions: () => ({ width: 375, height: 812, scale: 2, fontScale: 1 }),
    Keyboard: { addListener: () => ({ remove: () => {} }), dismiss: () => {} },
    Animated,
    FlatList,
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
  bountyService: { getAll: jest.fn().mockResolvedValue([]), getOpenCount: jest.fn().mockResolvedValue(0) },
}));
jest.mock('../../lib/services/bounty-request-service', () => ({
  bountyRequestService: { getAll: jest.fn().mockResolvedValue([]) },
}));

// A supabase mock that reproduces the two real behaviors that combine to
// cause the crash:
//   1. .channel(topic) returns the SAME object for a topic already on the
//      client, rather than creating a new one.
//   2. Once a channel has been .subscribe()'d, calling .on() on it again
//      throws — matching "cannot add postgres_changes callbacks after
//      subscribe()".
// removeChannel() never actually drops the topic from the registry within a
// test (nothing awaits or flushes it), which stands in for it "still being
// in flight" — the exact race the bug report describes.
jest.mock('../../lib/supabase', () => {
  const registry = new Map<string, any>();

  function makeChannel(topic: string) {
    const channel: any = {
      _topic: topic,
      _subscribed: false,
      on: jest.fn((_type: string, _config: any, _handler: any) => {
        if (channel._subscribed) {
          throw new Error(
            `tried to subscribe multiple times. 'subscribe' can only be called a single time per channel instance`
          );
        }
        return channel;
      }),
      subscribe: jest.fn(() => {
        channel._subscribed = true;
        return channel;
      }),
      unsubscribe: jest.fn(),
    };
    return channel;
  }

  const channel = jest.fn((topic: string) => {
    if (!registry.has(topic)) {
      registry.set(topic, makeChannel(topic));
    }
    return registry.get(topic);
  });

  const removeChannel = jest.fn(() => Promise.resolve('ok'));

  return { supabase: { channel, removeChannel } };
});

// Lazily required after env + mocks are in place.
let BountyFeed: any;
let supabase: any;

const feedElement = () =>
  React.createElement(BountyFeed, {
    activeScreen: 'bounty',
    setActiveScreen: jest.fn(),
    currentUserId: 'user-123',
  });

describe('BountyFeed realtime channel remount safety', () => {
  beforeAll(() => {
    ({ BountyFeed } = require('../../components/bounty-feed'));
    ({ supabase } = require('../../lib/supabase'));
  });

  beforeEach(() => {
    supabase.channel.mockClear();
    supabase.removeChannel.mockClear();
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

  it('gives a remounted feed its own topic instead of reusing an already-subscribed channel', async () => {
    // Unmount/remount the feed at the SAME tree position, via one render's
    // rerender(), rather than two separate render() calls — matching the
    // reported double-mount race — combined with the useId() mock above that
    // always returns the same id. Without the mount-counter suffix, this
    // setup would deterministically reproduce the original bug: both mounts
    // would request the identical topic.
    const { rerender } = render(feedElement());
    await waitFor(() => expect(supabase.channel).toHaveBeenCalledTimes(1));

    const firstTopic = supabase.channel.mock.calls[0][0];
    const firstChannel = supabase.channel.mock.results[0].value;
    expect(firstChannel.subscribe).toHaveBeenCalledTimes(1);
    expect(firstChannel._subscribed).toBe(true);

    // Unmount (render null) runs the effect cleanup (removeChannel()), but —
    // like real supabase-js — that resolution never lands within this test,
    // so the first channel is still registered under firstTopic afterward.
    rerender(null as any);
    expect(supabase.removeChannel).toHaveBeenCalledTimes(1);

    // Remount immediately, before that cleanup would have settled: this is
    // the double-mount race from the bug report.
    expect(() => rerender(feedElement())).not.toThrow();
    await waitFor(() => expect(supabase.channel).toHaveBeenCalledTimes(2));

    const secondTopic = supabase.channel.mock.calls[1][0];
    const secondChannel = supabase.channel.mock.results[1].value;

    // The fix: distinct topics per mount, so the remount gets its own fresh
    // (unsubscribed) channel rather than the first, already-subscribed one.
    expect(secondTopic).not.toEqual(firstTopic);
    expect(secondChannel).not.toBe(firstChannel);
    expect(secondChannel.subscribe).toHaveBeenCalledTimes(1);

    // Confirm the mock is actually exercising the real failure mode: had the
    // remount reused firstTopic, registering its postgres_changes handlers
    // on the still-subscribed first channel would have thrown.
    expect(() => {
      const reused = supabase.channel(firstTopic);
      reused.on('postgres_changes', { event: 'INSERT' }, () => {});
    }).toThrow(/single time per channel instance/);
  });

  it('keeps generating distinct topics across several rapid remounts at the same position', async () => {
    const { rerender } = render(feedElement());
    await waitFor(() => expect(supabase.channel).toHaveBeenCalledTimes(1));
    const topics = new Set<string>([supabase.channel.mock.calls[0][0]]);

    for (let i = 1; i < 3; i++) {
      rerender(null as any);
      rerender(feedElement());
      await waitFor(() => expect(supabase.channel).toHaveBeenCalledTimes(i + 1));
      topics.add(supabase.channel.mock.calls[i][0]);
    }

    expect(topics.size).toBe(3);
  });
});
