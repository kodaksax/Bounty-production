import { MaterialIcons } from '@expo/vector-icons';
import { useLocation } from 'app/hooks/useLocation';
import { BountyCompactItem } from 'components/bounty-compact-item';
import { BountyGridFeed } from 'components/bounty-grid-feed';
import { BountyListItem } from 'components/bounty-list-item';
import { NotificationBell } from 'components/notifications/notification-bell';
import { EmptyState } from 'components/ui/empty-state';
import { FilterChip, type FilterChipIconName } from 'components/ui/filter-chip';
import { FilterChipSelect, type FilterChipOption } from 'components/ui/filter-chip-select';
import { PostingsListSkeleton } from 'components/ui/skeleton-loaders';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import {
    forwardRef,
    useCallback,
    useEffect,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
} from 'react';
import {
    Animated,
    FlatList,
    RefreshControl,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAccessibleAnimation } from '../hooks/use-accessible-animation';
import { useActiveHunters } from '../hooks/useActiveHunters';
import { useForegroundRefresh } from '../hooks/useForegroundRefresh';
import { useValidUserId } from '../hooks/useValidUserId';
import { consumeIsFirstBountyListViewOfSession } from '../lib/analytics/sessionFlags';
import { useBountyFormat } from '../lib/bounty-format-context';
import { API_TIMEOUTS } from '../lib/config/network';
import { SIZING, SPACING, TYPOGRAPHY } from '../lib/constants/accessibility';
import { BOUNTY_CATEGORIES } from '../lib/constants/bounty-categories';
import { analyticsService } from '../lib/services/analytics-service';
import { authProfileService } from '../lib/services/auth-profile-service';
import { searchBountiesNearby, type NearbyBounty } from '../lib/services/bounty-location-service';
import { bountyRequestService } from '../lib/services/bounty-request-service';
import { bountyService } from '../lib/services/bounty-service';
import type { Bounty } from '../lib/services/database.types';
import { locationService } from '../lib/services/location-service';
import { storage } from '../lib/storage';
import { supabase } from '../lib/supabase';
import { useAppThemeContext } from '../lib/themes/AppThemeContext';
import type { AppTheme } from '../lib/themes/types';
import { logger } from '../lib/utils/error-logger';
import { isBountyDeadlinePassed } from '../lib/utils/schedule-utils';
import { coarseRegionFromLocationText, getDeviceServiceabilityContext } from '../lib/utils/serviceable-region';
import { withTimeout } from '../lib/utils/withTimeout';

export type BountyFeedHandle = {
  refresh: () => void;
  handleTabRepress: () => void;
};

interface BountyFeedProps {
  activeScreen: string;
  setActiveScreen: (screen: string) => void;
  currentUserId?: string;
}

const PAGE_SIZE = 10;

// 'off' = no distance filter (existing behavior, unchanged). A number is a
// radius in miles. `null` is the explicit "Anywhere" preset — still uses
// search_bounties_nearby (so results get real distances/sort) but without a
// radius cap.
type DistanceFilterValue = 'off' | number | null;
const DISTANCE_OFF: DistanceFilterValue = 'off';
const DISTANCE_OPTIONS: FilterChipOption<DistanceFilterValue>[] = [
  { label: 'Any distance', value: DISTANCE_OFF, description: 'Browse every open bounty' },
  { label: 'Within 1 mile', value: 1, chipLabel: '1 mi' },
  { label: 'Within 5 miles', value: 5, chipLabel: '5 mi' },
  { label: 'Within 10 miles', value: 10, chipLabel: '10 mi' },
  { label: 'Within 25 miles', value: 25, chipLabel: '25 mi' },
  { label: 'Anywhere', value: null, description: 'No radius cap, still sorted by distance' },
];

// The filter carousel holds category chips and interactive filter chips in one
// list; `kind` is what the renderer switches on. `id` is shared so a single
// keyExtractor covers both.
const DISTANCE_ITEM_ID = '__distance__';
type FilterBarItem =
  | { kind: 'category'; id: string; label: string; icon: FilterChipIconName }
  | { kind: 'distance'; id: typeof DISTANCE_ITEM_ID };

function nearbyToBounty(nb: NearbyBounty): Bounty {
  return {
    id: nb.id,
    title: nb.title,
    description: nb.description,
    amount: nb.amount,
    is_for_honor: nb.is_for_honor,
    location: nb.neighborhood || '',
    neighborhood: nb.neighborhood,
    timeline: '',
    skills_required: '',
    poster_id: nb.poster_id,
    user_id: nb.poster_id,
    created_at: nb.created_at,
    status: nb.status as Bounty['status'],
    category: nb.category || undefined,
    deadline: nb.deadline || undefined,
    username: nb.username || undefined,
    poster_avatar: nb.avatar,
    approx_latitude: nb.approx_latitude,
    approx_longitude: nb.approx_longitude,
    distance_miles: nb.distance_miles,
  };
}

/**
 * Small green "someone is actually here right now" indicator for the
 * active-hunters pill: a solid dot with a halo that expands and fades on a
 * slow loop, the same breathing-pulse language WorkInProgressBanner uses.
 *
 * The dot itself never blinks fully out — a disappearing dot reads as a
 * rendering glitch, while a steady core with a pulsing halo reads as a live
 * signal. Honours Reduce Motion by rendering the static core only, since this
 * animation loops forever and would otherwise never stop moving.
 */
function LiveDot({ color }: { color: string }) {
  const { prefersReducedMotion } = useAccessibleAnimation();
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (prefersReducedMotion) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1100, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 1100, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, prefersReducedMotion]);

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 2] });
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] });

  return (
    <View style={liveDotStyles.wrap}>
      {!prefersReducedMotion && (
        <Animated.View
          pointerEvents="none"
          style={[liveDotStyles.halo, { backgroundColor: color, transform: [{ scale }], opacity }]}
        />
      )}
      <View style={[liveDotStyles.core, { backgroundColor: color }]} />
    </View>
  );
}

const liveDotStyles = StyleSheet.create({
  // Sized to the halo at full expansion (8 x 2), not to the core, so the pulse
  // never paints outside its parent — Android clips overflowing children.
  wrap: {
    width: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  halo: {
    position: 'absolute',
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  core: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});

export const BountyFeed = forwardRef<BountyFeedHandle, BountyFeedProps>(function BountyFeed(
  { activeScreen, setActiveScreen, currentUserId },
  ref
) {
  const router = useRouter();
  const [listHeight, setListHeight] = useState(0);
  const [bounties, setBounties] = useState<Bounty[]>([]);
  const [isLoadingBounties, setIsLoadingBounties] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [appliedBountyIds, setAppliedBountyIds] = useState<Set<string>>(new Set());
  const [applicationsLoaded, setApplicationsLoaded] = useState(false);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string | 'all'>('all');
  const [distanceFilter, setDistanceFilter] = useState<DistanceFilterValue>(DISTANCE_OFF);
  // Count of newly-posted open bounties observed via realtime since the last
  // load/refresh. Not injected directly into `bounties` — this feed is
  // paginated (PAGE_SIZE/offsetRef), so splicing a live INSERT into the
  // middle of that would corrupt pagination offsets. Surfaced instead as a
  // "New bounties" pill the user taps to pull a fresh page.
  const [newBountiesCount, setNewBountiesCount] = useState(0);
  // Server-side total of open bounties for the active category — the stable,
  // accurate figure behind the "N active" badge. null until first fetched (and
  // on count-fetch failure), in which case the badge falls back to the loaded
  // count. See bountyService.getOpenCount.
  const [activeCount, setActiveCount] = useState<number | null>(null);

  const { theme } = useAppThemeContext();
  const { bountyFormat } = useBountyFormat();
  const isCompact = bountyFormat === 'compact';
  const insets = useSafeAreaInsets();
  const s = useMemo(() => makeStyles(theme), [theme]);

  const scrollY = useRef(new Animated.Value(0)).current;
  const bountyListRef = useRef<FlatList>(null);
  const offsetRef = useRef(0);

  const { location: userLocation, permission } = useLocation();
  const validUserId = useValidUserId();

  // "N active hunters in your area" pill. Also publishes this viewer's own
  // coordinates, which is what makes the count non-zero for everyone else —
  // see useActiveHunters.
  const { count: activeHuntersCount, radiusMiles: activeHuntersRadius } = useActiveHunters({
    userId: validUserId,
    latitude: userLocation?.latitude,
    longitude: userLocation?.longitude,
    hasPermission: Boolean(permission?.granted),
  });
  const showActiveHunters = activeHuntersCount != null && activeHuntersCount > 0;

  const categories = useMemo(
    () => [
      { id: 'all', label: 'For You', icon: 'auto-awesome' as const },

      ...BOUNTY_CATEGORIES.map(c => ({ id: c.id, label: c.label, icon: c.icon as any })),
    ],
    []
  );

  // The single source of truth for the feed's one horizontal carousel: every
  // category chip plus the Distance chip, injected between Delivery and Other
  // as an ordinary item. Being in this list — rather than in a lane of its own
  // — is what gives Distance the same spacing, scroll and virtualization
  // behavior as the categories; only its tap handler differs. Future secondary
  // filters (Price, Date, Status) get inserted here the same way.
  //
  // `categories` itself stays pure: it's also the allow-list that validates the
  // persisted `activeCategory`, and a pseudo-id in there would read as a real
  // category.
  const filterItems = useMemo<FilterBarItem[]>(() => {
    const items: FilterBarItem[] = categories.map(c => ({ kind: 'category' as const, ...c }));
    const afterDelivery = items.findIndex(i => i.id === 'delivery');
    const beforeOther = items.findIndex(i => i.id === 'other');
    const at =
      afterDelivery >= 0 ? afterDelivery + 1 : beforeOther >= 0 ? beforeOther : items.length;
    items.splice(at, 0, { kind: 'distance', id: DISTANCE_ITEM_ID });
    return items;
  }, [categories]);

  const calculateDistance = useCallback(
    (bountyLocation: string) => {
      if (!bountyLocation) return null;
      if (userLocation && permission?.granted) {
        const coordMatch = bountyLocation.match(/^(-?\d+\.?\d*),\s*(-?\d+\.?\d*)$/);
        if (coordMatch) {
          const lat = parseFloat(coordMatch[1]);
          const lng = parseFloat(coordMatch[2]);
          if (!isNaN(lat) && !isNaN(lng)) {
            return locationService.calculateDistance(
              userLocation,
              { latitude: lat, longitude: lng },
              'miles'
            );
          }
        }
      }
      // No real coordinates to compare against — don't fabricate a number.
      // Callers fall back to showing the bounty's actual location text instead.
      return null;
    },
    [userLocation, permission]
  );

  const bountyDistances = useMemo(() => {
    const distances = new Map<string, number | null>();
    bounties.forEach(bounty => {
      // search_bounties_nearby already computed a real distance server-side —
      // prefer it over the legacy "parse lat,lng out of the location string"
      // fallback, which only ever matches the rare bounty whose free-text
      // location literally is a "lat, lng" pair.
      const known = bounty.distance_miles;
      distances.set(
        String(bounty.id),
        known != null ? known : calculateDistance(bounty.location || '')
      );
    });
    return distances;
  }, [bounties, calculateDistance]);

  const filteredBounties = useMemo(() => {
    let list = [...bounties];
    // Hide bounties whose deadline has passed — they're still visible to the
    // poster (as "Deadline Passed") in My Postings, just not to hunters here.
    list = list.filter(b => !isBountyDeadlinePassed(b));
    if (appliedBountyIds.size > 0) {
      list = list.filter(b => !appliedBountyIds.has(String(b.id)));
    }
    if (activeCategory !== 'all' && activeCategory !== 'everything') {
      // Category filters use only the metadata the poster selected when
      // creating the bounty (see app/screens/CreateBounty/StepTitle.tsx) —
      // never inferred from the bounty's title/description text.
      list = list.filter(b => (b.category || '').toLowerCase() === activeCategory);
    }
    // "Everything" and "For You" both show the full (category-unfiltered) set;
    // BountyGridFeed always features the highest-priced bounties within
    // whatever list it's given, so featured stays highest-priced even when a
    // specific category chip is active.
    list.sort((a, b) => {
      const distA = bountyDistances.get(String(a.id));
      const distB = bountyDistances.get(String(b.id));
      if (distA == null && distB == null) return 0;
      if (distA == null) return 1;
      if (distB == null) return -1;
      return (distA ?? Infinity) - (distB ?? Infinity);
    });
    return list;
  }, [bounties, activeCategory, bountyDistances, appliedBountyIds]);

  // bounty_list_viewed — fires once the feed's actual result set for the
  // current filters is known (skeleton fully resolved), including the
  // results_count=0 case. Deliberately gated on isLoadingBounties/
  // applicationsLoaded rather than firing on the initial `bounties=[]`
  // render, and guarded by lastFiredKeyRef so unrelated re-renders that don't
  // change the visible list (e.g. a distance recompute) don't re-fire it.
  const listViewedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (isLoadingBounties || !applicationsLoaded) return;
    const source =
      distanceFilter !== 'off' ? 'nearby' : activeCategory !== 'all' ? 'category' : 'home_feed';
    const filtersApplied: string[] = [];
    if (activeCategory !== 'all') filtersApplied.push(`category:${activeCategory}`);
    if (distanceFilter !== 'off')
      filtersApplied.push(`radius:${distanceFilter == null ? 'anywhere' : distanceFilter}`);
    const key = `${source}|${filteredBounties.length}|${filtersApplied.join(',')}`;
    if (listViewedKeyRef.current === key) return;
    listViewedKeyRef.current = key;
    analyticsService.trackEvent('bounty_list_viewed', {
      results_count: filteredBounties.length,
      source,
      filters_applied: filtersApplied,
      radius_miles: typeof distanceFilter === 'number' ? distanceFilter : undefined,
      has_location_permission: Boolean(permission?.granted),
      sort_order: distanceFilter !== 'off' ? 'distance' : 'recent',
      is_first_view_of_session: consumeIsFirstBountyListViewOfSession(),
      // Metro-level viewer region (e.g. "Baltimore, MD") so demand density is
      // comparable to bounty_created's metro_region per metro. Named
      // metro_region (not `region`) — getDeviceServiceabilityContext() below
      // already emits a differently-scoped `region` (device locale).
      metro_region: coarseRegionFromLocationText(authProfileService.getCurrentProfile()?.location),
      ...getDeviceServiceabilityContext(),
    });
  }, [
    isLoadingBounties,
    applicationsLoaded,
    filteredBounties,
    activeCategory,
    distanceFilter,
    permission?.granted,
  ]);

  const loadUserApplications = useCallback(async () => {
    const uid = validUserId ?? currentUserId;
    if (!uid) {
      setAppliedBountyIds(new Set());
      setApplicationsLoaded(true);
      return;
    }
    const startedAt = Date.now();
    logger.info('feed.applications.request_started', { userId: uid });
    try {
      // Timeout-protect this fetch: it gates the skeleton loader via
      // `applicationsLoaded`, so an un-timed hang here (stalled network, auth
      // lock deadlock, unresolved Supabase deferred proxy) would otherwise keep
      // the feed on the skeleton screen forever.
      const requests = await withTimeout(
        bountyRequestService.getAll({ userId: uid }),
        API_TIMEOUTS.DEFAULT
      );
      const ids = new Set<string>(
        requests.filter(r => r.bounty_id != null).map(r => String(r.bounty_id))
      );
      setAppliedBountyIds(ids);
      logger.info('feed.applications.request_completed', {
        userId: uid,
        durationMs: Date.now() - startedAt,
        count: ids.size,
        success: true,
      });
    } catch (error) {
      // Non-fatal: applications only drive client-side filtering. DELIBERATELY
      // preserve the previous applied-IDs set here rather than clearing it.
      // Clearing on failure made the feed's visible count fluctuate: on a flaky
      // network, a timed-out applications fetch would drop the filter (applied
      // bounties reappear → count jumps up), then a later success would re-apply
      // it (count drops). Keeping the last-known set makes the feed count stable
      // across refreshes regardless of whether this fetch succeeded.
      const message = error instanceof Error ? error.message : String(error);
      logger.warning('feed.applications.request_failed', {
        userId: uid,
        durationMs: Date.now() - startedAt,
        timedOut: message.includes('timed out'),
        error: message,
      });
    } finally {
      setApplicationsLoaded(true);
    }
  }, [validUserId, currentUserId]);

  const activeCategoryTimerRef = useRef<number | null>(null);
  const handleSetActiveCategory = useCallback((val: string | 'all') => {
    if (activeCategoryTimerRef.current) clearTimeout(activeCategoryTimerRef.current);
    // @ts-ignore
    activeCategoryTimerRef.current = setTimeout(() => {
      setActiveCategory(val);
    }, 250) as unknown as number;
  }, []);

  useEffect(() => {
    return () => {
      if (activeCategoryTimerRef.current) {
        clearTimeout(activeCategoryTimerRef.current);
        // @ts-ignore
        activeCategoryTimerRef.current = null;
      }
    };
  }, []);

  const loadBounties = useCallback(
    async ({ reset = false }: { reset?: boolean } = {}) => {
      if (reset) {
        setIsLoadingBounties(true);
        setLoadError(null);
      } else {
        setLoadingMore(true);
      }
      const pageOffset = reset ? 0 : offsetRef.current;
      const startedAt = Date.now();
      logger.info('feed.bounties.request_started', {
        reset,
        offset: pageOffset,
        pageSize: PAGE_SIZE,
      });
      try {
        const fetchedBounties =
          distanceFilter !== 'off'
            ? await withTimeout(
                searchBountiesNearby({
                  latitude: userLocation?.latitude,
                  longitude: userLocation?.longitude,
                  radiusMiles: distanceFilter,
                  limit: PAGE_SIZE,
                  offset: pageOffset,
                }).then(rows => rows.map(nearbyToBounty)),
                API_TIMEOUTS.DEFAULT
              )
            : await withTimeout(
                bountyService.getAll({ status: 'open', limit: PAGE_SIZE, offset: pageOffset }),
                API_TIMEOUTS.DEFAULT
              );
        const safeBounties = Array.isArray(fetchedBounties) ? fetchedBounties : [];
        const mergeUniqueById = (existing: Bounty[], incoming: Bounty[]) => {
          const map = new Map<string, Bounty>();
          existing.concat(incoming).forEach(b => {
            map.set(String(b.id), b);
          });
          return Array.from(map.values());
        };
        if (reset) {
          setBounties(mergeUniqueById([], safeBounties));
        } else {
          setBounties(prev => mergeUniqueById(prev, safeBounties));
        }
        offsetRef.current = pageOffset + safeBounties.length;
        setHasMore(safeBounties.length === PAGE_SIZE);
        setLoadError(null);
        logger.info('feed.bounties.request_completed', {
          reset,
          durationMs: Date.now() - startedAt,
          count: safeBounties.length,
          success: true,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error('feed.bounties.request_failed', {
          reset,
          durationMs: Date.now() - startedAt,
          timedOut: message.includes('timed out'),
          error: message,
        });
        if (reset) {
          setLoadError(error instanceof Error ? error : new Error(message));
          setBounties(prev => (prev.length === 0 ? [] : prev));
          setHasMore(false);
        }
      } finally {
        // Guaranteed exit: both loading flags are always cleared so the skeleton
        // can never persist because of this request.
        setIsLoadingBounties(false);
        setLoadingMore(false);
      }
    },
    [distanceFilter, userLocation]
  );

  // Distance filter changes what's fetched from the server (unlike category,
  // which filters client-side over the already-loaded page), so it needs a
  // fresh reset load rather than just re-filtering `bounties` in place. Skips
  // its first run — the separate mount effect below already does the initial load.
  const isFirstDistanceFilterRun = useRef(true);
  useEffect(() => {
    if (isFirstDistanceFilterRun.current) {
      isFirstDistanceFilterRun.current = false;
      return;
    }
    offsetRef.current = 0;
    setHasMore(true);
    loadBounties({ reset: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [distanceFilter]);

  // Server-side total of open bounties for the active category. Cheap
  // (head/count query, no rows) and independent of pagination, so the "N active"
  // badge stays stable while the user scrolls. Refreshes on mount + category
  // change (via the effect below) and on pull-to-refresh.
  const refreshActiveCount = useCallback(async () => {
    setActiveCount(null);
    const c = await bountyService.getOpenCount({ category: activeCategory });
    setActiveCount(c);
  }, [activeCategory]);

  useEffect(() => {
    refreshActiveCount();
  }, [refreshActiveCount]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      offsetRef.current = 0;
      setHasMore(true);
      setNewBountiesCount(0);
      await Promise.all([
        loadBounties({ reset: true }),
        loadUserApplications().catch(err =>
          console.error('Failed to refresh user applications:', err)
        ),
        refreshActiveCount().catch(err => console.error('Failed to refresh active count:', err)),
      ]);
    } catch (error) {
      console.error('Error refreshing bounties:', error);
    } finally {
      setRefreshing(false);
    }
  }, [loadBounties, loadUserApplications, refreshActiveCount]);

  // Realtime: patch/remove already-loaded bounties in place (safe regardless
  // of pagination), and surface new open-bounty INSERTs as a count rather
  // than splicing them into the paginated list.
  useEffect(() => {
    const channel = supabase
      .channel('bounty-feed:bounties')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'bounties', filter: 'status=eq.open' },
        () => {
          setNewBountiesCount(prev => prev + 1);
        }
      )
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'bounties' }, payload => {
        const updated = payload.new as Bounty;
        setBounties(prev => {
          const exists = prev.some(b => String(b.id) === String(updated.id));
          if (!exists) return prev;
          // A bounty that's no longer open (accepted/cancelled/expired) should
          // drop out of the open-bounties feed rather than linger with a
          // stale status.
          if (updated.status !== 'open') {
            return prev.filter(b => String(b.id) !== String(updated.id));
          }
          return prev.map(b => (String(b.id) === String(updated.id) ? { ...b, ...updated } : b));
        });
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'bounties' }, payload => {
        const deletedId = (payload.old as Partial<Bounty>)?.id;
        if (deletedId == null) return;
        setBounties(prev => prev.filter(b => String(b.id) !== String(deletedId)));
      })
      .subscribe();

    return () => {
      try {
        supabase.removeChannel(channel);
      } catch {
        // best-effort cleanup
      }
    };
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      refresh: () => {
        offsetRef.current = 0;
        setHasMore(true);
        loadBounties({ reset: true });
      },
      handleTabRepress: () => {
        bountyListRef.current?.scrollToOffset({ offset: 0, animated: true });
        onRefresh();
      },
    }),
    [loadBounties, onRefresh]
  );

  useEffect(() => {
    loadUserApplications();
  }, [loadUserApplications]);
  useEffect(() => {
    loadBounties({ reset: true });
  }, []); // eslint-disable-line
  // On returning to the bounty tab, refresh only the applied-bounty set (cheap,
  // keeps the "already applied" filter current). Deliberately do NOT call
  // loadBounties here: this component stays mounted (hidden via display:none),
  // so its realtime subscription keeps the loaded list fresh and surfaces new
  // posts via the "New bounties" pill. The previous `loadBounties({ reset:false })`
  // appended the NEXT page on every tab focus, so the visible bounty count crept
  // up on focus and dropped back on the next reset — a spurious, confusing
  // change in the number of bounties shown. Initial load, pull-to-refresh, and
  // the foreground-resume effect are the real (re)load triggers.
  useEffect(() => {
    if (activeScreen === 'bounty') {
      loadUserApplications();
    }
  }, [activeScreen, loadUserApplications]);

  // Silently reload feed data when the app returns from the background.
  // Requests started before backgrounding can be dropped by the OS and
  // realtime/websocket connections die while suspended, so without this the
  // feed can come back stale or empty until a manual pull-to-refresh.
  // Only run when the bounty tab is active – BountyFeed is always mounted
  // (hidden via display:none on other tabs), so skipping the refresh on
  // inactive tabs avoids unnecessary network/battery churn.
  // The activeScreen guard is a runtime check inside the callback (rather than
  // a conditional hook call) because React's Rules of Hooks prohibit calling
  // hooks conditionally. useForegroundRefresh stores the callback in a ref and
  // always invokes the latest version, so activeScreen here reflects the current
  // tab at the moment the foreground resume fires.
  useForegroundRefresh(
    useCallback(() => {
      if (activeScreen !== 'bounty') return;
      logger.info('feed.foreground.refresh_started', { targets: ['bounties', 'applications'] });
      offsetRef.current = 0;
      setHasMore(true);
      loadBounties({ reset: true });
      loadUserApplications().catch(err => {
        logger.warning('feed.foreground.applications_refresh_failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }, [activeScreen, loadBounties, loadUserApplications])
  );

  useEffect(() => {
    (async () => {
      try {
        const saved = await storage.getItem('BE:lastFilter');
        if (saved) setActiveCategory(saved as any);
      } catch {}
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await storage.setItem('BE:lastFilter', String(activeCategory));
      } catch {}
    })();
  }, [activeCategory]);

  useEffect(() => {
    const ids = categories.map(c => c.id);
    if (activeCategory !== 'all' && !ids.includes(String(activeCategory))) {
      setActiveCategory('all');
    }
  }, [categories, activeCategory]);

  const keyExtractor = useCallback(
    (item: Bounty, index: number) => (item.id != null ? item.id.toString() : `bounty-${index}`),
    []
  );

  const renderBountyItem = useCallback(
    ({ item }: { item: Bounty }) => {
      const distance =
        bountyDistances.get(String(item.id)) ?? calculateDistance(item.location || '');
      const props = {
        id: item.id,
        title: item.title,
        username: item.username,
        price: Number(item.amount),
        distance,
        // Prefer the coarse neighborhood label — item.location is only the
        // full/legacy exact address for bounties created before this location
        // redesign (see docs/ location plan; new bounties don't fall back to it).
        location: item.neighborhood || item.location,
        description: item.description,
        isForHonor: Boolean(item.is_for_honor),
        user_id: item.user_id,
        work_type: item.work_type,
        poster_avatar: item.poster_avatar,
        // Schedule fields (Phase 1)
        schedule_type: item.schedule_type,
        start_date: item.start_date,
        end_date: item.end_date,
        duration_minutes: item.duration_minutes,
        is_time_sensitive: item.is_time_sensitive,
      };
      if (isCompact) {
        return <BountyCompactItem {...props} />;
      }
      return (
        <View style={{ height: listHeight }}>
          <BountyListItem {...props} />
        </View>
      );
    },
    [bountyDistances, calculateDistance, listHeight, isCompact]
  );

  const handleEndReached = useCallback(() => {
    if (!isLoadingBounties && !loadingMore && hasMore) loadBounties();
  }, [isLoadingBounties, loadingMore, hasMore, loadBounties]);

  const ItemSeparator = useCallback(() => null, []);

  const EmptyListComponent = useCallback(() => {
    if (isLoadingBounties || !applicationsLoaded) {
      return (
        <View style={{ width: '100%' }}>
          <PostingsListSkeleton count={5} />
        </View>
      );
    }
    if (loadError) {
      return (
        <EmptyState
          icon="cloud-off"
          title="Unable to load bounties"
          description="Check your internet connection and try again"
          actionLabel="Try Again"
          onAction={() => loadBounties({ reset: true })}
        />
      );
    }
    // Distance now lives in the same row as the categories, so an empty result
    // caused by either filter gets the same one-tap escape hatch.
    const hasCategoryFilter = Boolean(activeCategory) && activeCategory !== 'all';
    const hasDistanceFilter = distanceFilter !== DISTANCE_OFF;
    if (hasCategoryFilter || hasDistanceFilter) {
      const clearsBoth = hasCategoryFilter && hasDistanceFilter;
      return (
        <View style={{ width: '100%', alignItems: 'center' }}>
          <Text style={{ color: theme.textSecondary, marginBottom: 8 }}>
            No bounties match {clearsBoth ? 'these filters' : 'this filter'}.
          </Text>
          <TouchableOpacity
            onPress={() => {
              if (hasCategoryFilter) handleSetActiveCategory('all');
              if (hasDistanceFilter) setDistanceFilter(DISTANCE_OFF);
            }}
            accessibilityRole="button"
            accessibilityLabel={clearsBoth ? 'Clear filters' : 'Clear filter'}
            style={{
              backgroundColor: theme.surfaceSecondary,
              paddingHorizontal: 16,
              paddingVertical: 10,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: theme.border,
            }}
          >
            <Text style={{ color: theme.text, fontWeight: '700' }}>
              {clearsBoth ? 'Clear filters' : 'Clear filter'}
            </Text>
          </TouchableOpacity>
        </View>
      );
    }
    return (
      <EmptyState
        icon="search-off"
        title="No bounties yet"
        description="No bounties near you yet. Be the first to post one!"
        actionLabel="Post a bounty"
        onAction={() => router.push('/screens/CreateBounty')}
      />
    );
  }, [
    isLoadingBounties,
    applicationsLoaded,
    loadError,
    loadBounties,
    activeCategory,
    distanceFilter,
    handleSetActiveCategory,
    theme,
    router,
  ]);

  const ListFooterComponent = useCallback(
    () =>
      loadingMore ? (
        <View style={{ paddingVertical: 8 }}>
          <PostingsListSkeleton count={2} />
        </View>
      ) : null,
    [loadingMore]
  );

  // Renders the feed's one and only horizontal filter carousel, from the single
  // `filterItems` source: category chips and the Distance chip side by side,
  // scrolling together as one list.
  //
  // Uses a ScrollView, never a nested FlatList: in the grid layout this row is
  // rendered inside another FlatList's ListHeaderComponent, and a nested
  // FlatList's gesture recognizer steals all touches there, so onPress never
  // fires.
  const renderFilterBar = () => (
    <View style={s.filtersRow}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.filtersScrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {filterItems.map(item => {
          if (item.kind === 'distance') {
            return (
              <FilterChipSelect<DistanceFilterValue>
                key={item.id}
                label="Distance"
                icon="near-me"
                value={distanceFilter}
                neutralValue={DISTANCE_OFF}
                options={DISTANCE_OPTIONS}
                onChange={setDistanceFilter}
                description="Show bounties within a radius of you."
                hint={
                  permission?.granted
                    ? undefined
                    : 'Location access is off, so distance filters may not match what’s actually near you.'
                }
                testID="feed-distance-filter"
              />
            );
          }
          const isActive = activeCategory === item.id;
          return (
            <FilterChip
              key={item.id}
              label={item.label}
              icon={item.icon}
              active={isActive}
              onPress={() => handleSetActiveCategory(isActive ? 'all' : (item.id as any))}
              accessibilityLabel={`Filter by ${item.label}${isActive ? ', currently active' : ''}`}
              accessibilityHint={
                isActive
                  ? 'Tap to remove filter and show all bounties'
                  : `Tap to filter bounties by ${item.label}`
              }
            />
          );
        })}
      </ScrollView>
    </View>
  );

  return (
    <View style={s.dashboardArea}>
      {/* Search row — non-grid only (grid has its search inside the banner block
          below). Carries three things on one line: search, the live
          active-hunters pill, and the notification bell.

          The pill shares this row rather than owning a line beneath it so the
          "people are here right now" signal sits in the header chrome the eye
          already lands on, and costs no vertical space above the cards.

          Hidden at 0 as well as at null: the hook returns null whenever the
          number isn't known (permission off, no fix yet, RPC failed), and a
          literal "0 nearby" is worse than silence for someone deciding whether
          to post. */}
      {bountyFormat !== 'grid' && (
        <View style={[s.searchWrapper, s.searchRow]}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Open search"
            onPress={() => router.push('/tabs/search')}
            style={[s.searchButton, s.searchButtonFlex]}
          >
            <MaterialIcons
              name="search"
              size={20}
              color={theme.textDisabled}
              style={s.searchIcon}
            />
            {/* Placeholder shortens when the pill is present so the three items
                fit on one line without the search label truncating mid-word. */}
            <Text style={s.searchText} numberOfLines={1}>
              {showActiveHunters ? 'Search bounties...' : 'Search bounties or users...'}
            </Text>
          </TouchableOpacity>

          {showActiveHunters && (
            <View
              style={s.huntersPill}
              accessibilityRole="text"
              accessibilityLabel={`${activeHuntersCount} active ${
                activeHuntersCount === 1 ? 'hunter' : 'hunters'
              } within ${activeHuntersRadius} miles of you`}
              testID="feed-active-hunters-caption"
            >
              <LiveDot color={theme.success} />
              <Text style={s.huntersPillText} numberOfLines={1}>
                <Text style={s.huntersPillCount}>{activeHuntersCount}</Text> nearby
              </Text>
            </View>
          )}

          <NotificationBell />
        </View>
      )}

      {/* Filter row — outside FlatList for non-grid; grid gets it inside listHeader */}
      {bountyFormat !== 'grid' && renderFilterBar()}

      {/* New-bounties pill — surfaces realtime INSERTs without splicing them into
          the paginated list mid-scroll. Sits above the list so it works across
          all three feed layouts (grid/list/compact). */}
      {newBountiesCount > 0 && (
        <TouchableOpacity
          style={s.newBountiesPill}
          onPress={() => {
            bountyListRef.current?.scrollToOffset?.({ offset: 0, animated: true });
            onRefresh();
          }}
          accessibilityRole="button"
          accessibilityLabel={`${newBountiesCount} new bounty${newBountiesCount === 1 ? '' : 'ies'} available, tap to refresh`}
        >
          <MaterialIcons name="arrow-upward" size={16} color="#ffffff" style={{ marginRight: 6 }} />
          <Text style={s.newBountiesPillText}>
            {newBountiesCount} new bount{newBountiesCount === 1 ? 'y' : 'ies'}
          </Text>
        </TouchableOpacity>
      )}

      {/* List area */}
      {bountyFormat === 'grid' ? (
        <View style={{ flex: 1, marginTop: -(insets.top + 8) }}>
          <BountyGridFeed
            bounties={filteredBounties}
            bountyDistances={bountyDistances}
            listHeader={
              <View>
                {/* Banner */}
                <View style={[s.gridBanner, { paddingTop: insets.top + 2 }]}>
                  <LinearGradient
                    colors={['#064e3b', '#059669', '#10b981']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
                  />
                  <Text style={s.gridBannerTitle}>Find a Bounty</Text>
                  <View style={s.gridBannerSubRow}>
                    {/* Left half of a deliberate supply/demand pair: hunters
                        here, open bounties in the badge opposite. Together they
                        answer "is this market liquid enough to be worth
                        posting?" on the highest-attention line in the layout,
                        without costing any extra height.

                        Falls back to the original static subtitle whenever the
                        count isn't known or is zero — same rule as the pill in
                        the other layouts, so an empty area reads as ordinary
                        copy rather than a broken stat. */}
                    {activeHuntersCount != null && activeHuntersCount > 0 ? (
                      <View
                        style={s.gridBannerHunters}
                        accessibilityRole="text"
                        accessibilityLabel={`${activeHuntersCount} active ${
                          activeHuntersCount === 1 ? 'hunter' : 'hunters'
                        } within ${activeHuntersRadius} miles of you`}
                        testID="feed-active-hunters-banner"
                      >
                        <MaterialIcons
                          name="people"
                          size={14}
                          color="rgba(255,255,255,0.9)"
                          style={s.gridBannerHuntersIcon}
                        />
                        <Text style={s.gridBannerSubtitle} numberOfLines={1}>
                          {activeHuntersCount} {activeHuntersCount === 1 ? 'hunter' : 'hunters'}{' '}
                          nearby
                        </Text>
                      </View>
                    ) : (
                      <Text style={s.gridBannerSubtitle}>Explore tasks near you</Text>
                    )}
                    <View style={s.gridBannerCountBadge}>
                      {/* Stable server count of open bounties in this category
                          (independent of pagination). Falls back to the loaded
                          count when the count query hasn't resolved / failed, or
                          when a distance filter is active (that set comes from
                          the nearby-search RPC, which has no total). */}
                      <Text style={s.gridBannerCountText}>
                        {distanceFilter !== 'off' || activeCount == null
                          ? filteredBounties.length
                          : activeCount}{' '}
                        active
                      </Text>
                    </View>
                  </View>
                  <View style={s.gridBannerSearchWrapper}>
                    <TouchableOpacity
                      accessibilityRole="button"
                      accessibilityLabel="Open search"
                      onPress={() => router.push('/tabs/search')}
                      style={s.gridBannerSearchButton}
                    >
                      <MaterialIcons
                        name="search"
                        size={18}
                        color="rgba(255,255,255,0.85)"
                        style={s.searchIcon}
                      />
                      <Text style={s.gridBannerSearchText}>Search bounties or users...</Text>
                    </TouchableOpacity>
                  </View>
                </View>
                {/* The same single filter carousel used by the non-grid layouts
                    (category chips + Distance), rendered here inside the grid
                    FlatList's header. renderFilterBar deliberately uses a
                    ScrollView (not a nested FlatList) so it works in this
                    nested-list context without the gesture-recognizer conflict.
                    Previously the grid branch inlined its own chip row against
                    removed styles (s.chip/*), which broke the build and rendered
                    unstyled chips with no Distance filter. */}
                {renderFilterBar()}
              </View>
            }
          />
        </View>
      ) : (
        <View style={{ flex: 1 }} onLayout={e => setListHeight(e.nativeEvent.layout.height)}>
          <Animated.FlatList
            ref={bountyListRef}
            data={filteredBounties}
            keyExtractor={keyExtractor}
            pagingEnabled={!isCompact}
            snapToInterval={isCompact ? undefined : listHeight}
            snapToAlignment="start"
            decelerationRate="fast"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{
              paddingTop: 0,
              paddingBottom: 0,
              paddingHorizontal: 0,
            }}
            onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
              useNativeDriver: false,
            })}
            scrollEventThrottle={16}
            onEndReachedThreshold={0.5}
            onEndReached={handleEndReached}
            ItemSeparatorComponent={ItemSeparator}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={theme.primary}
              />
            }
            ListEmptyComponent={EmptyListComponent}
            ListFooterComponent={ListFooterComponent}
            renderItem={renderBountyItem}
            removeClippedSubviews={true}
            maxToRenderPerBatch={5}
            windowSize={5}
            initialNumToRender={3}
          />
        </View>
      )}

      <LinearGradient
        colors={
          [`${theme.background}00`, `${theme.background}CC`, theme.background] as [
            string,
            string,
            string,
          ]
        }
        style={s.bottomFade}
        pointerEvents="none"
      />
    </View>
  );
});

function makeStyles(t: AppTheme) {
  return StyleSheet.create({
    dashboardArea: {
      flex: 1,
      backgroundColor: t.background,
    },
    searchWrapper: {
      paddingHorizontal: SPACING.SCREEN_HORIZONTAL,
      marginBottom: SPACING.COMPACT_GAP,
      marginTop: 30,
    },
    searchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACING.COMPACT_GAP,
    },
    searchButtonFlex: {
      flex: 1,
    },
    searchButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: t.surfaceSecondary,
      borderRadius: 999,
      paddingVertical: 12,
      paddingHorizontal: 16,
      borderWidth: 1,
      borderColor: t.border,
      shadowColor: '#000',
      shadowOpacity: 0.05,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 4 },
      elevation: 2,
    },
    searchIcon: { marginRight: SPACING.COMPACT_GAP },
    searchText: {
      color: t.textDisabled,
      fontSize: 14,
      fontWeight: '500',
      flex: 1,
    },

    // ── Filter carousel (categories + inline filter chips) ───────────────────
    filtersRow: {
      paddingVertical: SPACING.COMPACT_GAP,
    },
    filtersScrollContent: {
      paddingHorizontal: SPACING.SCREEN_HORIZONTAL,
      alignItems: 'center',
    },

    // ── Active-hunters pill (card / compact layouts) ─────────────────────────
    // Rides the search row between the search field and the notification bell,
    // so it reads as part of the same header chrome: identical pill radius,
    // secondary surface and hairline border as the search field and the bell,
    // and the same 44pt height so all three items share one baseline.
    //
    // Not tappable, by design — it is ambient context about the room, not a
    // control, and the newBountiesPill below is the row-adjacent green CTA.
    huntersPill: {
      flexDirection: 'row',
      alignItems: 'center',
      height: SIZING.MIN_TOUCH_TARGET,
      paddingHorizontal: 11,
      borderRadius: 999,
      backgroundColor: t.surfaceSecondary,
      borderWidth: 1,
      borderColor: t.border,
      // Never let the pill squeeze the bell or grow past its own content.
      flexShrink: 0,
    },
    huntersPillText: {
      // A step below the search placeholder: this is a stat chip, and the
      // smaller type is also what keeps all three items on one line on a
      // narrow screen.
      color: t.textSecondary,
      fontSize: TYPOGRAPHY.SIZE_XSMALL,
      fontWeight: '600',
      marginLeft: 7,
    },
    // Only the number carries emphasis — the surrounding word stays secondary
    // so the stat scans at a glance without shouting.
    huntersPillCount: {
      color: t.text,
      fontWeight: '800',
    },

    // ── New-bounties pill ────────────────────────────────────────────────────
    newBountiesPill: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'center',
      backgroundColor: t.primary,
      paddingHorizontal: 16,
      height: 36,
      borderRadius: 999,
      marginBottom: SPACING.COMPACT_GAP,
      minHeight: SIZING.MIN_TOUCH_TARGET,
      zIndex: 10,
    },
    newBountiesPillText: {
      color: '#ffffff',
      fontSize: TYPOGRAPHY.SIZE_SMALL,
      fontWeight: '700',
    },

    // ── Bottom fade ───────────────────────────────────────────────────────────
    bottomFade: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      height: 140,
      zIndex: 50,
    },

    // ── Grid banner ───────────────────────────────────────────────────────────
    gridBanner: {
      overflow: 'hidden',
      marginHorizontal: -SPACING.SCREEN_HORIZONTAL,
      marginBottom: 20,
      paddingHorizontal: SPACING.SCREEN_HORIZONTAL,
      paddingTop: 32,
      paddingBottom: 32,
    },
    gridBannerSearchWrapper: {
      marginTop: 24,
      marginBottom: 4,
    },
    gridBannerSearchButton: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: 'rgba(5,46,27,0.35)',
      borderRadius: 999,
      paddingVertical: 12,
      paddingHorizontal: SPACING.SCREEN_HORIZONTAL,
      minHeight: SIZING.MIN_TOUCH_TARGET,
    },
    gridBannerSearchText: {
      color: 'rgba(255,255,255,0.85)',
      fontSize: TYPOGRAPHY.SIZE_SMALL,
      flex: 1,
    },
    gridBannerTitle: {
      color: '#ffffff',
      fontSize: 38,
      fontWeight: '800',
      letterSpacing: -0.5,
      marginBottom: 10,
    },
    gridBannerSubRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: 4,
    },
    gridBannerSubtitle: {
      color: 'rgba(255,255,255,0.72)',
      fontSize: 14,
      fontWeight: '500',
    },
    // Occupies the subtitle's slot in the sub-row when a live count exists.
    // flexShrink so a long count can never push the bounty-count badge off the
    // right edge on a narrow screen.
    gridBannerHunters: {
      flexDirection: 'row',
      alignItems: 'center',
      flexShrink: 1,
      marginRight: 8,
    },
    gridBannerHuntersIcon: {
      marginRight: 5,
    },
    gridBannerCountBadge: {
      backgroundColor: 'rgba(255,255,255,0.18)',
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.3)',
    },
    gridBannerCountText: {
      color: '#ffffff',
      fontSize: 12,
      fontWeight: '700',
    },
  });
}
