/**
 * A returning poster reaches her job first (2026-11-17, swarm 3: "Bea" spent
 * her step budget on three sheets in a row and never reached hiring).
 *
 * Renders the real BountyFeed (Home) with the real MomentsProvider and
 * MomentSheet over it, as the tab shell does:
 *
 *  - a returning poster with 3 offers waiting sees her job card and no sheet,
 *    although a moment is otherwise eligible for her;
 *  - no moment can appear while Home's reads of her jobs or their offers are
 *    in flight (this fails if the gate is removed or opens early);
 *  - with nothing needing her, the one moment of the session does appear,
 *    once those reads are done;
 *  - the job card opens her job page in one tap.
 *
 * The react-native and child-component mocks are the lifecycle-visibility
 * feed suite's, plus AppState for MomentsProvider.
 */

const PREV_API_TIMEOUT = process.env.API_TIMEOUT;
// Long enough that a read a test holds in flight is still in flight, not
// timed out (a timed-out read is a failed one, and the gate keeps waiting).
process.env.API_TIMEOUT = '5000';

import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
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
    // MomentsProvider re-evaluates on foreground.
    AppState: { currentState: 'active', addEventListener: jest.fn(() => ({ remove: jest.fn() })) },
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
const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }), useIsFocused: () => true }));
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
// AsyncStorage that keeps what is written, as on a device: the session count
// and the prompt gate's closed-session record live here.
const mockAsyncStore = new Map<string, string>();
let mockPendingCancellations: any[] = [];
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (key: string) => mockAsyncStore.get(key) ?? null),
  setItem: jest.fn(async (key: string, value: string) => {
    mockAsyncStore.set(key, value);
  }),
  removeItem: jest.fn(async (key: string) => {
    mockAsyncStore.delete(key);
  }),
}));
let mockLocationPermission: any = { granted: false };
const mockRequestLocation = jest.fn();
jest.mock(
  'app/hooks/useLocation',
  () => ({
    useLocation: () => ({
      location: null,
      permission: mockLocationPermission,
      requestPermission: mockRequestLocation,
    }),
  }),
  { virtual: true }
);
jest.mock('../../lib/services/location-service', () => ({
  locationService: {
    calculateDistance: jest.fn().mockReturnValue(1),
    getPermissionStatus: jest.fn().mockResolvedValue({ status: 'granted', granted: true, canAskAgain: true }),
    requestPermission: jest.fn(),
  },
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
// The offer counts Home reads for her open jobs; held in flight by a test.
jest.mock('../../lib/services/poster-job-activity', () => ({
  ...jest.requireActual('../../lib/services/poster-job-activity'),
  getPendingOfferCounts: jest.fn(),
}));
// The job card, as a button that reports what the feed handed it.
jest.mock('../../components/my-bounty-progress-banner', () => ({
  ...jest.requireActual('../../components/my-bounty-progress-banner'),
  MyBountyProgressCarousel: ({ items, onPressItem }: any) =>
    require('react').createElement(
      'View',
      {},
      items.map((i: any) =>
        require('react').createElement(
          'TouchableOpacity',
          { key: i.bounty.id, testID: 'job-card', onPress: () => onPressItem(i.bounty) },
          require('react').createElement(
            'Text',
            {},
            i.stage === 'open' && i.offerCount > 0
              ? `${i.bounty.title}: ${i.offerCount} people offered · your move`
              : `${i.bounty.title}: ${i.stage}`
          )
        )
      )
    ),
}));
// The sheet itself is real; only the native modal is a plain view.
jest.mock('../../components/ui/app-modal', () => ({
  AppModal: ({ visible, children }: any) =>
    visible ? require('react').createElement('View', { testID: 'moment-modal' }, children) : null,
}));
jest.mock('../../lib/haptic-feedback', () => ({
  hapticFeedback: { light: jest.fn(), medium: jest.fn(), selection: jest.fn(), success: jest.fn() },
}));

// --- MomentsProvider's own inputs: a returning poster who has published. ---
jest.mock('../../hooks/use-auth-context', () => ({
  useAuthContext: () => ({ session: { user: { id: 'user-123' } } }),
}));
const mockProfile = {
  id: 'user-123',
  created_at: '2026-09-01T00:00:00Z',
  primary_role: 'poster',
  avatar: null,
  about: null,
  location: null,
  balance: 0,
  id_verification_status: 'unverified',
  last_session_at: '2026-11-10T00:00:00Z',
};
jest.mock('../../hooks/useAuthProfile', () => ({
  useAuthProfile: () => ({ profile: mockProfile }),
}));
jest.mock('../../lib/moments/eligibilityFixFlag', () => ({
  useMomentsEligibilityFixEnabled: () => true,
}));
jest.mock('../../lib/moments/backfill', () => ({
  backfillEventMoments: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../lib/moments/momentsService', () => ({
  momentsService: {
    fetchStates: jest.fn(() => Promise.resolve(new Map())),
    markShown: jest.fn(() => Promise.resolve(true)),
    markDismissed: jest.fn(() => Promise.resolve(true)),
    markCompleted: jest.fn(() => Promise.resolve()),
    markExpired: jest.fn(() => Promise.resolve()),
    markSnoozed: jest.fn(() => Promise.resolve()),
    markStarted: jest.fn(() => Promise.resolve()),
    enqueue: jest.fn(() => Promise.resolve()),
  },
}));
jest.mock('../../lib/services/analytics-service', () => ({
  analyticsService: { trackEvent: jest.fn() },
}));
// Notifications never asked: enable_notifications is eligible on Home for a
// published poster, so without the gate it would open over her job.
jest.mock('../../lib/services/notification-service', () => ({
  notificationService: {
    getPermissionStatus: jest.fn(() => Promise.resolve('undetermined')),
    requestPermissionsAndRegisterToken: jest.fn(() => Promise.resolve(null)),
  },
}));

// Supabase: every query resolves empty (no disputes, cancellations or hires)
// except her published-bounty count; realtime is inert.
jest.mock('../../lib/supabase', () => {
  const channel: any = {
    on: jest.fn(() => channel),
    subscribe: jest.fn(() => channel),
    unsubscribe: jest.fn(),
  };
  const builder = (table: string): any => {
    const result = {
      data: table === 'bounty_cancellations' ? mockPendingCancellations : [],
      error: null,
      count: table === 'bounties' ? 1 : 0,
    };
    const b: any = new Proxy(
      {},
      {
        get: (_t, prop) => {
          if (prop === 'then') return (res: any, rej: any) => Promise.resolve(result).then(res, rej);
          if (prop === 'maybeSingle' || prop === 'single')
            return () => Promise.resolve({ data: null, error: null });
          return () => b;
        },
      }
    );
    return b;
  };
  return {
    isSupabaseConfigured: true,
    supabase: {
      from: jest.fn((table: string) => builder(table)),
      channel: jest.fn(() => channel),
      removeChannel: jest.fn(() => channel),
    },
  };
});

let BountyFeed: any;
let MomentsProvider: any;
let MomentSheet: any;
let bountyService: any;
let bountyRequestService: any;
let completionService: any;
let getPendingOfferCounts: jest.Mock;
let momentsService: any;
let analyticsService: any;
let resetPromptGateForTests: () => void;
let resetSessionRecordsForTests: () => void;
let promptGateState: (userId: string) => string;

const MY_JOB = {
  id: 'job-1',
  title: 'Clean out my garage',
  amount: 80,
  is_for_honor: false,
  work_type: 'in_person',
  status: 'open',
  poster_id: 'user-123',
  accepted_by: null,
  created_at: '2026-11-15T10:00:00Z',
};

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>(r => (resolve = r));
  return { promise, resolve };
}

const renderHome = (activeScreen = 'bounty') =>
  render(
    React.createElement(
      MomentsProvider,
      { activeScreen },
      React.createElement(BountyFeed, {
        activeScreen,
        setActiveScreen: jest.fn(),
        currentUserId: 'user-123',
      }),
      React.createElement(MomentSheet)
    )
  );

/** Let every pending read and effect run. */
async function settle(rounds = 6) {
  for (let i = 0; i < rounds; i++) {
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });
  }
}

describe('a returning poster reaches her job first', () => {
  beforeAll(() => {
    ({ BountyFeed } = require('../../components/bounty-feed'));
    ({ MomentsProvider } = require('../../providers/moments-provider'));
    ({ MomentSheet } = require('../../components/moments/MomentSheet'));
    ({ bountyService } = require('../../lib/services/bounty-service'));
    ({ bountyRequestService } = require('../../lib/services/bounty-request-service'));
    ({ completionService } = require('../../lib/services/completion-service'));
    ({ getPendingOfferCounts } = require('../../lib/services/poster-job-activity'));
    ({ momentsService } = require('../../lib/moments/momentsService'));
    ({ analyticsService } = require('../../lib/services/analytics-service'));
    ({ resetPromptGateForTests } = require('../../lib/moments/sessionPromptGate'));
    ({ promptGateState } = require('../../lib/moments/sessionPromptGate'));
    ({ resetSessionRecordsForTests } = require('../../lib/moments/sessionTracking'));
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockAsyncStore.clear();
    mockPendingCancellations = [];
    mockLocationPermission = { granted: false };
    resetPromptGateForTests();
    resetSessionRecordsForTests();
    // Her own jobs (Home's carousel) vs. the open feed.
    bountyService.getAll.mockImplementation((params: any) =>
      Promise.resolve(params?.userId ? [MY_JOB] : [])
    );
    bountyRequestService.getAll.mockResolvedValue([]);
    completionService.getLatestSubmissionsForBounties.mockResolvedValue(new Map());
  });

  afterEach(() => {
    cleanup();
  });

  afterAll(() => {
    if (PREV_API_TIMEOUT === undefined) delete process.env.API_TIMEOUT;
    else process.env.API_TIMEOUT = PREV_API_TIMEOUT;
  });

  it('with 3 offers waiting, Home shows her job card and no sheet', async () => {
    getPendingOfferCounts.mockResolvedValue(new Map([['job-1', 3]]));
    const screen = renderHome();

    await waitFor(() =>
      expect(screen.getByText('Clean out my garage: 3 people offered · your move')).toBeTruthy()
    );
    await settle();

    expect(screen.queryByTestId('moment-modal')).toBeNull();
    expect(momentsService.markShown).not.toHaveBeenCalled();
    // The moment that would have opened was held because her job needs her.
    expect(analyticsService.trackEvent).toHaveBeenCalledWith('moment_skipped', {
      momentType: 'enable_notifications',
      reason: 'jobs_need_you',
    });
  });

  it('holds prompts for expired and cancellation-requested jobs on a non-Home tab', async () => {
    const expired = { ...MY_JOB, id: 'expired-job', end_date: '2020-01-01T00:00:00Z' };
    const cancellationRequested = {
      ...MY_JOB,
      id: 'cancellation-job',
      status: 'cancellation_requested',
    };
    bountyService.getAll.mockImplementation((params: any) =>
      Promise.resolve(params?.userId ? [expired, cancellationRequested] : [])
    );
    mockPendingCancellations = [
      {
        bounty_id: 'cancellation-job',
        status: 'pending',
        requester_type: 'hunter',
        created_at: '2026-11-18T00:00:00Z',
      },
    ];
    getPendingOfferCounts.mockResolvedValue(new Map());
    const screen = renderHome('wallet');

    await waitFor(() => expect(promptGateState('user-123')).toBe('closed'));
    expect(screen.queryByTestId('job-card')).toBeNull();
    expect(bountyService.getAll).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-123',
        statuses: ['open', 'in_progress', 'cancellation_requested'],
      })
    );
  });

  it('opens her job page from the card in one tap', async () => {
    getPendingOfferCounts.mockResolvedValue(new Map([['job-1', 3]]));
    const screen = renderHome();
    const card = await screen.findByTestId('job-card');
    fireEvent.press(card);
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/postings/[bountyId]',
      params: { bountyId: 'job-1' },
    });
  });

  it('opens no sheet while the offers on her jobs are still loading', async () => {
    const offers = deferred<Map<string, number>>();
    getPendingOfferCounts.mockReturnValue(offers.promise);
    const screen = renderHome();

    // Her jobs have loaded and their offers are being read; the moments
    // queue has its states, permissions and session.
    await waitFor(() => expect(getPendingOfferCounts).toHaveBeenCalledWith(['job-1']));
    await waitFor(() => expect(momentsService.fetchStates).toHaveBeenCalled());
    await settle();
    expect(screen.queryByTestId('moment-modal')).toBeNull();
    expect(momentsService.markShown).not.toHaveBeenCalled();

    // Nothing waiting on her: her card shows, then the session's one prompt.
    await act(async () => {
      offers.resolve(new Map());
    });
    await waitFor(() => expect(screen.getByTestId('job-card')).toBeTruthy());
    await waitFor(() => expect(screen.getByTestId('moment-modal')).toBeTruthy());
    expect(screen.getByText('Hear when someone applies')).toBeTruthy();
    expect(momentsService.markShown).toHaveBeenCalledTimes(1);
  });

  it('opens no sheet while her jobs themselves are still loading', async () => {
    const jobs = deferred<any[]>();
    bountyService.getAll.mockImplementation((params: any) =>
      params?.userId ? jobs.promise : Promise.resolve([])
    );
    getPendingOfferCounts.mockResolvedValue(new Map());
    const screen = renderHome();

    await waitFor(() => expect(momentsService.fetchStates).toHaveBeenCalled());
    await settle();
    expect(screen.queryByTestId('moment-modal')).toBeNull();
    expect(momentsService.markShown).not.toHaveBeenCalled();

    await act(async () => {
      jobs.resolve([MY_JOB]);
    });
    await waitFor(() => expect(screen.getByTestId('moment-modal')).toBeTruthy());
  });

  it('first run: a new poster who lands on Post still gets her jobs read, so prompts are not held up', async () => {
    bountyService.getAll.mockImplementation(() => Promise.resolve([]));
    getPendingOfferCounts.mockResolvedValue(new Map());
    const { promptGateState } = require('../../lib/moments/sessionPromptGate');
    renderHome('postings');

    await waitFor(() =>
      expect(bountyService.getAll).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-123' }))
    );
    // Decided rather than waiting: Home's read of her (zero) jobs went through
    // although she never visited Home.
    await waitFor(() => expect(promptGateState('user-123')).not.toBe('waiting'));
  });

  it('asks for location when she picks a distance, after saying why, never on its own', async () => {
    mockLocationPermission = { granted: false, canAskAgain: true, status: 'undetermined' };
    getPendingOfferCounts.mockResolvedValue(new Map());
    const screen = renderHome();
    await settle();
    expect(mockRequestLocation).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId('feed-distance-filter'));
    expect(
      screen.getByText('Pick a distance and we’ll ask to use your location, so we can show jobs near you.')
    ).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Within 5 miles'));
    expect(mockRequestLocation).toHaveBeenCalledTimes(1);
  });

  it('does not ask for location once the OS will no longer show its dialog', async () => {
    mockLocationPermission = { granted: false, canAskAgain: false, status: 'denied' };
    getPendingOfferCounts.mockResolvedValue(new Map());
    const screen = renderHome();
    await settle();
    fireEvent.press(screen.getByTestId('feed-distance-filter'));
    fireEvent.press(screen.getByLabelText('Within 5 miles'));
    expect(mockRequestLocation).not.toHaveBeenCalled();
  });

  it('keeps waiting, rather than guessing, when the offers read fails', async () => {
    getPendingOfferCounts.mockRejectedValue(new Error('network down'));
    const screen = renderHome();
    await waitFor(() => expect(screen.getByTestId('job-card')).toBeTruthy());
    await settle();
    expect(screen.queryByTestId('moment-modal')).toBeNull();
    expect(momentsService.markShown).not.toHaveBeenCalled();
  });
});
