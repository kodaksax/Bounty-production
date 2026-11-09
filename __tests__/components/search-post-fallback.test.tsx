/**
 * Search (app/tabs/search.tsx): a query that reads like a job request and
 * finds nothing offers "Need this done? Post it as a bounty", and one tap
 * puts it in the composer's draft and opens the composer.
 *
 * Also covers the typing-paced debounce: one query for a sentence, however
 * slowly it is typed.
 */

import { act, fireEvent, render, screen } from '@testing-library/react-native';

const mockStore = new Map<string, string>();
jest.mock('lib/storage', () => ({
  storage: {
    getItem: jest.fn(async (key: string) => mockStore.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      mockStore.set(key, value);
    }),
    removeItem: jest.fn(async (key: string) => {
      mockStore.delete(key);
    }),
  },
}));
jest.mock('lib/services/draft-reminder', () => ({
  cancelDraftReminder: jest.fn(async () => {}),
  scheduleDraftReminderSoon: jest.fn(),
}));
jest.mock('lib/storage/abandoned-draft', () => ({ clearDraftAbandoned: jest.fn(async () => {}) }));

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => true) };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => ({}),
}));

const mockSearchWithFilters = jest.fn();
jest.mock('../../lib/services/bounty-service', () => ({
  bountyService: { searchWithFilters: (...args: unknown[]) => mockSearchWithFilters(...args) },
}));
jest.mock('../../lib/services/search-service', () => ({
  searchService: {
    getTrendingBounties: jest.fn(async () => []),
    getLastFilters: jest.fn(async () => null),
    saveLastFilters: jest.fn(async () => {}),
    getAutocompleteSuggestions: jest.fn(async () => []),
  },
}));
jest.mock('../../lib/services/recent-search-service', () => ({
  recentSearchService: {
    getRecentSearchesByType: jest.fn(async () => []),
    saveSearch: jest.fn(async () => {}),
    removeSearch: jest.fn(async () => {}),
    clearAll: jest.fn(async () => {}),
  },
}));
jest.mock('../../lib/services/user-search-service', () => ({
  userSearchService: { searchUsers: jest.fn(async () => ({ results: [] })) },
}));
jest.mock('../../lib/services/auth-profile-service', () => ({
  authProfileService: {
    getCurrentProfile: () => null,
    getPrimaryRoleForAnalytics: () => 'poster',
  },
}));
const mockTrackEvent = jest.fn();
jest.mock('../../lib/services/analytics-service', () => ({
  analyticsService: { trackEvent: (...args: unknown[]) => mockTrackEvent(...args) },
}));
jest.mock('../../hooks/useShowTestBounties', () => ({ useShowTestBounties: () => ({ showTestBounties: false }) }));
jest.mock('../../hooks/use-auth-context', () => ({
  useAuthContext: () => ({ session: { user: { id: 'user-1' } } }),
}));
jest.mock('../../lib/config/maps', () => ({ isNativeMapAvailable: false }));
jest.mock('../../components/ui/skeleton', () => ({ Skeleton: () => null }));
jest.mock('../../components/ui/active-hunters-pill', () => ({
  ActiveHuntersPill: () => null,
  MIN_ACTIVE_HUNTERS_TO_SHOW: 3,
}));
jest.mock('../../components/ui/avatar', () => ({
  Avatar: () => null,
  AvatarImage: () => null,
  AvatarFallback: () => null,
}));
jest.mock('../../lib/utils/serviceable-region', () => ({
  coarseRegionFromLocationText: () => null,
  getDeviceServiceabilityContext: () => ({}),
}));

// jest.setup's react-native mock renders FlatList as an empty host element.
// Results, the empty state and the footer are what these tests read, so
// render them. (search.tsx reads FlatList off the module at render time.)
{
  const RN = require('react-native');
  const ReactMock = require('react');
  // Search leaves through its exit animation's completion callback, which
  // the global mock never calls.
  RN.Animated.parallel = () => ({ start: (cb?: () => void) => cb?.(), stop: () => {} });
  const asElement = (c: any) =>
    c == null ? null : typeof c === 'function' ? ReactMock.createElement(c) : c;
  RN.FlatList = ({ data = [], renderItem, keyExtractor, ListEmptyComponent, ListFooterComponent }: any) =>
    ReactMock.createElement(
      'FlatList',
      {},
      data.length === 0 ? asElement(ListEmptyComponent) : null,
      ...data.map((item: any, index: number) =>
        ReactMock.createElement(
          ReactMock.Fragment,
          { key: keyExtractor ? keyExtractor(item, index) : index },
          renderItem({ item, index })
        )
      ),
      asElement(ListFooterComponent)
    );
}

import EnhancedSearchScreen from 'app/tabs/search';
import { subscribeComposerRequests } from 'lib/navigation/composer-request';

const QUERY = 'Remove home trash to apt.';
const DRAFT_KEY = 'bounty-draft-v1:user-1';

function bountySearchCalls() {
  return mockSearchWithFilters.mock.calls.filter(([args]) => args.keywords);
}

function typeSlowly(input: ReturnType<typeof screen.getByPlaceholderText>, text: string, gapMs: number) {
  for (let i = 1; i <= text.length; i++) {
    fireEvent.changeText(input, text.slice(0, i));
    act(() => {
      jest.advanceTimersByTime(gapMs);
    });
  }
}

async function settle(ms = 2000) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
  // Let the resolved search promise chain flush.
  await act(async () => {});
}

beforeEach(() => {
  jest.useFakeTimers();
  mockStore.clear();
  mockTrackEvent.mockClear();
  mockSearchWithFilters.mockReset();
  mockSearchWithFilters.mockResolvedValue([]);
  Object.values(mockRouter).forEach((fn) => (fn as jest.Mock).mockClear());
});

afterEach(() => {
  jest.useRealTimers();
});

describe('Search: post it as a bounty', () => {
  it('shows the card for a job-like query with no matches, and one tap opens the composer with it', async () => {
    const composerRequests = jest.fn();
    const unsubscribe = subscribeComposerRequests(composerRequests);

    render(<EnhancedSearchScreen />);
    await settle();
    fireEvent.changeText(screen.getByPlaceholderText('Search bounties or users...'), QUERY);
    await settle();

    expect(screen.getByText('Need this done? Post it as a bounty')).toBeTruthy();
    expect(screen.getByTestId('post-from-search-quote').props.children).toBe(`“${QUERY}”`);
    expect(screen.queryByText('No bounties found')).toBeNull();

    await act(async () => {
      fireEvent.press(screen.getByTestId('post-from-search-button'));
    });
    await settle();

    expect(JSON.parse(mockStore.get(DRAFT_KEY)!).title).toBe(QUERY);
    expect(composerRequests).toHaveBeenCalledWith('search_fallback');
    expect(mockRouter.back).toHaveBeenCalled();
    unsubscribe();
  });

  it('needs 3 words: two words show the plain empty state', async () => {
    render(<EnhancedSearchScreen />);
    await settle();
    fireEvent.changeText(screen.getByPlaceholderText('Search bounties or users...'), 'Carry boxes');
    await settle();

    expect(screen.queryByTestId('post-from-search-card-prominent')).toBeNull();
    expect(screen.getByText('No bounties found')).toBeTruthy();
  });

  it('shows the compact card under results', async () => {
    mockSearchWithFilters.mockImplementation(async (args: { keywords?: string }) =>
      args.keywords
        ? [{ id: 7, title: 'Haul trash to the curb', description: 'Weekly', amount: 20, status: 'open' }]
        : []
    );
    render(<EnhancedSearchScreen />);
    await settle();
    fireEvent.changeText(screen.getByPlaceholderText('Search bounties or users...'), 'haul trash to curb');
    await settle();

    expect(screen.getByText('Haul trash to the curb')).toBeTruthy();
    expect(screen.getByTestId('post-from-search-card-compact')).toBeTruthy();
    expect(screen.queryByTestId('post-from-search-card-prominent')).toBeNull();
  });

  it('reports search_post_cta_shown / _tapped without the query text', async () => {
    render(<EnhancedSearchScreen />);
    await settle();
    fireEvent.changeText(screen.getByPlaceholderText('Search bounties or users...'), QUERY);
    await settle();
    await act(async () => {
      fireEvent.press(screen.getByTestId('post-from-search-button'));
    });
    await settle();

    const expected = { query_length: QUERY.length, had_zero_results: true, entry_point: 'search_fallback' };
    const shown = mockTrackEvent.mock.calls.filter(([name]) => name === 'search_post_cta_shown');
    const tapped = mockTrackEvent.mock.calls.filter(([name]) => name === 'search_post_cta_tapped');
    expect(shown).toEqual([['search_post_cta_shown', expected]]);
    expect(tapped).toEqual([['search_post_cta_tapped', expected]]);
    for (const [, props] of [...shown, ...tapped]) {
      expect(Object.keys(props).sort()).toEqual(['entry_point', 'had_zero_results', 'query_length']);
      expect(JSON.stringify(props)).not.toMatch(/trash|Remove|apt/);
    }
  });
});

describe('Search: typing-paced debounce', () => {
  it('sends one query for a sentence typed quickly', async () => {
    render(<EnhancedSearchScreen />);
    await settle();
    typeSlowly(screen.getByPlaceholderText('Search bounties or users...'), QUERY, 120);
    await settle();

    expect(bountySearchCalls().map(([args]) => args.keywords)).toEqual([QUERY]);
  });

  it('sends one query for a sentence typed a key every 580 ms', async () => {
    // The Nov 7 session's pace. A fixed 300 ms debounce sent one query per
    // keystroke here.
    render(<EnhancedSearchScreen />);
    await settle();
    typeSlowly(screen.getByPlaceholderText('Search bounties or users...'), QUERY, 580);
    await settle();

    const keywords = bountySearchCalls().map(([args]) => args.keywords);
    // The first couple of keys come before a pace exists and still search
    // at 300 ms; after that, nothing until the sentence is done.
    expect(keywords.length).toBeLessThanOrEqual(3);
    expect(keywords[keywords.length - 1]).toBe(QUERY);
  });
});
