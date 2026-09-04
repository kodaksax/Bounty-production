import { MaterialIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Animated,
    Easing,
    FlatList,
    Keyboard,
    Modal,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import {
    ActiveHuntersPill,
    MIN_ACTIVE_HUNTERS_TO_SHOW,
} from '../../components/ui/active-hunters-pill';
import { EmptyState } from '../../components/ui/empty-state';
import {
    SEARCH_FIELD_MAX_FONT_SCALE,
    SEARCH_FIELD_TEXT,
    SearchBarRow,
    SearchRowIconButton,
} from '../../components/ui/search-bar-row';
import { Skeleton } from '../../components/ui/skeleton';
import { useAccessibleAnimation } from '../../hooks/use-accessible-animation';
import { consumeIsFirstBountyListViewOfSession } from '../../lib/analytics/sessionFlags';
import { A11Y, SPACING } from '../../lib/constants/accessibility';
import { analyticsService } from '../../lib/services/analytics-service';
import { authProfileService } from '../../lib/services/auth-profile-service';
import { bountyService } from '../../lib/services/bounty-service';
import type { Bounty } from '../../lib/services/database.types';
import { recentSearchService } from '../../lib/services/recent-search-service';
import { searchService } from '../../lib/services/search-service';
import { userSearchService } from '../../lib/services/user-search-service';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../lib/themes/types';
import type {
    AutocompleteSuggestion,
    BountySearchFilters,
    RecentSearch,
    TrendingBounty,
    UserProfile,
} from '../../lib/types';
import { logger } from '../../lib/utils/error-logger';
import { coarseRegionFromLocationText, getDeviceServiceabilityContext } from '../../lib/utils/serviceable-region';
/**
 * react-native-maps and its clustering wrapper are heavy modules, and a static
 * import runs their initialisation the first time this screen's module is
 * required — i.e. on the way in from the feed, for every user, including the
 * majority who never open the map at all. That work landed in the same frames
 * as the arrival animation and showed as a hitch. Deferred here to the first
 * time the map is actually asked for.
 */
const BountyMapView = lazy(() =>
  import('../../components/location/BountyMapView').then(m => ({ default: m.BountyMapView }))
);

type SearchTab = 'bounties' | 'users';

// Debounce delay for autocomplete (500ms as per requirements)
const AUTOCOMPLETE_DEBOUNCE_MS = 500;

/**
 * How long the arrival animation will wait for the screen's initial data
 * before playing anyway. Long enough for the two AsyncStorage reads and a
 * healthy trending fetch, short enough that a stalled network reads as a
 * beat rather than a hang.
 */
const ENTRANCE_MAX_WAIT_MS = 300;

interface BountyRowItem {
  id: string;
  title: string;
  description: string;
  amount?: number | null;
  created_at?: string;
  is_for_honor?: boolean;
  location?: string;
  status?: string;
}

// Human-readable filter tokens for analytics — never the raw query text.
function describeBountyFilters(filters: BountySearchFilters): string[] {
  const applied: string[] = [];
  if (filters.isForHonor === false) applied.push('paid_only');
  if (filters.isForHonor === true) applied.push('honor_only');
  if (filters.workType) applied.push(`work_type:${filters.workType}`);
  if (filters.minAmount != null) applied.push(`min_amount:${filters.minAmount}`);
  if (filters.maxAmount != null) applied.push(`max_amount:${filters.maxAmount}`);
  if (filters.skills && filters.skills.length > 0) applied.push('skills_filtered');
  if (filters.sortBy && filters.sortBy !== 'date_desc') applied.push(`sort:${filters.sortBy}`);
  return applied;
}

export default function EnhancedSearchScreen() {
  const router = useRouter();
  const { theme } = useAppThemeContext();
  const s = useMemo(() => makeStyles(theme), [theme]);
  // `hunters`/`radius` are passed by the feed's search bar so this screen can
  // redraw the same active-hunters pill without re-running the location query.
  // Absent (e.g. arriving from saved searches) simply means no pill.
  const { q, hunters, radius } = useLocalSearchParams<{
    q?: string;
    hunters?: string;
    radius?: string;
  }>();
  const activeHuntersCount = useMemo(() => {
    const parsed = Number(hunters);
    return Number.isFinite(parsed) && parsed >= MIN_ACTIVE_HUNTERS_TO_SHOW ? parsed : null;
  }, [hunters]);
  const activeHuntersRadius = useMemo(() => {
    const parsed = Number(radius);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }, [radius]);
  const [activeTab, setActiveTab] = useState<SearchTab>('bounties');
  const [query, setQuery] = useState('');
  const [bountyResults, setBountyResults] = useState<BountyRowItem[]>([]);
  const [userResults, setUserResults] = useState<UserProfile[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [recentSearches, setRecentSearches] = useState<RecentSearch[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autocompleteRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const filtersPersistRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Sequence token so a slower, earlier search response can't overwrite a
  // faster, later one's results (e.g. filters change shortly after typing,
  // firing two overlapping requests).
  const searchRequestIdRef = useRef(0);
  const [trendingBounties, setTrendingBounties] = useState<TrendingBounty[]>([]);
  const [isLoadingTrending, setIsLoadingTrending] = useState(true);

  // Autocomplete state
  const [suggestions, setSuggestions] = useState<AutocompleteSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [filtersLoaded, setFiltersLoaded] = useState(false);

  // ── Arrival animation ─────────────────────────────────────────────────────
  // The bar is pinned in place by design (see SearchBarRow), which on its own
  // makes arriving here read as nothing happening. So the screen announces
  // itself with what sits *under* the bar instead: the tab row and then the
  // results area rise and fade in, a beat apart, while the field's ring lights
  // up. The exit runs the same thing backwards before the pop, so closing
  // doesn't cut. Reduced motion collapses every duration to 0 via createTiming.
  const { createTiming } = useAccessibleAnimation();
  const chromeAnim = useRef(new Animated.Value(0)).current;
  const bodyAnim = useRef(new Animated.Value(0)).current;
  const isClosingRef = useRef(false);

  // Everything the first frame draws — saved filters, recent searches,
  // trending — arrives from an async load, and each one that lands late
  // changes the layout: a section appears, the skeletons swap for cards, the
  // results list shifts down. Animating before they settle means the content
  // slides in and *then* rearranges itself, which is the flicker this gate
  // exists to remove. Capped, so a slow trending fetch delays the screen by
  // ENTRANCE_MAX_WAIT_MS at worst instead of holding it indefinitely.
  const [recentsLoaded, setRecentsLoaded] = useState(false);
  const [waitedForContent, setWaitedForContent] = useState(false);
  const hasEnteredRef = useRef(false);

  useEffect(() => {
    const timer = setTimeout(() => setWaitedForContent(true), ENTRANCE_MAX_WAIT_MS);
    return () => clearTimeout(timer);
  }, []);

  const readyToEnter =
    (filtersLoaded && recentsLoaded && !isLoadingTrending) || waitedForContent;

  useEffect(() => {
    if (!readyToEnter || hasEnteredRef.current) return;
    hasEnteredRef.current = true;
    Animated.stagger(60, [
      createTiming(chromeAnim, 1, A11Y.ANIMATION_NORMAL, Easing.out(Easing.cubic)),
      createTiming(bodyAnim, 1, A11Y.ANIMATION_NORMAL, Easing.out(Easing.cubic)),
    ]).start();
  }, [readyToEnter, createTiming, chromeAnim, bodyAnim]);

  const enterStyle = useCallback(
    (value: Animated.Value, distance: number) => ({
      opacity: value,
      transform: [
        { translateY: value.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }) },
      ],
    }),
    []
  );

  // Close on our terms rather than letting the route pop under a static
  // screen: play the entrance backwards, then go. The hardware/gesture back
  // still pops immediately — this only covers the button we own. The
  // canGoBack fallback matters more here than it would for a plain back
  // button: on a cold deep link into search there is nothing to pop, and
  // without it the screen would sit there animated-out and empty.
  const closeSearch = useCallback(() => {
    if (isClosingRef.current) return;
    isClosingRef.current = true;
    Keyboard.dismiss();
    Animated.parallel([
      createTiming(bodyAnim, 0, A11Y.ANIMATION_FAST, Easing.in(Easing.cubic)),
      createTiming(chromeAnim, 0, A11Y.ANIMATION_FAST, Easing.in(Easing.cubic)),
    ]).start(() => {
      if (router.canGoBack()) {
        router.back();
      } else {
        router.replace('/tabs/bounty-app');
      }
    });
  }, [createTiming, bodyAnim, chromeAnim, router]);
  // Load trending bounties
  const loadTrendingBounties = useCallback(async () => {
    setIsLoadingTrending(true);
    try {
      const trending = await searchService.getTrendingBounties(5);
      const unique = Array.from(new Map(trending.map(t => [String(t.id), t])).values());
      setTrendingBounties(unique);
    } catch (error) {
      console.error('Error loading trending bounties:', error);
    } finally {
      setIsLoadingTrending(false);
    }
  }, []);
  // Bounty filters
  const [filters, setFilters] = useState<BountySearchFilters>({
    sortBy: 'date_desc',
    status: ['open'],
  });

  // Handle incoming query parameter from saved searches
  useEffect(() => {
    if (q && q.trim()) {
      setQuery(q);
    }
  }, [q]);

  // Load saved filters on mount
  useEffect(() => {
    const loadSavedFilters = async () => {
      const savedFilters = await searchService.getLastFilters();
      if (savedFilters) {
        setFilters(savedFilters);
      }
      setFiltersLoaded(true);
    };
    loadSavedFilters();
  }, []);
  useEffect(() => {
    loadTrendingBounties();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist filters when they change (debounced to reduce I/O overhead)
  useEffect(() => {
    if (filtersLoaded) {
      if (filtersPersistRef.current) {
        clearTimeout(filtersPersistRef.current);
      }
      filtersPersistRef.current = setTimeout(() => {
        searchService.saveLastFilters(filters);
      }, 500);
    }

    return () => {
      if (filtersPersistRef.current) {
        clearTimeout(filtersPersistRef.current);
      }
    };
  }, [filters, filtersLoaded]);

  // Load recent searches function - memoized to be used in dependency arrays
  const loadRecentSearches = useCallback(async () => {
    try {
      const searches = await recentSearchService.getRecentSearchesByType(
        activeTab === 'bounties' ? 'bounty' : 'user'
      );
      setRecentSearches(searches);
    } catch (error) {
      logger.warning('Recent searches failed to load', { error });
    } finally {
      // Signals the arrival animation, so a failed read can't leave the
      // screen waiting on the cap for nothing.
      setRecentsLoaded(true);
    }
  }, [activeTab]);

  // Load recent searches on mount and when activeTab changes
  useEffect(() => {
    loadRecentSearches();
  }, [loadRecentSearches]);

  // Autocomplete suggestions with 500ms debounce
  useEffect(() => {
    if (autocompleteRef.current) clearTimeout(autocompleteRef.current);

    if (!query.trim()) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    setIsLoadingSuggestions(true);
    autocompleteRef.current = setTimeout(async () => {
      try {
        const results = await searchService.getAutocompleteSuggestions(query, 8);
        setSuggestions(results);
        setShowSuggestions(results.length > 0);
      } catch (error) {
        // Log error for debugging but gracefully degrade by hiding suggestions
        logger.warning('Autocomplete suggestions failed', { error });
        setSuggestions([]);
      } finally {
        setIsLoadingSuggestions(false);
      }
    }, AUTOCOMPLETE_DEBOUNCE_MS);

    return () => {
      if (autocompleteRef.current) clearTimeout(autocompleteRef.current);
    };
  }, [query]);

  const handleSuggestionPress = useCallback(
    (suggestion: AutocompleteSuggestion) => {
      setShowSuggestions(false);

      if (suggestion.type === 'bounty') {
        const bountyId = suggestion.id.replace('bounty_', '');
        router.push(`/bounty/${bountyId}/public`);
      } else if (suggestion.type === 'user') {
        const userId = suggestion.id.replace('user_', '');
        router.push(`/profile/${userId}`);
      } else if (suggestion.type === 'skill') {
        // Search for bounties with this skill, appending to existing skills if not already present
        setQuery(suggestion.text);
        setFilters(prev => ({
          ...prev,
          skills: prev.skills?.includes(suggestion.text)
            ? prev.skills
            : [...(prev.skills || []), suggestion.text],
        }));
      }
    },
    [router]
  );

  const mapBounty = useCallback(
    (b: Bounty): BountyRowItem => ({
      id: b.id.toString(),
      title: b.title || 'Untitled',
      description: b.description || '',
      amount: (b as any).amount,
      created_at: (b as any).created_at,
      is_for_honor: (b as any).is_for_honor,
      location: (b as any).location,
      status: (b as any).status,
    }),
    []
  );

  const performBountySearch = useCallback(
    async (searchQuery: string, searchFilters: BountySearchFilters) => {
      const requestId = ++searchRequestIdRef.current;
      setIsSearching(true);
      setError(null);
      try {
        const results = await bountyService.searchWithFilters({
          keywords: searchQuery.trim() || undefined,
          ...searchFilters,
          limit: 50,
        });
        if (requestId !== searchRequestIdRef.current) return; // superseded by a newer search
        setBountyResults(results.map(mapBounty));

        const filtersApplied = describeBountyFilters(searchFilters);
        const trimmedLength = searchQuery.trim().length;
        // A blank query with only filter chips applied is browsing, not a
        // "search" in the query-length sense — still fire bounty_list_viewed
        // (source: search) either way since results are rendering, but only
        // fire bounty_search itself when the user actually typed something.
        if (trimmedLength > 0) {
          analyticsService.trackEvent('bounty_search', {
            query_length: trimmedLength,
            results_count: results.length,
            filters_applied: filtersApplied,
            had_zero_results: results.length === 0,
          });
        }
        analyticsService.trackEvent('bounty_list_viewed', {
          results_count: results.length,
          source: 'search',
          filters_applied: filtersApplied,
          sort_order: searchFilters.sortBy || 'date_desc',
          is_first_view_of_session: consumeIsFirstBountyListViewOfSession(),
          // metro_region (not `region`) — getDeviceServiceabilityContext()
          // below already emits a differently-scoped `region` (device locale).
          metro_region: coarseRegionFromLocationText(authProfileService.getCurrentProfile()?.location),
          ...getDeviceServiceabilityContext(),
        });

        // Save to recent searches if query exists
        if (searchQuery.trim()) {
          await recentSearchService.saveSearch('bounty', searchQuery, searchFilters);
          await loadRecentSearches();
        }
      } catch (e: any) {
        if (requestId !== searchRequestIdRef.current) return;
        setError(e?.message || 'Search failed');
      } finally {
        if (requestId === searchRequestIdRef.current) setIsSearching(false);
      }
    },
    [mapBounty]
  );

  const performUserSearch = useCallback(async (searchQuery: string) => {
    const requestId = ++searchRequestIdRef.current;
    setIsSearching(true);
    setError(null);
    try {
      const result = await userSearchService.searchUsers({
        keywords: searchQuery.trim() || undefined,
        limit: 50,
      });
      if (requestId !== searchRequestIdRef.current) return; // superseded by a newer search
      setUserResults(result.results);

      // Save to recent searches if query exists
      if (searchQuery.trim()) {
        await recentSearchService.saveSearch('user', searchQuery);
        await loadRecentSearches();
      }
    } catch (e: any) {
      if (requestId !== searchRequestIdRef.current) return;
      setError(e?.message || 'Search failed');
    } finally {
      if (requestId === searchRequestIdRef.current) setIsSearching(false);
    }
  }, []);

  // Debounce search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(() => {
      if (activeTab === 'bounties') {
        performBountySearch(query, filters);
      } else {
        performUserSearch(query);
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, filters, activeTab, performBountySearch, performUserSearch]);

  const handleRecentSearchClick = useCallback(
    (search: RecentSearch) => {
      setQuery(search.query);
      if (search.filters && activeTab === 'bounties') {
        setFilters(search.filters as BountySearchFilters);
      }
    },
    [activeTab]
  );

  const handleRemoveRecentSearch = useCallback(
    async (searchId: string) => {
      await recentSearchService.removeSearch(searchId);
      await loadRecentSearches();
    },
    [loadRecentSearches]
  );

  const clearFilters = useCallback(() => {
    setFilters({
      sortBy: 'date_desc',
      status: ['open'],
    });
  }, []);

  const renderBountyItem = useCallback(
    ({ item, index }: { item: BountyRowItem; index: number }) => {
      const priceLabel = item.is_for_honor
        ? 'for honor'
        : item.amount != null
          ? `$${item.amount}`
          : '';
      const locationLabel = item.location ? `, in ${item.location}` : '';
      const accessibilityLabel = `${item.title}${priceLabel ? ', ' + priceLabel : ''}${locationLabel}`;

      return (
        <TouchableOpacity
          style={s.card}
          onPress={() => router.push(`/bounty/${item.id}/public?source=search&position=${index}`)}
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          accessibilityHint="Opens bounty details"
        >
          <View style={s.cardHeader}>
            <Text style={s.cardTitle}>{item.title}</Text>
            {item.is_for_honor && (
              <View style={s.honorBadge}>
                <Text style={s.honorText}>Honor</Text>
              </View>
            )}
          </View>
          {item.description ? (
            <Text style={s.cardDesc} numberOfLines={2}>
              {item.description}
            </Text>
          ) : null}
          <View style={s.metaRow}>
            {item.amount != null && !item.is_for_honor && (
              <Text style={s.amount}>${item.amount}</Text>
            )}
            {item.location && (
              <Text style={s.location} numberOfLines={1}>
                📍 {item.location}
              </Text>
            )}
            {item.created_at && <Text style={s.time}>{timeAgo(item.created_at)}</Text>}
          </View>
          {item.status && item.status !== 'open' && (
            <View style={s.statusBadge}>
              <Text style={s.statusText}>{item.status}</Text>
            </View>
          )}
        </TouchableOpacity>
      );
    },
    [router]
  );

  const renderUserItem = useCallback(
    ({ item }: { item: UserProfile }) => {
      const verifiedLabel =
        item.verificationStatus === 'verified' || item.verificationStatus === 'trusted'
          ? ', verified user'
          : '';
      const skillsLabel =
        item.skills && item.skills.length > 0
          ? `, skills: ${item.skills.slice(0, 3).join(', ')}`
          : '';
      const accessibilityLabel = `${item.username}${verifiedLabel}${skillsLabel}`;

      return (
        <TouchableOpacity
          style={s.card}
          onPress={() => router.push(`/profile/${item.id}`)}
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          accessibilityHint="Opens user profile"
        >
          <View style={s.cardHeader}>
            <Text style={s.cardTitle}>{item.username}</Text>
            {(item.verificationStatus === 'verified' || item.verificationStatus === 'trusted') && (
              <MaterialIcons
                name="verified"
                size={16}
                color={theme.primaryLight}
                accessibilityElementsHidden={true}
              />
            )}
          </View>
          {item.bio && (
            <Text style={s.cardDesc} numberOfLines={2}>
              {item.bio}
            </Text>
          )}
          {item.skills && item.skills.length > 0 && (
            <View style={s.skillsRow}>
              {item.skills.slice(0, 3).map((skill, idx) => (
                <View key={`${item.id}-skill-${idx}-${skill.toLowerCase()}`} style={s.skillChip}>
                  <Text style={s.skillText}>{skill}</Text>
                </View>
              ))}
            </View>
          )}
        </TouchableOpacity>
      );
    },
    [router]
  );

  const renderRecentSearch = useCallback(
    ({ item }: { item: RecentSearch }) => (
      <View style={s.recentSearchItem}>
        <TouchableOpacity
          style={s.recentSearchContent}
          onPress={() => handleRecentSearchClick(item)}
          accessibilityRole="button"
          accessibilityLabel={`Recent search: ${item.query}`}
          accessibilityHint="Tap to repeat this search"
        >
          <MaterialIcons
            name="history"
            size={18}
            color={theme.primaryLight}
            accessibilityElementsHidden={true}
          />
          <Text style={s.recentSearchText}>{item.query}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => handleRemoveRecentSearch(item.id)}
          accessibilityRole="button"
          accessibilityLabel="Remove recent search"
          accessibilityHint="Removes this search from history"
        >
          <MaterialIcons
            name="close"
            size={18}
            color={theme.primaryLight}
            accessibilityElementsHidden={true}
          />
        </TouchableOpacity>
      </View>
    ),
    [handleRecentSearchClick, handleRemoveRecentSearch]
  );

  const keyExtractorBounty = useCallback((item: BountyRowItem) => item.id, []);
  const keyExtractorUser = useCallback((item: UserProfile) => item.id, []);
  const keyExtractorRecent = useCallback((item: RecentSearch) => item.id, []);

  // NOTE: Search result cards have variable height (title/description lines, optional chips),
  // so getItemLayout with fixed heights would cause incorrect offsets and blank space.
  // Removed getItemLayout to allow FlatList to measure items dynamically.

  const hasActiveFilters = useMemo(
    () =>
      filters.location ||
      filters.minAmount !== undefined ||
      filters.maxAmount !== undefined ||
      filters.workType ||
      filters.isForHonor !== undefined ||
      (filters.status && filters.status.length > 1),
    [filters]
  );

  return (
    <View style={s.container}>
      {/* The feed's search bar navigates here, so this row is deliberately the
          same component at the same offset: same 44pt field, same gutters,
          same 44pt trailing slot (the feed's bell, this screen's close
          button). Nothing about the bar moves or resizes on arrival — only
          what sits below it changes, from the feed's cards to results. That is
          also why the map / saved / filter controls live in the row beneath
          rather than inside the field: inside, they would widen the bar. */}
      <SearchBarRow
        emphasis
        middle={
          activeHuntersCount != null ? (
            <ActiveHuntersPill
              count={activeHuntersCount}
              radiusMiles={activeHuntersRadius}
              testID="search-active-hunters-caption"
            />
          ) : null
        }
        trailing={
          // Cross-fades in over where the feed's bell was standing, so the
          // slot swaps its occupant instead of snapping to a different icon.
          <Animated.View style={{ opacity: chromeAnim }}>
            <SearchRowIconButton
              icon="close"
              onPress={closeSearch}
              accessibilityLabel="Close search"
              accessibilityHint="Returns to the previous screen"
            />
          </Animated.View>
        }
      >
        <TextInput
          value={query}
          placeholder={
            activeTab === 'users'
              ? 'Search users...'
              : // Same rule as the feed's placeholder, so the wording doesn't
                // change under the cursor when the bar becomes editable.
                activeHuntersCount != null
                ? 'Search bounties...'
                : 'Search bounties or users...'
          }
          placeholderTextColor={theme.textDisabled}
          maxFontSizeMultiplier={SEARCH_FIELD_MAX_FONT_SCALE}
          onChangeText={text => {
            setQuery(text);
            if (!text.trim()) {
              setShowSuggestions(false);
            }
          }}
          onFocus={() => {
            if (suggestions.length > 0) {
              setShowSuggestions(true);
            }
          }}
          // The bar looks identical to the one just tapped, so it has to behave
          // like it was tapped: land here ready to type, not needing a second tap.
          autoFocus
          returnKeyType="search"
          style={s.input}
          accessibilityRole="search"
          accessibilityLabel={activeTab === 'bounties' ? 'Search bounties' : 'Search users'}
          accessibilityHint="Type to search with autocomplete suggestions"
        />
        {!!query && !isSearching && (
          <TouchableOpacity
            onPress={() => {
              setQuery('');
              setShowSuggestions(false);
            }}
            style={s.smallPadding}
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            accessibilityHint="Clears the search text"
          >
            <MaterialIcons
              name="close"
              size={18}
              color={theme.primaryLight}
              accessibilityElementsHidden={true}
            />
          </TouchableOpacity>
        )}
        {(isSearching || isLoadingSuggestions) && (
          <ActivityIndicator
            color={theme.primaryLight}
            size="small"
            style={s.activityMarginRight}
            accessibilityLabel="Loading search results"
          />
        )}
      </SearchBarRow>

      {/* Tab switcher */}
      <Animated.View style={[s.tabRow, enterStyle(chromeAnim, 10)]}>
        <TouchableOpacity
          style={[s.tab, activeTab === 'bounties' && s.tabActive]}
          onPress={() => setActiveTab('bounties')}
          accessibilityRole="tab"
          accessibilityLabel="Search bounties"
          accessibilityState={{ selected: activeTab === 'bounties' }}
          accessibilityHint="Switches to bounty search"
        >
          <Text style={[s.tabText, activeTab === 'bounties' && s.tabTextActive]}>Bounties</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.tab, activeTab === 'users' && s.tabActive]}
          onPress={() => setActiveTab('users')}
          accessibilityRole="tab"
          accessibilityLabel="Search users"
          accessibilityState={{ selected: activeTab === 'users' }}
          accessibilityHint="Switches to user search"
        >
          <Text style={[s.tabText, activeTab === 'users' && s.tabTextActive]}>Users</Text>
        </TouchableOpacity>

        {/* Result-shaping controls. They sit here, on the first line of the
            content, rather than inside the search field: the field has to stay
            the width the feed's does, and these three only apply to bounty
            results anyway. */}
        {activeTab === 'bounties' && (
          <View style={s.tabActions}>
            <TouchableOpacity
              onPress={() => setShowMap(v => !v)}
              style={s.actionBtn}
              accessibilityRole="button"
              accessibilityLabel={showMap ? 'Show list view' : 'Show map view'}
              accessibilityHint="Toggles between list and map view of bounty results"
              accessibilityState={{ selected: showMap }}
            >
              <MaterialIcons
                name={showMap ? 'view-list' : 'map'}
                size={20}
                color={theme.primaryLight}
                accessibilityElementsHidden={true}
              />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => router.push('/search/saved-searches')}
              style={s.actionBtn}
              accessibilityRole="button"
              accessibilityLabel="Saved searches"
              accessibilityHint="View and manage saved searches"
            >
              <MaterialIcons
                name="bookmark-outline"
                size={20}
                color={theme.primaryLight}
                accessibilityElementsHidden={true}
              />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setShowFilters(true)}
              style={s.actionBtn}
              accessibilityRole="button"
              accessibilityLabel={hasActiveFilters ? 'Filter (active)' : 'Filter'}
              accessibilityHint="Opens filter options for bounty search"
            >
              <MaterialIcons
                name="tune"
                size={20}
                color={hasActiveFilters ? '#fcd34d' : theme.primaryLight}
                accessibilityElementsHidden={true}
              />
              {hasActiveFilters && <View style={s.filterDot} />}
            </TouchableOpacity>
          </View>
        )}
      </Animated.View>

      {/* Everything under the bar — suggestions, recents, trending, results —
          is the part that actually replaced the feed, so it's what moves. */}
      <Animated.View style={[s.body, enterStyle(bodyAnim, 18)]}>
        {/* Autocomplete Suggestions */}
        {showSuggestions && suggestions.length > 0 && (
          <View style={s.suggestionsContainer}>
            {suggestions.map(suggestion => (
              <TouchableOpacity
                key={suggestion.id}
                style={s.suggestionItem}
                onPress={() => handleSuggestionPress(suggestion)}
                accessibilityRole="button"
                accessibilityLabel={`${suggestion.type === 'bounty' ? 'Bounty' : suggestion.type === 'user' ? 'User' : 'Skill'}: ${suggestion.text}${suggestion.subtitle ? ', ' + suggestion.subtitle : ''}`}
                accessibilityHint={
                  suggestion.type === 'bounty'
                    ? 'Opens bounty details'
                    : suggestion.type === 'user'
                      ? 'Opens user profile'
                      : 'Searches for bounties with this skill'
                }
              >
                <MaterialIcons
                  name={(suggestion.icon as any) || 'search'}
                  size={18}
                  color={theme.primaryLight}
                  style={s.iconMarginRight10}
                />
                <View style={s.flex1}>
                  <Text style={s.suggestionText}>{suggestion.text}</Text>
                  {suggestion.subtitle && (
                    <Text style={s.suggestionSubtext}>{suggestion.subtitle}</Text>
                  )}
                </View>
                <View style={s.suggestionTypeBadge}>
                  <Text style={s.suggestionTypeText}>
                    {suggestion.type === 'bounty'
                      ? 'Bounty'
                      : suggestion.type === 'user'
                        ? 'User'
                        : 'Skill'}
                  </Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {error && (
          <View style={s.errorBox}>
            <Text style={s.errorText}>⚠ {error}</Text>
            <TouchableOpacity
              onPress={() => {
                if (activeTab === 'bounties') {
                  performBountySearch(query, filters);
                } else {
                  performUserSearch(query);
                }
              }}
              style={s.retryBtn}
            >
              <Text style={s.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Recent searches */}
        {!query && recentSearches.length > 0 && (
          <View style={s.recentSection}>
            <View style={s.recentHeader}>
              <Text style={s.recentTitle}>Recent Searches</Text>
              <TouchableOpacity
                onPress={() => recentSearchService.clearAll().then(loadRecentSearches)}
                accessibilityRole="button"
                accessibilityLabel="Clear recent searches"
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={s.clearText}>Clear</Text>
              </TouchableOpacity>
            </View>
            <FlatList
              data={recentSearches}
              keyExtractor={keyExtractorRecent}
              renderItem={renderRecentSearch}
              scrollEnabled={false}
              // Off deliberately: these lists live inside the animated body
              // wrapper, and clipping is computed against an ancestor that is
              // mid-transform during the arrival animation — on Android that
              // drops rows to blank. The lists are short enough not to need it.
              removeClippedSubviews={false}
              maxToRenderPerBatch={10}
              windowSize={3}
              initialNumToRender={5}
            />
          </View>
        )}

        {/* Trending Bounties — loading skeleton, shown while the initial fetch is in flight */}
        {!query && !isSearching && isLoadingTrending && (
          <View style={s.trendingSection}>
            <View style={s.trendingHeader}>
              <MaterialIcons name="local-fire-department" size={18} color={theme.primary} />
              <Text style={s.trendingTitle}>Trending</Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {[0, 1, 2].map(i => (
                <View key={`trending-skeleton-${i}`} style={s.trendingCard}>
                  <Skeleton style={s.trendingSkeletonLine} />
                  <Skeleton style={s.trendingSkeletonAmount} />
                </View>
              ))}
            </ScrollView>
          </View>
        )}

        {/* Trending Bounties — shown only when search is empty */}
        {!query && !isSearching && !isLoadingTrending && trendingBounties.length > 0 && (
          <View style={s.trendingSection}>
            <View style={s.trendingHeader}>
              <MaterialIcons name="local-fire-department" size={18} color={theme.primary} />
              <Text style={s.trendingTitle}>Trending</Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {trendingBounties.map(bounty => (
                <TouchableOpacity
                  key={String(bounty.id)}
                  style={s.trendingCard}
                  onPress={() => router.push(`/bounty/${bounty.id}/public?source=search`)}
                  accessibilityRole="button"
                  accessibilityLabel={bounty.title}
                  accessibilityHint="Opens bounty details"
                >
                  <Text style={s.trendingCardTitle} numberOfLines={2}>
                    {bounty.title}
                  </Text>
                  {bounty.isForHonor ? (
                    <View style={s.trendingHonorBadge}>
                      <Text style={s.trendingHonorText}>For Honor</Text>
                    </View>
                  ) : (
                    <Text style={s.trendingAmount}>${bounty.amount ?? 0}</Text>
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {/* Results */}
        {activeTab === 'bounties' && showMap ? (
          <Suspense
            fallback={
              <View style={s.mapFallback}>
                <ActivityIndicator color={theme.primaryLight} accessibilityLabel="Loading map" />
              </View>
            }
          >
            <BountyMapView height={400} />
          </Suspense>
        ) : activeTab === 'bounties' ? (
          <FlatList
            data={bountyResults}
            keyExtractor={keyExtractorBounty}
            renderItem={renderBountyItem}
            contentContainerStyle={s.resultsContainer}
            keyboardDismissMode="on-drag"
            ListEmptyComponent={
              query && !isSearching && !error ? (
                <EmptyState
                  icon="search-off"
                  title="No bounties found"
                  description={`No bounties matched "${query}". Try a different keyword or check your spelling.`}
                  size="sm"
                />
              ) : null
            }
            // See the recent-searches list: clipping misbehaves under the
            // animated wrapper's transform.
            removeClippedSubviews={false}
            maxToRenderPerBatch={10}
            windowSize={5}
            initialNumToRender={8}
          />
        ) : (
          <FlatList
            data={userResults}
            keyExtractor={keyExtractorUser}
            renderItem={renderUserItem}
            contentContainerStyle={s.resultsContainer}
            keyboardDismissMode="on-drag"
            ListEmptyComponent={
              query && !isSearching && !error ? (
                <EmptyState
                  icon="person-search"
                  title="No users found"
                  description={`No users matched "${query}". Try a different name or username.`}
                  size="sm"
                />
              ) : null
            }
            // See the recent-searches list: clipping misbehaves under the
            // animated wrapper's transform.
            removeClippedSubviews={false}
            maxToRenderPerBatch={10}
            windowSize={5}
            initialNumToRender={8}
          />
        )}
      </Animated.View>

      {/* Filter Modal */}
      <Modal visible={showFilters} animationType="slide" transparent>
        <View style={s.modalOverlay}>
          <View style={s.modalContent}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>Filter Bounties</Text>
              <TouchableOpacity onPress={() => setShowFilters(false)}>
                <MaterialIcons name="close" size={24} color={theme.text} />
              </TouchableOpacity>
            </View>

            <ScrollView style={s.filterScroll}>
              {/* Sort By */}
              <Text style={s.filterLabel}>Sort By</Text>
              <View style={s.filterGroup}>
                {[
                  { value: 'date_desc', label: 'Newest First' },
                  { value: 'date_asc', label: 'Oldest First' },
                  { value: 'amount_desc', label: 'Highest Amount' },
                  { value: 'amount_asc', label: 'Lowest Amount' },
                ].map(option => (
                  <TouchableOpacity
                    key={option.value}
                    style={[
                      s.filterOption,
                      filters.sortBy === option.value && s.filterOptionActive,
                    ]}
                    onPress={() => setFilters({ ...filters, sortBy: option.value as any })}
                  >
                    <Text
                      style={[
                        s.filterOptionText,
                        filters.sortBy === option.value && s.filterOptionTextActive,
                      ]}
                    >
                      {option.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Status */}
              <Text style={s.filterLabel}>Status</Text>
              <View style={s.filterGroup}>
                {[
                  { value: 'open', label: 'Open' },
                  { value: 'in_progress', label: 'In Progress' },
                  { value: 'completed', label: 'Completed' },
                ].map(option => (
                  <TouchableOpacity
                    key={option.value}
                    style={[
                      s.filterOption,
                      filters.status?.includes(option.value) && s.filterOptionActive,
                    ]}
                    onPress={() => {
                      const currentStatus = filters.status || ['open'];
                      const newStatus = currentStatus.includes(option.value)
                        ? currentStatus.filter(s => s !== option.value)
                        : [...currentStatus, option.value];
                      // Never allow an empty selection: an empty status array is
                      // treated as "no filter" downstream and widens the query to
                      // cancelled/deleted bounties. Re-default to Open instead.
                      setFilters({
                        ...filters,
                        status: newStatus.length > 0 ? newStatus : ['open'],
                      });
                    }}
                  >
                    <Text
                      style={[
                        s.filterOptionText,
                        filters.status?.includes(option.value) && s.filterOptionTextActive,
                      ]}
                    >
                      {option.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Work Type */}
              <Text style={s.filterLabel}>Work Type</Text>
              <View style={s.filterGroup}>
                {[
                  { value: undefined, label: 'All' },
                  { value: 'online', label: 'Online' },
                  { value: 'in_person', label: 'In Person' },
                ].map(option => (
                  <TouchableOpacity
                    key={option.label}
                    style={[
                      s.filterOption,
                      filters.workType === option.value && s.filterOptionActive,
                    ]}
                    onPress={() => setFilters({ ...filters, workType: option.value as any })}
                  >
                    <Text
                      style={[
                        s.filterOptionText,
                        filters.workType === option.value && s.filterOptionTextActive,
                      ]}
                    >
                      {option.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Amount Range */}
              <Text style={s.filterLabel}>Amount Range</Text>
              <View style={s.amountRow}>
                <TextInput
                  style={s.amountInput}
                  placeholder="Min"
                  placeholderTextColor={theme.textDisabled}
          maxFontSizeMultiplier={SEARCH_FIELD_MAX_FONT_SCALE}
                  keyboardType="numeric"
                  value={filters.minAmount?.toString() || ''}
                  onChangeText={text =>
                    setFilters({ ...filters, minAmount: text ? parseFloat(text) : undefined })
                  }
                />
                <Text style={s.amountSeparator}>-</Text>
                <TextInput
                  style={s.amountInput}
                  placeholder="Max"
                  placeholderTextColor={theme.textDisabled}
          maxFontSizeMultiplier={SEARCH_FIELD_MAX_FONT_SCALE}
                  keyboardType="numeric"
                  value={filters.maxAmount?.toString() || ''}
                  onChangeText={text =>
                    setFilters({ ...filters, maxAmount: text ? parseFloat(text) : undefined })
                  }
                />
              </View>
            </ScrollView>

            <View style={s.modalFooter}>
              <TouchableOpacity style={s.clearFiltersBtn} onPress={clearFilters}>
                <Text style={s.clearFiltersBtnText}>Clear All</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.applyFiltersBtn} onPress={() => setShowFilters(false)}>
                <Text style={s.applyFiltersBtnText}>Apply Filters</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// Helpers
function timeAgo(ts?: string) {
  if (!ts) return '';
  const date = new Date(ts);
  const diff = Date.now() - date.getTime();
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return 'Just now';
  if (hours < 24) return hours + 'h ago';
  const days = Math.floor(hours / 24);
  return days + 'd ago';
}

function makeStyles(t: AppTheme) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: t.background,
    },
    // Takes the space the results list used to claim directly, so wrapping the
    // content in an animated view doesn't collapse the list to its content.
    body: {
      flex: 1,
    },
    // Same height the map itself renders at, so loading it doesn't resize the
    // area underneath the toggle.
    mapFallback: {
      height: 400,
      alignItems: 'center',
      justifyContent: 'center',
    },
    tabRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: SPACING.SCREEN_HORIZONTAL,
      marginBottom: SPACING.COMPACT_GAP,
      gap: SPACING.COMPACT_GAP,
    },
    tabActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      flexShrink: 0,
    },
    tab: {
      flex: 1,
      paddingVertical: SPACING.COMPACT_GAP,
      alignItems: 'center',
      backgroundColor: t.surface,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: t.border,
    },
    tabActive: {
      backgroundColor: t.surfaceSecondary,
      borderColor: t.primary,
    },
    tabText: {
      color: t.textSecondary,
      fontSize: 14,
      fontWeight: '600',
    },
    tabTextActive: {
      color: t.primaryLight,
    },
    // Sits inside SearchBarRow's fixed-height field, so it contributes no
    // height of its own — any vertical padding here would make this screen's
    // bar taller than the feed's.
    input: {
      ...SEARCH_FIELD_TEXT,
      flex: 1,
      color: t.text,
      // Stretch to the field's full height instead of sizing to its own line
      // box. A zero-padding TextInput measures to roughly the font size rather
      // than the font's full line height, which slices the tops and tails off
      // the glyphs — the placeholder came out visibly cropped. Given the whole
      // 44pt to sit in, iOS centres a single line on its own and
      // textAlignVertical does the same on Android.
      alignSelf: 'stretch',
      paddingVertical: 0,
      paddingHorizontal: 0,
      textAlignVertical: 'center',
      // Android reserves asymmetric font padding — more above the ascender
      // than below the descender — inside the input. Centring the padded box
      // rather than the glyphs themselves is what dropped the placeholder a
      // couple of points below where the feed's label sits. Dropping it makes
      // the two land on the same line; the 44pt field leaves plenty of room
      // for tall glyphs without it.
      includeFontPadding: false,
    },
    smallPadding: {
      padding: 4,
    },
    activityMarginRight: {
      marginRight: 8,
    },
    iconMarginRight10: {
      marginRight: 10,
    },
    flex1: {
      flex: 1,
    },
    resultsContainer: {
      padding: 12,
      paddingBottom: 100,
    },
    actionBtn: {
      width: 36,
      height: 36,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 999,
      backgroundColor: t.surface,
      borderWidth: 1,
      borderColor: t.border,
      position: 'relative',
    },
    filterDot: {
      position: 'absolute',
      top: 6,
      right: 6,
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: t.primary,
    },
    card: {
      backgroundColor: t.surface,
      borderRadius: 14,
      padding: SPACING.ELEMENT_GAP,
      marginBottom: 10,
      borderWidth: 1,
      borderColor: t.border,
      shadowColor: '#000',
      shadowOpacity: t.isDark ? 0.3 : 0.06,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 3 },
      elevation: 2,
    },
    cardHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 4,
    },
    cardTitle: {
      color: t.text,
      fontSize: 15,
      fontWeight: '600',
      flex: 1,
    },
    cardDesc: {
      color: t.textSecondary,
      fontSize: 13,
      marginBottom: 6,
    },
    metaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACING.COMPACT_GAP,
      flexWrap: 'wrap',
    },
    amount: {
      color: t.primary,
      fontWeight: '700',
      fontSize: 13,
    },
    location: {
      color: t.textSecondary,
      fontSize: 11,
      flex: 1,
    },
    time: {
      color: t.textDisabled,
      fontSize: 11,
    },
    // Semantic amber — preserved across themes
    honorBadge: {
      backgroundColor: 'rgba(245,158,11,0.12)',
      paddingHorizontal: SPACING.COMPACT_GAP,
      paddingVertical: 2,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: 'rgba(245,158,11,0.25)',
    },
    honorText: {
      color: '#fbbf24',
      fontSize: 10,
      fontWeight: '700',
    },
    statusBadge: {
      marginTop: 4,
      alignSelf: 'flex-start',
      paddingHorizontal: SPACING.COMPACT_GAP,
      paddingVertical: 2,
      backgroundColor: t.surfaceSecondary,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: t.border,
    },
    statusText: {
      color: t.textSecondary,
      fontSize: 10,
      textTransform: 'capitalize',
    },
    skillsRow: {
      flexDirection: 'row',
      gap: 6,
      marginTop: 6,
      flexWrap: 'wrap',
    },
    skillChip: {
      backgroundColor: t.isDark ? 'rgba(16,185,129,0.12)' : 'rgba(5,150,105,0.08)',
      paddingHorizontal: SPACING.COMPACT_GAP,
      paddingVertical: 4,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: t.isDark ? 'rgba(16,185,129,0.3)' : 'rgba(5,150,105,0.2)',
    },
    skillText: {
      color: t.primaryLight,
      fontSize: 11,
    },
    recentSection: {
      paddingHorizontal: SPACING.ELEMENT_GAP,
      paddingVertical: SPACING.COMPACT_GAP,
    },
    recentHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: SPACING.COMPACT_GAP,
    },
    recentTitle: {
      color: t.text,
      fontSize: 13,
      fontWeight: '600',
    },
    clearText: {
      color: t.primary,
      fontSize: 12,
    },
    recentSearchItem: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: SPACING.COMPACT_GAP,
    },
    recentSearchContent: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACING.COMPACT_GAP,
      flex: 1,
    },
    recentSearchText: {
      color: t.text,
      fontSize: 14,
    },
    // Semantic red — preserved
    errorBox: {
      backgroundColor: 'rgba(239,68,68,0.08)',
      margin: SPACING.ELEMENT_GAP,
      padding: 10,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: 'rgba(239,68,68,0.2)',
    },
    errorText: {
      color: '#f87171',
      marginBottom: 6,
      fontSize: 13,
    },
    retryBtn: {
      backgroundColor: t.primary,
      paddingHorizontal: SPACING.ELEMENT_GAP,
      paddingVertical: 6,
      borderRadius: 20,
      alignSelf: 'flex-start',
    },
    retryText: {
      color: '#ffffff',
      fontSize: 12,
      fontWeight: '600',
    },
    modalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.7)',
      justifyContent: 'flex-end',
    },
    modalContent: {
      backgroundColor: t.surface,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      maxHeight: '80%' as any,
      borderWidth: 1,
      borderColor: t.border,
    },
    modalHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: SPACING.CARD_PADDING,
      borderBottomWidth: 1,
      borderBottomColor: t.border,
    },
    modalTitle: {
      color: t.text,
      fontSize: 18,
      fontWeight: '700',
    },
    filterScroll: {
      padding: SPACING.CARD_PADDING,
    },
    filterLabel: {
      color: t.textSecondary,
      fontSize: 14,
      fontWeight: '600',
      marginBottom: SPACING.COMPACT_GAP,
      marginTop: 12,
    },
    filterGroup: {
      gap: SPACING.COMPACT_GAP,
    },
    filterOption: {
      backgroundColor: t.surfaceSecondary,
      paddingVertical: SPACING.ELEMENT_GAP,
      paddingHorizontal: SPACING.CARD_PADDING,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: t.border,
    },
    filterOptionActive: {
      backgroundColor: t.surface,
      borderColor: t.primary,
    },
    filterOptionText: {
      color: t.textSecondary,
      fontSize: 14,
    },
    filterOptionTextActive: {
      color: t.primaryLight,
      fontWeight: '600',
    },
    amountRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACING.COMPACT_GAP,
    },
    amountInput: {
      flex: 1,
      backgroundColor: t.surfaceSecondary,
      color: t.text,
      paddingVertical: SPACING.ELEMENT_GAP,
      paddingHorizontal: SPACING.CARD_PADDING,
      borderRadius: 8,
      fontSize: 14,
      borderWidth: 1,
      borderColor: t.border,
    },
    amountSeparator: {
      color: t.textDisabled,
      fontSize: 16,
    },
    modalFooter: {
      flexDirection: 'row',
      padding: SPACING.CARD_PADDING,
      gap: SPACING.ELEMENT_GAP,
      borderTopWidth: 1,
      borderTopColor: t.border,
    },
    clearFiltersBtn: {
      flex: 1,
      paddingVertical: SPACING.ELEMENT_GAP,
      alignItems: 'center',
      backgroundColor: t.surfaceSecondary,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: t.border,
    },
    clearFiltersBtnText: {
      color: t.textSecondary,
      fontSize: 14,
      fontWeight: '600',
    },
    applyFiltersBtn: {
      flex: 1,
      paddingVertical: SPACING.ELEMENT_GAP,
      alignItems: 'center',
      backgroundColor: t.primary,
      borderRadius: 8,
      shadowColor: t.primary,
      shadowOpacity: 0.3,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 3 },
      elevation: 3,
    },
    applyFiltersBtnText: {
      color: '#ffffff',
      fontSize: 14,
      fontWeight: '700',
    },
    suggestionsContainer: {
      marginHorizontal: SPACING.ELEMENT_GAP,
      backgroundColor: t.surface,
      borderRadius: 12,
      marginBottom: SPACING.COMPACT_GAP,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: t.border,
    },
    suggestionItem: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: SPACING.ELEMENT_GAP,
      paddingHorizontal: 14,
      borderBottomWidth: 1,
      borderBottomColor: t.border,
    },
    suggestionText: {
      color: t.text,
      fontSize: 14,
      fontWeight: '500',
    },
    suggestionSubtext: {
      color: t.textSecondary,
      fontSize: 11,
      marginTop: 2,
    },
    suggestionTypeBadge: {
      backgroundColor: t.isDark ? 'rgba(16,185,129,0.12)' : 'rgba(5,150,105,0.08)',
      paddingHorizontal: SPACING.COMPACT_GAP,
      paddingVertical: 3,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: t.isDark ? 'rgba(16,185,129,0.3)' : 'rgba(5,150,105,0.2)',
    },
    suggestionTypeText: {
      color: t.primaryLight,
      fontSize: 10,
      fontWeight: '600',
    },
    trendingSection: {
      marginBottom: 12,
      paddingHorizontal: SPACING.ELEMENT_GAP,
    },
    trendingHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginBottom: 10,
    },
    trendingTitle: {
      color: t.text,
      fontSize: 15,
      fontWeight: '600',
    },
    // Gold border/amount kept as decorative accent for trending cards
    trendingCard: {
      width: 200,
      // Fixed height with the two rows pushed apart, rather than a gap sized
      // to whatever the content happens to be: the skeleton (two short bars)
      // and the real card (a title of one or two lines plus a price) then
      // occupy exactly the same box, so the swap when trending resolves can't
      // jog the results list below it.
      height: 150,
      justifyContent: 'space-between',
      backgroundColor: t.surface,
      borderRadius: 12,
      padding: 16,
      marginRight: 10,
      borderWidth: 1.5,
      borderColor: '#D4AF37',
      shadowColor: '#D4AF37',
      shadowOpacity: 0.25,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 2 },
      elevation: 3,
    },
    trendingCardTitle: {
      color: t.text,
      fontSize: 13,
      fontWeight: '600',
    },
    trendingAmount: {
      color: '#D4AF37',
      fontSize: 14,
      fontWeight: '700',
    },
    trendingSkeletonLine: {
      width: '85%',
      height: 13,
      borderRadius: 6,
    },
    trendingSkeletonAmount: {
      width: '40%',
      height: 14,
      borderRadius: 6,
    },
    // Semantic amber — preserved
    trendingHonorBadge: {
      backgroundColor: 'rgba(245,158,11,0.12)',
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: 6,
      alignSelf: 'flex-start',
      borderWidth: 1,
      borderColor: 'rgba(245,158,11,0.25)',
    },
    trendingHonorText: {
      color: '#fbbf24',
      fontSize: 11,
      fontWeight: '700',
    },
  });
}
