import { MaterialIcons } from '@expo/vector-icons';
import { useLocation } from 'app/hooks/useLocation';
import { BountyCompactItem } from 'components/bounty-compact-item';
import { BountyDetailHost } from 'components/bounty-detail-host';
import { BountyGridFeed } from 'components/bounty-grid-feed';
import { BountyListItem } from 'components/bounty-list-item';
import {
    LARGE_TAB_HEIGHT,
    MyBountyProgressCarousel,
    sortByProgress,
    type MyBountyProgressItem,
} from 'components/my-bounty-progress-banner';
import { NotificationBell } from 'components/notifications/notification-bell';
import {
    ActiveHuntersPill,
    MIN_ACTIVE_HUNTERS_TO_SHOW,
} from 'components/ui/active-hunters-pill';
import {
    SEARCH_FIELD_MAX_FONT_SCALE,
    SEARCH_FIELD_TEXT,
    SearchBarRow,
} from 'components/ui/search-bar-row';
import { EmptyState } from 'components/ui/empty-state';
import { FilterChip, type FilterChipIconName } from 'components/ui/filter-chip';
import { FilterChipSelect, type FilterChipOption } from 'components/ui/filter-chip-select';
import { PostingsListSkeleton } from 'components/ui/skeleton-loaders';
import { LinearGradient } from 'expo-linear-gradient';
import { useIsFocused, useRouter } from 'expo-router';
import {
    forwardRef,
    useCallback,
    useEffect,
    useId,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
} from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import {
    Animated,
    FlatList,
    RefreshControl,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
// Gesture-handler's ScrollView so the filter carousel claims horizontal drags
// before the tab shell's swipe-between-tabs pan (app/tabs/bounty-app.tsx).
import { ScrollView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useActiveHunters } from '../hooks/useActiveHunters';
import { useFeedLocation } from '../hooks/useFeedLocation';
import { useForegroundRefresh } from '../hooks/useForegroundRefresh';
import { useRefreshOnReturn } from '../hooks/useRouteFocus';
import { useShowTestBounties } from '../hooks/useShowTestBounties';
import { useValidUserId } from '../hooks/useValidUserId';
import { consumeIsFirstBountyListViewOfSession } from '../lib/analytics/sessionFlags';
import { useBountyFormat } from '../lib/bounty-format-context';
import { useTopInsetOverlay } from '../lib/context/TopInsetOverlayContext';
import { pageTranslateX, useTabPager } from './ui/tab-pager';
import { API_TIMEOUTS } from '../lib/config/network';
import { SIZING, SPACING, TYPOGRAPHY } from '../lib/constants/accessibility';
import { BOUNTY_CATEGORIES } from '../lib/constants/bounty-categories';
import { analyticsService } from '../lib/services/analytics-service';
import { authProfileService } from '../lib/services/auth-profile-service';
import { searchBountiesNearby, type NearbyBounty } from '../lib/services/bounty-location-service';
import { bountyRequestService } from '../lib/services/bounty-request-service';
import { bountyService } from '../lib/services/bounty-service';
import { completionService } from '../lib/services/completion-service';
import type { Bounty } from '../lib/services/database.types';
import { bountyDistanceMiles } from '../lib/utils/bounty-distance';
import { storage } from '../lib/storage';
import { supabase } from '../lib/supabase';
import { useAppThemeContext } from '../lib/themes/AppThemeContext';
import type { AppTheme } from '../lib/themes/types';
import {
    getBountyCompleteness,
    summarizeMissingDetails,
    type BountyCompleteness,
} from '../lib/utils/bounty-completeness';
import {
    clearBountyRemovedLocally,
    filterOpenFeedBounties,
    isBountyVisibleInOpenFeed,
    markBountyRemovedLocally,
} from '../lib/utils/bounty-visibility';
import { logger } from '../lib/utils/error-logger';
import {
  applyDistancePick,
  DISTANCE_OFF,
  DISTANCE_PREFERENCE_KEY,
  includeOnlineFor,
  LOCAL_DEFAULT_RADIUS_MILES,
  parseDistancePreference,
  resolveDefaultDistance,
  type DistanceFilterValue,
  type DistancePreference,
} from '../lib/utils/feed-distance-default';
import { formatPublicLocation } from '../lib/utils/public-location';
import { isBountyDeadlinePassed } from '../lib/utils/schedule-utils';
import { coarseRegionFromLocationText, getDeviceServiceabilityContext } from '../lib/utils/serviceable-region';
import { withTimeout } from '../lib/utils/withTimeout';

export type BountyFeedHandle = {
  refresh: () => void;
  handleTabRepress: () => void;
};

// bounty-ranking-v2 experiment (PostHog flag `bounty-ranking-v2`, experiment
// id 463516). Flag evaluation and the weighted formula both run server-side
// in the `bounty-ranking` edge function (see lib/ranking/bounty-ranking-v2.ts)
// — this component only ever reorders `filteredBounties` into the sections
// that function returns, or leaves today's client-side order untouched for
// `control` / while unresolved / on any failure. Scoped to the list/compact
// layouts only: BountyGridFeed already re-sorts by price internally (a
// separate, pre-existing product decision — see its own buildGridRows), so a
// server-decided order would just be discarded there.
type RankedEntry = { id: string; rank_score: number };
type RankingResponse =
  | { variant: 'control' }
  | { variant: 'test'; sections: { main: RankedEntry[]; dormant: RankedEntry[]; honor: RankedEntry[] } };

interface BountyFeedProps {
  activeScreen: string;
  setActiveScreen: (screen: string) => void;
  currentUserId?: string;
}

const PAGE_SIZE = 10;
// Most rows a reload in place (resume, a refresh after posting/accepting)
// re-reads in one request — search_bounties_nearby's own server-side cap.
const MAX_RELOAD_ROWS = 100;
// The progress cards page through the poster's whole live set. Nearly every
// poster fits in one page; the page cap only bounds a runaway loop.
const MY_ACTIVE_BOUNTIES_PAGE_SIZE = 100;
const MY_ACTIVE_BOUNTIES_MAX_PAGES = 10;

// Grid banner fill. Solid brand green from the theme context (theme.primary);
// kept as a 3-stop gradient so RootFrame's status-bar strip and the banner
// stay one continuous slice. Built per-theme inside the component.
const GRID_BANNER_GRADIENT_START = { x: 0, y: 0 };
const GRID_BANNER_GRADIENT_END = { x: 1, y: 1 };

// 'off' = no distance filter. A number is a radius in miles, applied to
// in-person work only: online jobs are always kept (SBA-02). `null` is the
// explicit "Anywhere" preset — still uses search_bounties_nearby (so results
// get real distances/sort) but without a radius cap. The default for a hunter
// with a location is LOCAL_DEFAULT_RADIUS_MILES — see lib/utils/feed-distance-default.
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
const ONLINE_ITEM_ID = '__online__';
const HIGHEST_PAY_ITEM_ID = '__highest_pay__';
type FilterBarItem =
  | { kind: 'category'; id: string; label: string; icon: FilterChipIconName }
  | { kind: 'distance'; id: typeof DISTANCE_ITEM_ID }
  // Not a stored category — filters on the bounty's work_type ('online' vs
  // 'in_person', set in StepWhere.tsx) rather than its category field.
  | { kind: 'workType'; id: typeof ONLINE_ITEM_ID }
  // Not a filter at all — toggles the list's sort order rather than removing
  // rows, so it composes with every category/workType/distance combination.
  | { kind: 'sort'; id: typeof HIGHEST_PAY_ITEM_ID };

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
    work_type: (nb.work_type ?? undefined) as Bounty['work_type'],
  };
}

// useId() is deterministic and can repeat when a component unmounts and
// remounts at the same tree position, so it alone doesn't guarantee a fresh
// realtime topic (see instanceId below). This counter is bumped exactly once
// per mount via a useState lazy initializer, so appending it makes every
// mount's topic unique even during a rapid unmount/remount.
let bountyFeedMountCounter = 0;

const BountyFeedContent = forwardRef<BountyFeedHandle, BountyFeedProps>(function BountyFeedContent(
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
  // The distance in effect is `distanceOverride ?? defaultDistance` (below):
  // undefined = the hunter hasn't picked one, so the default applies.
  const [distanceOverride, setDistanceOverride] = useState<DistanceFilterValue | undefined>(
    undefined
  );
  // Remembered "Any distance" choice (lib/utils/feed-distance-default).
  const [distancePreference, setDistancePreference] = useState<DistancePreference>('local');
  const [distancePreferenceLoaded, setDistancePreferenceLoaded] = useState(false);
  // Part of the filter bar's single selection group — see selectOnlyFilter.
  const [onlineOnly, setOnlineOnly] = useState(false);
  const [sortByHighestPay, setSortByHighestPay] = useState(false);
  // Count of newly-posted open bounties observed via realtime that could NOT
  // be put straight into the list — only while a distance filter is active
  // (the INSERT payload can't say whether the bounty is inside the radius) or
  // when fetching the new row failed. Every other new bounty renders live;
  // see the realtime INSERT handler. Surfaced as a "New bounties" pill the
  // user taps to pull a fresh page.
  const [newBountiesCount, setNewBountiesCount] = useState(0);
  // Server-side total of open bounties for the active category — the stable,
  // accurate figure behind the "N active" badge. null until first fetched (and
  // on count-fetch failure), in which case the badge falls back to the loaded
  // count. See bountyService.getOpenCount.
  const [activeCount, setActiveCount] = useState<number | null>(null);
  // The viewer's own live bounties (open, in progress, or waiting on their
  // review), furthest-along first. Drives the swipeable progress cards floating
  // at the top of the feed, in every layout. See sortByProgress.
  const [myActiveBounties, setMyActiveBounties] = useState<MyBountyProgressItem[]>([]);
  // True while the progress cards are swiped away and only their tab shows.
  const [progressTabVisible, setProgressTabVisible] = useState(false);

  // "See test bounties anyway" — internal accounts only (bounty_test_flag_
  // and_internal_profiles migration). isInternal reads the already-fetched
  // profile rather than a hook, matching this file's existing
  // authProfileService usage below; the persisted toggle itself is
  // meaningless (and never rendered) for anyone else.
  const isInternalViewer = !!authProfileService.getCurrentProfile()?.is_internal;
  const { showTestBounties } = useShowTestBounties();
  const includeTestBounties = isInternalViewer && showTestBounties;

  const { theme } = useAppThemeContext();
  const gridBannerGradient = useMemo(
    () => [theme.primary, theme.primary, theme.primary] as const,
    [theme.primary]
  );
  const { bountyFormat } = useBountyFormat();
  const isCompact = bountyFormat === 'compact';
  const insets = useSafeAreaInsets();
  // Grid layout only. RootFrame (app/_layout.tsx) paints the status-bar strip
  // itself — app content is laid out beneath it and can't draw there — so the
  // grid banner, which is pulled flush to the top of the content frame, used to
  // butt up against a white (light) / black (dark) bar. Handing RootFrame the
  // banner's own gradient makes that strip the banner's true top slice, so the
  // green runs unbroken from the top of the display through the banner.
  //
  // `useTopInsetOverlay` is null outside the provider (tests,
  // BountyFormatPreview), where there is no inset to paint.
  const topInsetOverlay = useTopInsetOverlay();
  // Measured rather than assumed: the banner's height is both the gradient's
  // full extent and how far you can scroll before it stops touching the top,
  // and it varies with the active-hunters row and the viewer's font scale.
  const [gridBannerHeight, setGridBannerHeight] = useState(0);
  const [gridBannerCoversStatusBar, setGridBannerCoversStatusBar] = useState(true);
  const s = useMemo(() => makeStyles(theme), [theme]);

  const scrollY = useRef(new Animated.Value(0)).current;
  // Drives the status-bar overlay's translateY so the seam with the banner
  // holds while the grid scrolls, without re-rendering RootFrame per frame.
  const gridScrollY = useRef(new Animated.Value(0)).current;
  const bountyListRef = useRef<FlatList>(null);
  const offsetRef = useRef(0);

  const { location: userLocation, permission } = useLocation();
  const validUserId = useValidUserId();

  // SBA-02: a hunter with a location (device fix or saved profile point) sees
  // in-person work within LOCAL_DEFAULT_RADIUS_MILES plus every online job,
  // unless they chose "Any distance". The first load waits for `ready` so it
  // doesn't show everything and then snap to the local set.
  const feedLocation = useFeedLocation({
    userId: validUserId ?? currentUserId,
    deviceLocation: userLocation,
    permission,
  });
  const searchCoords = feedLocation.coords;
  const hasFeedLocation = searchCoords != null;
  const defaultDistance = resolveDefaultDistance({
    hasLocation: hasFeedLocation,
    preference: distancePreference,
  });
  const distanceFilter: DistanceFilterValue =
    distanceOverride !== undefined ? distanceOverride : defaultDistance;
  const isDefaultDistance = distanceOverride === undefined;
  const feedFiltersReady = feedLocation.ready && distancePreferenceLoaded;

  // "N active hunters in your area" pill. Also publishes this viewer's own
  // coordinates, which is what makes the count non-zero for everyone else —
  // see useActiveHunters.
  const { count: activeHuntersCount, radiusMiles: activeHuntersRadius } = useActiveHunters({
    userId: validUserId,
    latitude: userLocation?.latitude,
    longitude: userLocation?.longitude,
    hasPermission: Boolean(permission?.granted),
  });
  const showActiveHunters =
    activeHuntersCount != null && activeHuntersCount >= MIN_ACTIVE_HUNTERS_TO_SHOW;

  const categories = useMemo(
    () => [
      { id: 'all', label: 'For You', icon: 'auto-awesome' as const },

      ...BOUNTY_CATEGORIES.map(c => ({ id: c.id, label: c.label, icon: c.icon as any })),
    ],
    []
  );

  // The single source of truth for the feed's one horizontal carousel: every
  // category chip plus the non-category filter/sort chips, in the app's
  // canonical order — For You, Labor, Online, Highest pay, Delivery, Design,
  // Tech, Writing, Other, Distance. Being in this one list — rather than each
  // chip having a lane of its own — is what gives every chip the same
  // spacing, scroll and virtualization behavior; only the tap handler differs
  // per `kind`. Future secondary filters get inserted here the same way.
  //
  // `categories` itself stays pure: it's also the allow-list that validates the
  // persisted `activeCategory`, and a pseudo-id in there would read as a real
  // category.
  const filterItems = useMemo<FilterBarItem[]>(() => {
    const items: FilterBarItem[] = categories.map(c => ({ kind: 'category' as const, ...c }));
    const afterLabor = items.findIndex(i => i.id === 'labor');
    const insertAt = afterLabor >= 0 ? afterLabor + 1 : items.length;
    items.splice(
      insertAt,
      0,
      { kind: 'workType', id: ONLINE_ITEM_ID },
      { kind: 'sort', id: HIGHEST_PAY_ITEM_ID }
    );
    items.push({ kind: 'distance', id: DISTANCE_ITEM_ID });
    return items;
  }, [categories]);

  // Viewer -> bounty miles: the server's distance when the radius search ran,
  // otherwise from the bounty's public approximate point. Only for a viewer
  // whose location is on; otherwise null and the card shows the neighborhood.
  const calculateDistance = useCallback(
    (bounty: Bounty) => bountyDistanceMiles(bounty, permission?.granted ? userLocation : null),
    [userLocation, permission]
  );

  const bountyDistances = useMemo(() => {
    const distances = new Map<string, number | null>();
    bounties.forEach(bounty => {
      distances.set(String(bounty.id), calculateDistance(bounty));
    });
    return distances;
  }, [bounties, calculateDistance]);

  // Whether each loaded bounty carries scope / where / when — the fields a
  // hunter needs to say yes. Listings missing any of them get a "Limited
  // details" badge on the card and are ranked below complete ones.
  const bountyCompleteness = useMemo(() => {
    const m = new Map<string, BountyCompleteness>();
    bounties.forEach(b => m.set(String(b.id), getBountyCompleteness(b)));
    return m;
  }, [bounties]);

  const filteredBounties = useMemo(() => {
    // Re-assert the lifecycle filter at render time as well as at fetch time:
    // this is the last gate before a row is drawn, so nothing that became
    // ineligible can reach the list regardless of how it got into state.
    let list = filterOpenFeedBounties(bounties);
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
    // Independent of category — the "Online" chip filters on work_type, the
    // field StepWhere.tsx writes, so it composes with any category selection.
    if (onlineOnly) {
      list = list.filter(b => (b as any).work_type === 'online');
    }
    // "Everything" and "For You" both show the full (category-unfiltered) set;
    // BountyGridFeed always features the highest-priced bounties within
    // whatever list it's given, so featured stays highest-priced even when a
    // specific category chip is active.
    list.sort((a, b) => {
      // Complete listings first — an incomplete one is something a hunter
      // can't act on, so it belongs below everything they can, regardless of
      // distance. Unknown (not yet evaluated) counts as complete so a row
      // never sinks just because its completeness map entry is missing.
      const aIncomplete = bountyCompleteness.get(String(a.id))?.isComplete === false;
      const bIncomplete = bountyCompleteness.get(String(b.id))?.isComplete === false;
      if (aIncomplete !== bIncomplete) return aIncomplete ? 1 : -1;

      // "Highest pay" is a sort toggle, not a filter — it reorders within
      // whatever category/online/distance selection is already active, with
      // distance left as the tiebreaker for equal amounts.
      if (sortByHighestPay) {
        const amtA = (a as any).amount;
        const amtB = (b as any).amount;
        if (amtA != null && amtB != null && amtA !== amtB) return amtB - amtA;
        if (amtA != null && amtB == null) return -1;
        if (amtA == null && amtB != null) return 1;
      }

      const distA = bountyDistances.get(String(a.id));
      const distB = bountyDistances.get(String(b.id));
      if (distA == null && distB == null) return 0;
      if (distA == null) return 1;
      if (distB == null) return -1;
      return (distA ?? Infinity) - (distB ?? Infinity);
    });
    return list;
  }, [
    bounties,
    activeCategory,
    onlineOnly,
    sortByHighestPay,
    bountyDistances,
    appliedBountyIds,
    bountyCompleteness,
  ]);

  // bounty-ranking-v2: only in play for the true default view. The instant a
  // hunter engages an explicit sort/filter chip (category, Online, Highest
  // pay, Distance), their intent overrides the experiment's default-order
  // formula — same principle "Highest pay" already applies over distance.
  // The default distance (local for a hunter with a location) is part of the
  // default view, not an engaged chip.
  const isDefaultUnfilteredView =
    activeCategory === 'all' && !onlineOnly && !sortByHighestPay && isDefaultDistance;

  const [rankingResult, setRankingResult] = useState<RankingResponse | null>(null);
  const rankingRequestKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const uid = validUserId ?? currentUserId;
    if (!isDefaultUnfilteredView || !uid || filteredBounties.length === 0) {
      setRankingResult(null);
      return;
    }
    const sortedIds = filteredBounties.map(b => String(b.id)).sort();
    const key = `${uid}|${sortedIds.join(',')}|${Array.from(appliedBountyIds).sort().join(',')}`;
    if (rankingRequestKeyRef.current === key) return;
    rankingRequestKeyRef.current = key;

    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke('bounty-ranking', {
          body: {
            bountyIds: filteredBounties.map(b => String(b.id)),
            appliedBountyIds: Array.from(appliedBountyIds),
          },
        });
        if (cancelled) return;
        if (error || !data) {
          setRankingResult({ variant: 'control' });
          return;
        }
        setRankingResult(data as RankingResponse);
      } catch (err) {
        if (cancelled) return;
        logger.warning('feed.ranking.request_failed', {
          error: err instanceof Error ? err.message : String(err),
        });
        setRankingResult({ variant: 'control' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isDefaultUnfilteredView, filteredBounties, appliedBountyIds, validUserId, currentUserId]);

  // Reorders filteredBounties into the server's main/dormant/honor sections
  // for the `test` arm; passes filteredBounties through untouched for
  // `control`, an unresolved/failed fetch, or a manually filtered view.
  const rankedFeedMeta = useMemo(() => {
    if (rankingResult?.variant !== 'test') {
      return {
        ordered: filteredBounties,
        variant: rankingResult?.variant,
        sectionById: new Map<string, 'dormant' | 'honor'>(),
        firstOfSection: new Set<string>(),
        rankScoreById: new Map<string, number>(),
      };
    }
    const { sections } = rankingResult;
    const byId = new Map(filteredBounties.map(b => [String(b.id), b] as const));
    const pick = (entries: RankedEntry[]) =>
      entries.map(e => byId.get(e.id)).filter((b): b is Bounty => Boolean(b));
    const sectionById = new Map<string, 'dormant' | 'honor'>();
    const firstOfSection = new Set<string>();
    const rankScoreById = new Map<string, number>();
    (['dormant', 'honor'] as const).forEach(key => {
      sections[key].forEach((e, i) => {
        sectionById.set(e.id, key);
        if (i === 0) firstOfSection.add(e.id);
      });
    });
    [...sections.main, ...sections.dormant, ...sections.honor].forEach(e => {
      rankScoreById.set(e.id, e.rank_score);
    });
    return {
      ordered: [...pick(sections.main), ...pick(sections.dormant), ...pick(sections.honor)],
      variant: 'test' as const,
      sectionById,
      firstOfSection,
      rankScoreById,
    };
  }, [filteredBounties, rankingResult]);

  // bounty_list_viewed — fires once the feed's actual result set for the
  // current filters is known (skeleton fully resolved), including the
  // results_count=0 case. Deliberately gated on isLoadingBounties/
  // applicationsLoaded rather than firing on the initial `bounties=[]`
  // render, and guarded by lastFiredKeyRef so unrelated re-renders that don't
  // change the visible list (e.g. a distance recompute) don't re-fire it.
  const listViewedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (isLoadingBounties || !applicationsLoaded) return;
    // The local default radius is still the home feed (radius_is_default
    // below says it was filtered); only a picked radius is 'nearby'.
    const source =
      distanceFilter !== 'off' && !isDefaultDistance
        ? 'nearby'
        : activeCategory !== 'all'
          ? 'category'
          : 'home_feed';
    const filtersApplied: string[] = [];
    if (activeCategory !== 'all') filtersApplied.push(`category:${activeCategory}`);
    if (distanceFilter !== 'off')
      filtersApplied.push(`radius:${distanceFilter == null ? 'anywhere' : distanceFilter}`);
    if (onlineOnly) filtersApplied.push('work_type:online');
    if (sortByHighestPay) filtersApplied.push('sort:amount_desc');
    const key = `${source}|${filteredBounties.length}|${filtersApplied.join(',')}`;
    if (listViewedKeyRef.current === key) return;
    listViewedKeyRef.current = key;
    analyticsService.trackEvent('bounty_list_viewed', {
      results_count: filteredBounties.length,
      source,
      filters_applied: filtersApplied,
      radius_miles: typeof distanceFilter === 'number' ? distanceFilter : undefined,
      // SBA-02: the radius came from the local default, not a chip pick.
      radius_is_default: distanceFilter !== DISTANCE_OFF && isDefaultDistance,
      has_feed_location: hasFeedLocation,
      has_location_permission: Boolean(permission?.granted),
      sort_order: sortByHighestPay ? 'amount_desc' : distanceFilter !== 'off' ? 'distance' : 'recent',
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
    isDefaultDistance,
    hasFeedLocation,
    onlineOnly,
    sortByHighestPay,
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

  // Non-fatal, like loadUserApplications: on failure the banner keeps its
  // last-known value rather than flickering away on a flaky network. Both
  // lookups below opt into throwOnError because the services otherwise resolve
  // failures as "nothing found", which would clear or demote the cards.
  const loadMyActiveBounties = useCallback(async () => {
    const uid = validUserId ?? currentUserId;
    if (!uid) {
      setMyActiveBounties([]);
      return;
    }
    let rows: Bounty[] = [];
    try {
      // Every live bounty, not a newest-first slice: the cards are ordered by
      // stage then age, so a cap here could drop an older "Needs review" one.
      for (let page = 0; page < MY_ACTIVE_BOUNTIES_MAX_PAGES; page++) {
        const batch = await withTimeout(
          bountyService.getAll({
            userId: uid,
            statuses: ['open', 'in_progress'],
            limit: MY_ACTIVE_BOUNTIES_PAGE_SIZE,
            offset: page * MY_ACTIVE_BOUNTIES_PAGE_SIZE,
            throwOnError: true,
          }),
          API_TIMEOUTS.DEFAULT
        );
        rows = rows.concat(batch);
        if (batch.length < MY_ACTIVE_BOUNTIES_PAGE_SIZE) break;
      }
    } catch (error) {
      logger.warning('feed.my_active_bounties.request_failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    // An open bounty past its deadline can't be taken by anyone, so it isn't
    // "live" progress worth a card. Statuses are checked explicitly rather than
    // trusted from the query.
    const live = rows.filter(
      b => b.status === 'in_progress' || (b.status === 'open' && !isBountyDeadlinePassed(b))
    );
    const inProgressIds = live.filter(b => b.status === 'in_progress').map(b => String(b.id));

    // null = the lookup failed; those bounties keep whatever stage they had.
    let latestSubmissions: Map<string, { status?: string }> | null = new Map();
    if (inProgressIds.length > 0) {
      try {
        latestSubmissions = await withTimeout(
          completionService.getLatestSubmissionsForBounties(inProgressIds, { throwOnError: true }),
          API_TIMEOUTS.DEFAULT
        );
      } catch (error) {
        latestSubmissions = null;
        logger.warning('feed.my_active_bounties.submissions_failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    setMyActiveBounties(prev => {
      const priorStages = new Map(prev.map(item => [String(item.bounty.id), item.stage]));
      const items = live.map((bounty): MyBountyProgressItem => {
        if (bounty.status === 'open') return { bounty, stage: 'open' };
        const id = String(bounty.id);
        const isReview = latestSubmissions
          ? latestSubmissions.get(id)?.status === 'pending'
          : priorStages.get(id) === 'review';
        return { bounty, stage: isReview ? 'review' : 'in_progress' };
      });
      return sortByProgress(items);
    });
  }, [validUserId, currentUserId]);

  // The realtime handler below is bound once per mount, so it reads the
  // latest loader through a ref instead of re-subscribing when the user changes.
  const loadMyActiveBountiesRef = useRef(loadMyActiveBounties);
  loadMyActiveBountiesRef.current = loadMyActiveBounties;
  const validUserIdRef = useRef(validUserId ?? currentUserId);
  validUserIdRef.current = validUserId ?? currentUserId;
  const distanceFilterRef = useRef(distanceFilter);
  distanceFilterRef.current = distanceFilter;
  const includeTestBountiesRef = useRef(includeTestBounties);
  includeTestBountiesRef.current = includeTestBounties;
  // Bounties already added live, so each shifts the page offset exactly once
  // even if React replays the state updater that adds it.
  const liveInsertedIdsRef = useRef(new Set<string>());

  // The filter carousel is ONE selection group: at most a single chip can read
  // as active at a time. Category, Online, Highest pay and Distance used to be
  // independent pieces of state, so "For You" (the neutral category) stayed lit
  // while Online or Highest pay was also lit. Every chip now routes its
  // activation through here, which clears the other three lanes. All four
  // lanes update in the same synchronous batch so two chips never read as
  // active at once; only the network count query is debounced (countCategory).
  //
  // Leaving out `distance` returns it to the default rather than to "Any
  // distance": for a hunter with a location the 25 mi radius is the baseline
  // the other chips narrow, not a chip of its own (SBA-02).
  const selectOnlyFilter = useCallback(
    (next: {
      category?: string | 'all';
      onlineOnly?: boolean;
      sortByHighestPay?: boolean;
      distance?: DistanceFilterValue;
    }) => {
      setActiveCategory(next.category ?? 'all');
      setOnlineOnly(next.onlineOnly ?? false);
      setSortByHighestPay(next.sortByHighestPay ?? false);
      setDistanceOverride(next.distance);
    },
    []
  );

  // A pick from the Distance sheet. "Any distance" is remembered and turns the
  // local default off; any radius clears that. A pick equal to the resulting
  // default is stored as "no override", so For You reads as active again.
  const pickDistance = useCallback(
    (value: DistanceFilterValue) => {
      const pick = applyDistancePick({ value, hasLocation: hasFeedLocation });
      setDistancePreference(pick.preference);
      void (async () => {
        try {
          await storage.setItem(DISTANCE_PREFERENCE_KEY, pick.preference);
        } catch {}
      })();
      selectOnlyFilter({ distance: pick.override });
    },
    [hasFeedLocation, selectOnlyFilter]
  );

  // "For You" is the default state (which includes the local radius for a
  // hunter with a location), so it's only active when no chip is engaged.
  const isForYouActive =
    activeCategory === 'all' && !onlineOnly && !sortByHighestPay && isDefaultDistance;

  // The grid list is shifted up by (insets.top + 8) and its content starts with
  // 8px of padding, so at scroll offset 0 the banner's top edge lands exactly at
  // the top of the display. It therefore still spans the status-bar strip while
  // y <= bannerHeight - insets.top. Past that the green would be a floating
  // stripe over ordinary cards, so the strip returns to the theme background.
  const handleGridScroll = useMemo(
    () =>
      Animated.event([{ nativeEvent: { contentOffset: { y: gridScrollY } } }], {
        // The overlay's translateY reads this value; the JS driver is what lets
        // a plain (non-Animated) FlatList feed it.
        useNativeDriver: false,
        listener: (e: NativeSyntheticEvent<NativeScrollEvent>) => {
          const y = e.nativeEvent.contentOffset.y;
          const covers = gridBannerHeight === 0 || y <= gridBannerHeight - insets.top;
          setGridBannerCoversStatusBar(prev => (prev === covers ? prev : covers));
        },
      }),
    [gridScrollY, gridBannerHeight, insets.top]
  );

  const setTopInsetOverlay = topInsetOverlay?.setOverlay;
  // The overlay is painted by RootFrame above every route, so it must come
  // down whenever the tab shell isn't the focused screen — otherwise a screen
  // pushed from the grid feed (Search, a bounty detail) inherits the banner's
  // green strip above its own header instead of its own background.
  const isShellFocused = useIsFocused();
  // Inside the tab shell's pager the strip slides with the feed's page on the
  // UI thread, so it stays up while the feed is merely mounted beside the
  // current tab — it is off-screen then. Gating it on activeScreen instead
  // left the green behind after swiping away (and late arriving back),
  // because activeScreen only commits once the swipe settles.
  const tabPager = useTabPager();
  const overlayTranslateX = useMemo(() => pageTranslateX(tabPager, 'bounty'), [tabPager]);
  useEffect(() => {
    const tinted =
      bountyFormat === 'grid' &&
      (overlayTranslateX !== undefined || activeScreen === 'bounty') &&
      isShellFocused &&
      gridBannerCoversStatusBar;
    if (!tinted || !setTopInsetOverlay) return;
    setTopInsetOverlay({
      colors: gridBannerGradient,
      start: GRID_BANNER_GRADIENT_START,
      end: GRID_BANNER_GRADIENT_END,
      // The strip is the top `insets.top` of a gradient this tall — the same
      // slice the banner's own gradient draws and the inset then hides.
      height: gridBannerHeight || insets.top,
      scrollY: gridScrollY,
      translateX: overlayTranslateX,
      barColor: theme.primary,
    }, 'bounty');
    return () => setTopInsetOverlay(null, 'bounty');
  }, [
    bountyFormat,
    activeScreen,
    overlayTranslateX,
    isShellFocused,
    gridBannerCoversStatusBar,
    gridBannerHeight,
    insets.top,
    gridScrollY,
    setTopInsetOverlay,
    gridBannerGradient,
    theme.primary,
  ]);

  const loadBounties = useCallback(
    async ({ reset = false, keepLoaded = false }: { reset?: boolean; keepLoaded?: boolean } = {}) => {
      if (reset) {
        setIsLoadingBounties(true);
        setLoadError(null);
      } else {
        setLoadingMore(true);
      }
      const pageOffset = reset ? 0 : offsetRef.current;
      // A reload in place re-reads everything already loaded rather than just
      // page one. Cutting the list back to one page clamped anyone scrolled
      // past it to the end of that page — on every resume from background,
      // even with a bounty open over the feed.
      const limit =
        reset && keepLoaded
          ? Math.min(MAX_RELOAD_ROWS, Math.max(PAGE_SIZE, offsetRef.current))
          : PAGE_SIZE;
      const startedAt = Date.now();
      logger.info('feed.bounties.request_started', {
        reset,
        offset: pageOffset,
        pageSize: limit,
      });
      try {
        const fetchedBounties =
          distanceFilter !== 'off'
            ? await withTimeout(
                searchBountiesNearby({
                  latitude: searchCoords?.latitude,
                  longitude: searchCoords?.longitude,
                  radiusMiles: distanceFilter,
                  limit,
                  offset: pageOffset,
                  includeTest: includeTestBounties,
                  // A radius limits in-person work only (SBA-02).
                  includeOnline: includeOnlineFor(distanceFilter),
                }).then(rows => rows.map(nearbyToBounty)),
                API_TIMEOUTS.DEFAULT
              )
            : await withTimeout(
                // throwOnError: getAll otherwise resolves a failed fetch as
                // `[]`, which renders "no bounties" instead of the retryable
                // load-error state below.
                bountyService.getAll({
                  status: 'open',
                  limit,
                  offset: pageOffset,
                  includeTest: includeTestBounties,
                  throwOnError: true,
                }),
                API_TIMEOUTS.DEFAULT
              );
        const pageRows = Array.isArray(fetchedBounties) ? fetchedBounties : [];
        // Lifecycle filtering is re-applied to EVERY result set, not just
        // trusted from the query: a bounty completed/removed while this fetch
        // was in flight (or served from a cache/replica) would otherwise be
        // merged straight back into the list. `existing` is filtered too, so a
        // row that became ineligible while it sat in state cannot survive a
        // pagination merge either.
        const safeBounties = filterOpenFeedBounties(pageRows);
        const mergeUniqueById = (existing: Bounty[], incoming: Bounty[]) => {
          const map = new Map<string, Bounty>();
          filterOpenFeedBounties(existing.concat(incoming)).forEach(b => {
            map.set(String(b.id), b);
          });
          return Array.from(map.values());
        };
        if (reset) {
          setBounties(mergeUniqueById([], safeBounties));
        } else {
          setBounties(prev => mergeUniqueById(prev, safeBounties));
        }
        // Pagination bookkeeping tracks the rows the SERVER returned, not the
        // rows that survived filtering: advancing the offset by the filtered
        // count would re-request rows already consumed, and a page that filters
        // down to fewer than PAGE_SIZE items does not mean the list ended.
        offsetRef.current = pageOffset + pageRows.length;
        setHasMore(pageRows.length === limit);
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
    [distanceFilter, searchCoords, includeTestBounties]
  );

  // Set once the first load has started (the effect after loadUserApplications,
  // further down, gated on feedFiltersReady).
  const initialLoadStartedRef = useRef(false);

  // Distance filter changes what's fetched from the server (unlike category,
  // which filters client-side over the already-loaded page), so it needs a
  // fresh reset load rather than just re-filtering `bounties` in place. Skips
  // until the initial load has started: that load already reads the current
  // value, including the default resolving from "Any distance" to local.
  useEffect(() => {
    if (!initialLoadStartedRef.current) return;
    offsetRef.current = 0;
    setHasMore(true);
    loadBounties({ reset: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [distanceFilter]);

  // Same reset-and-reload treatment for the internal "show test bounties"
  // toggle — it changes what the server returns, not something client-side
  // filtering can retrofit onto an already-loaded page. Skips its first run
  // for the same reason as the distance-filter effect above (the initial
  // mount load already reads the current value).
  const isFirstIncludeTestRun = useRef(true);
  useEffect(() => {
    if (isFirstIncludeTestRun.current) {
      isFirstIncludeTestRun.current = false;
      return;
    }
    offsetRef.current = 0;
    setHasMore(true);
    loadBounties({ reset: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [includeTestBounties]);

  // Server-side total of open bounties for the active category. Cheap
  // (head/count query, no rows) and independent of pagination, so the "N active"
  // badge stays stable while the user scrolls. Refreshes on mount + category
  // change (via the effect below) and on pull-to-refresh. Keyed on a debounced
  // copy of the category so rapid chip taps don't fire a query per tap.
  const [countCategory, setCountCategory] = useState<string | 'all'>(activeCategory);
  useEffect(() => {
    const t = setTimeout(() => setCountCategory(activeCategory), 250);
    return () => clearTimeout(t);
  }, [activeCategory]);

  const refreshActiveCount = useCallback(async () => {
    setActiveCount(null);
    const c = await bountyService.getOpenCount({ category: countCategory, includeTest: includeTestBounties });
    setActiveCount(c);
  }, [countCategory, includeTestBounties]);

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
        loadMyActiveBounties(),
      ]);
    } catch (error) {
      console.error('Error refreshing bounties:', error);
    } finally {
      setRefreshing(false);
    }
  }, [loadBounties, loadUserApplications, refreshActiveCount, loadMyActiveBounties]);

  // The tab shell stays mounted under anything opened over it (the root is a
  // stack), so coming back from a bounty you just applied to — or one of your
  // own — must refresh what otherwise only loads on mount: your applications
  // (applied bounties drop out of the feed), your active bounties and the
  // open count. The loaded rows stay live through realtime; keeping them
  // rather than reloading page one is what preserves the scroll position.
  // Silent: nothing flips back to a skeleton or a blank count.
  // Only when the feed is the tab in view — a Back from something opened on
  // another tab shouldn't refetch an off-screen feed; switching back to it
  // reloads the same two lists (the activeScreen effect further down).
  useRefreshOnReturn(() => {
    if (activeScreen !== 'bounty') return;
    loadUserApplications().catch(err => console.error('Failed to refresh user applications:', err));
    loadMyActiveBounties().catch(err => console.error('Failed to refresh active bounties:', err));
    bountyService
      .getOpenCount({ category: countCategory, includeTest: includeTestBounties })
      .then(setActiveCount)
      .catch(err => console.error('Failed to refresh active count:', err));
  });

  // Per-mount id that makes the realtime topic unique to this instance.
  // supabase-js returns the same channel object for a topic that already exists
  // on the client, and removeChannel() on unmount is async. So a fixed topic can
  // hand a brief double mount an already-subscribed channel, and adding a
  // postgres_changes handler after subscribe() then throws. A unique topic gives
  // each mount its own channel, like the per-user/row topics the wallet and
  // inbox channels already use.
  //
  // useId() alone isn't enough: it's deterministic per tree position, so a
  // remount at the same spot (e.g. a brief double-mount while the previous
  // instance's removeChannel() is still in flight) can produce the same id
  // and reintroduce the exact collision this is guarding against. The
  // mount-counter suffix, captured once via useState's lazy initializer,
  // guarantees distinct topics across successive mounts regardless of tree
  // position or timing.
  const reactId = useId();
  const [instanceId] = useState(
    () => `${reactId.replace(/[^a-zA-Z0-9]/g, '')}-${++bountyFeedMountCounter}`
  );

  // Realtime: patch/remove already-loaded bounties in place, and render new
  // open bounties live the moment they're posted — complete or not; an
  // incomplete one gets the usual "Limited details" badge and ranking.
  useEffect(() => {
    const channel = supabase
      .channel(`bounty-feed:bounties:${instanceId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'bounties', filter: 'status=eq.open' },
        payload => {
          const inserted = payload.new as Bounty;
          const uid = validUserIdRef.current;
          if (uid && (inserted.poster_id === uid || inserted.user_id === uid)) {
            loadMyActiveBountiesRef.current();
          }
          // Same test-bounty rule the feed query applies server-side.
          if (inserted.is_test && !includeTestBountiesRef.current) return;
          // The nearby search is radius-bound and the payload carries no
          // distance, so under a distance filter fall back to the pill.
          if (distanceFilterRef.current !== DISTANCE_OFF) {
            setNewBountiesCount(prev => prev + 1);
            return;
          }
          // Re-read rather than render the payload: it has no poster profile
          // (username/avatar), which getById attaches exactly as the feed
          // query does.
          bountyService
            .getById(inserted.id)
            .then(fresh => {
              if (!fresh || filterOpenFeedBounties([fresh]).length === 0) return;
              if (fresh.is_test && !includeTestBountiesRef.current) return;
              setBounties(prev => {
                const id = String(fresh.id);
                if (prev.some(b => String(b.id) === id)) return prev;
                // The feed pages by created_at desc, so a new row sits at server
                // offset 0 and pushes every loaded row down by one. Advance the
                // offset to match, or the next page would repeat a row.
                if (!liveInsertedIdsRef.current.has(id)) {
                  liveInsertedIdsRef.current.add(id);
                  offsetRef.current += 1;
                }
                return [fresh, ...prev];
              });
            })
            .catch(() => setNewBountiesCount(prev => prev + 1));
        }
      )
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'bounties' }, payload => {
        const updated = payload.new as Bounty;
        // One of the viewer's own bounties changed — it may have just been
        // accepted (card advances) or completed/cancelled (card goes away).
        const uid = validUserIdRef.current;
        if (uid && (updated.poster_id === uid || updated.user_id === uid)) {
          loadMyActiveBountiesRef.current();
        }
        // A bounty that's no longer open (accepted/completed/cancelled/removed)
        // should drop out of the open-bounties feed rather than linger with a
        // stale status — and must stay out even if an in-flight or cached
        // query returns its old row moments later, hence the registry mark.
        if (isBountyVisibleInOpenFeed(updated)) {
          // Reopened (e.g. an acceptance was withdrawn): the backend says it is
          // eligible again, so lift any earlier local suppression.
          clearBountyRemovedLocally(updated.id, ['feed']);
        } else {
          markBountyRemovedLocally(updated.id, ['feed']);
        }
        setBounties(prev => {
          const exists = prev.some(b => String(b.id) === String(updated.id));
          if (!exists) return prev;
          if (!isBountyVisibleInOpenFeed(updated)) {
            return prev.filter(b => String(b.id) !== String(updated.id));
          }
          return prev.map(b => (String(b.id) === String(updated.id) ? { ...b, ...updated } : b));
        });
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'bounties' }, payload => {
        const deletedId = (payload.old as Partial<Bounty>)?.id;
        if (deletedId == null) return;
        markBountyRemovedLocally(deletedId);  // gone for good, every list
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
  }, [instanceId]);

  // A hunter submitting work (or the poster sending it back) moves a card
  // between "In progress" and "Needs review" without touching the bounty row,
  // so the bounties channel above never sees it. One feed-owned channel over
  // every working bounty's submissions — not completionService.subscribeSubmission
  // per bounty, whose fixed per-bounty topic My Postings also subscribes to
  // while this feed stays mounted.
  const workingBountyIdsKey = myActiveBounties
    .filter(i => i.stage !== 'open')
    .map(i => String(i.bounty.id))
    .sort()
    .join(',');
  useEffect(() => {
    if (!workingBountyIdsKey) return;
    const channel = supabase
      .channel(`bounty-feed:my-submissions:${instanceId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'completion_submissions',
          filter: `bounty_id=in.(${workingBountyIdsKey})`,
        },
        () => {
          loadMyActiveBountiesRef.current();
        }
      )
      .subscribe();
    return () => {
      try {
        supabase.removeChannel(channel);
      } catch {
        // best-effort cleanup
      }
    };
  }, [instanceId, workingBountyIdsKey]);

  useImperativeHandle(
    ref,
    () => ({
      // After posting or accepting: fresh rows, same scroll position.
      refresh: () => {
        setHasMore(true);
        loadBounties({ reset: true, keepLoaded: true });
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
  // First load, once the default distance is known (useFeedLocation's `ready`
  // always turns true within FEED_LOCATION_FIX_WAIT_MS). The skeleton shows
  // until then: isLoadingBounties starts true.
  useEffect(() => {
    if (!feedFiltersReady || initialLoadStartedRef.current) return;
    initialLoadStartedRef.current = true;
    loadBounties({ reset: true });
  }, [feedFiltersReady, loadBounties]);
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
      loadMyActiveBounties();
    }
  }, [activeScreen, loadUserApplications, loadMyActiveBounties]);

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
      setHasMore(true);
      loadBounties({ reset: true, keepLoaded: true });
      loadUserApplications().catch(err => {
        logger.warning('feed.foreground.applications_refresh_failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
      loadMyActiveBounties();
    }, [activeScreen, loadBounties, loadUserApplications, loadMyActiveBounties])
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
        const saved = await storage.getItem(DISTANCE_PREFERENCE_KEY);
        setDistancePreference(parseDistancePreference(saved));
      } catch {
      } finally {
        setDistancePreferenceLoaded(true);
      }
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
    ({ item, index }: { item: Bounty; index: number }) => {
      const distance =
        bountyDistances.get(String(item.id)) ?? calculateDistance(item);
      const completeness = bountyCompleteness.get(String(item.id));
      const incomplete = completeness?.isComplete === false;
      const idStr = String(item.id);
      const sectionLabel = rankedFeedMeta.firstOfSection.has(idStr)
        ? rankedFeedMeta.sectionById.get(idStr)
        : undefined;
      const props = {
        id: item.id,
        title: item.title,
        username: item.username,
        price: Number(item.amount),
        distance,
        // Neighborhood/city only (lib/utils/public-location). The server already
        // stores just a label in `location`; this also covers cached rows.
        location: formatPublicLocation(item) ?? undefined,
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
        incomplete,
        missingSummary: incomplete ? summarizeMissingDetails(completeness!.missing) : '',
        category: item.category,
        createdAt: item.created_at,
        position: index,
        rankingVariant: rankedFeedMeta.variant,
        rankScore: rankedFeedMeta.rankScoreById.get(idStr),
        sectionLabel,
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
    [bountyDistances, calculateDistance, listHeight, isCompact, bountyCompleteness, rankedFeedMeta]
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
    // Distance and Online now live in the same row as the categories, so an
    // empty result caused by any combination of them gets the same one-tap
    // escape hatch. Highest pay is excluded — it's a sort, never a cause of
    // zero results.
    const hasCategoryFilter = Boolean(activeCategory) && activeCategory !== 'all';
    const hasDistanceFilter = distanceFilter !== DISTANCE_OFF;
    const hasOnlineFilter = onlineOnly;
    // Nothing nearby and no online work either, in the default view: the only
    // way out is a wider search, which counts as picking "Any distance".
    if (hasDistanceFilter && isDefaultDistance && !hasCategoryFilter && !hasOnlineFilter) {
      return (
        <View style={{ width: '100%', alignItems: 'center' }}>
          <Text style={{ color: theme.textSecondary, marginBottom: 8, textAlign: 'center' }}>
            No bounties within {LOCAL_DEFAULT_RADIUS_MILES} miles of you right now.
          </Text>
          <TouchableOpacity
            onPress={() => pickDistance(DISTANCE_OFF)}
            accessibilityRole="button"
            accessibilityLabel="Show bounties at any distance"
            style={{
              backgroundColor: theme.surfaceSecondary,
              paddingHorizontal: 16,
              paddingVertical: 10,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: theme.border,
            }}
          >
            <Text style={{ color: theme.text, fontWeight: '700' }}>Show any distance</Text>
          </TouchableOpacity>
        </View>
      );
    }
    const activeFilterCount = [hasCategoryFilter, hasDistanceFilter, hasOnlineFilter].filter(
      Boolean
    ).length;
    if (activeFilterCount > 0) {
      const clearsMultiple = activeFilterCount > 1;
      return (
        <View style={{ width: '100%', alignItems: 'center' }}>
          <Text style={{ color: theme.textSecondary, marginBottom: 8 }}>
            No bounties match {clearsMultiple ? 'these filters' : 'this filter'}.
          </Text>
          <TouchableOpacity
            // Back to For You. When only an explicit radius was set, For You
            // could be the default radius again, so widen to "Any distance" for
            // now (not remembered: only a pick from the sheet is).
            onPress={() =>
              hasDistanceFilter && !hasCategoryFilter && !hasOnlineFilter
                ? selectOnlyFilter({
                    distance: defaultDistance === DISTANCE_OFF ? undefined : DISTANCE_OFF,
                  })
                : selectOnlyFilter({})
            }
            accessibilityRole="button"
            accessibilityLabel={clearsMultiple ? 'Clear filters' : 'Clear filter'}
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
              {clearsMultiple ? 'Clear filters' : 'Clear filter'}
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
        // Switch to the Post tab rather than pushing the composer as its own
        // route: that route mounts CreateBountyFlow with no onCancel/onComplete,
        // so neither exiting nor finishing after publish could leave it.
        onAction={() => setActiveScreen('postings')}
      />
    );
  }, [
    isLoadingBounties,
    applicationsLoaded,
    loadError,
    loadBounties,
    activeCategory,
    distanceFilter,
    isDefaultDistance,
    defaultDistance,
    onlineOnly,
    selectOnlyFilter,
    pickDistance,
    theme,
    setActiveScreen,
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
  // `filterItems` source: category chips alongside the Online, Highest pay and
  // Distance chips, scrolling together as one list.
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
                // The default is the baseline For You stands for, so it reads as
                // "off" here — but still names the radius when it's local.
                neutralValue={isDefaultDistance ? distanceFilter : undefined}
                neutralLabel={
                  isDefaultDistance && distanceFilter !== DISTANCE_OFF
                    ? `${LOCAL_DEFAULT_RADIUS_MILES} mi`
                    : undefined
                }
                options={DISTANCE_OPTIONS}
                onChange={pickDistance}
                description="In-person bounties within a radius of you. Online bounties are always shown."
                hint={
                  hasFeedLocation
                    ? undefined
                    : 'Location access is off, so distance filters may not match what’s actually near you.'
                }
                testID="feed-distance-filter"
              />
            );
          }
          if (item.kind === 'workType') {
            return (
              <FilterChip
                key={item.id}
                label="Online"
                icon="language"
                active={onlineOnly}
                onPress={() => selectOnlyFilter({ onlineOnly: !onlineOnly })}
                accessibilityLabel={`Filter by Online${onlineOnly ? ', currently active' : ''}`}
                accessibilityHint={
                  onlineOnly
                    ? 'Tap to remove filter and show in-person bounties too'
                    : 'Tap to show only bounties that can be done online'
                }
                testID="feed-online-filter"
              />
            );
          }
          if (item.kind === 'sort') {
            return (
              <FilterChip
                key={item.id}
                label="Highest pay"
                icon="attach-money"
                active={sortByHighestPay}
                onPress={() => selectOnlyFilter({ sortByHighestPay: !sortByHighestPay })}
                accessibilityLabel={`Sort by highest pay${sortByHighestPay ? ', currently active' : ''}`}
                accessibilityHint={
                  sortByHighestPay
                    ? 'Tap to return to the default sort order'
                    : 'Tap to sort bounties by highest pay first'
                }
                testID="feed-highest-pay-sort"
              />
            );
          }
          const isActive = item.id === 'all' ? isForYouActive : activeCategory === item.id;
          return (
            <FilterChip
              key={item.id}
              label={item.label}
              icon={item.icon}
              active={isActive}
              onPress={() => selectOnlyFilter({ category: isActive ? 'all' : (item.id as any) })}
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

          SearchBarRow owns the geometry because /tabs/search draws this same
          row: tapping the field replaces the feed below it with results, and
          the bar itself must not move or resize on the way there.

          The pill shares this row rather than owning a line beneath it so the
          "people are here right now" signal sits in the header chrome the eye
          already lands on, and costs no vertical space above the cards.

          Hidden below MIN_ACTIVE_HUNTERS_TO_SHOW as well as at null: the hook
          returns null whenever the number isn't known (permission off, no fix
          yet, RPC failed), and a near-empty count is worse than silence for
          someone deciding whether to post. */}
      {bountyFormat !== 'grid' && (
        <SearchBarRow
          accessibilityLabel="Open search"
          onPress={() =>
            router.push({
              pathname: '/tabs/search',
              // Hand the search screen the count this feed already fetched, so
              // it can draw the identical pill without re-running the location
              // query — and so the field it inherits is exactly this width.
              params: showActiveHunters
                ? { hunters: String(activeHuntersCount), radius: String(activeHuntersRadius) }
                : {},
            })
          }
          middle={
            showActiveHunters ? (
              <ActiveHuntersPill
                count={activeHuntersCount as number}
                radiusMiles={activeHuntersRadius}
                testID="feed-active-hunters-caption"
              />
            ) : null
          }
          trailing={<NotificationBell />}
        >
          {/* Placeholder shortens when the pill is present so the three items
              fit on one line without the search label truncating mid-word. */}
          <Text
            style={s.searchText}
            numberOfLines={1}
            maxFontSizeMultiplier={SEARCH_FIELD_MAX_FONT_SCALE}
          >
            {showActiveHunters ? 'Search bounties...' : 'Search bounties or users...'}
          </Text>
        </SearchBarRow>
      )}

      {/* Filter row — outside FlatList for non-grid; grid gets it inside listHeader */}
      {bountyFormat !== 'grid' && renderFilterBar()}

      {/* New-bounties pill — the fallback for realtime INSERTs that couldn't be
          rendered live (distance filter active, or the fetch failed). Sits
          above the list so it works across all three feed layouts. */}
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
            onScroll={handleGridScroll}
            listHeader={
              <View>
                {/* Banner */}
                <View
                  style={[
                    s.gridBanner,
                    {
                      // The minimized progress tab hangs from the top edge,
                      // right where the title starts; push the title below it.
                      paddingTop:
                        insets.top +
                        2 +
                        (progressTabVisible && myActiveBounties.length > 0
                          ? LARGE_TAB_HEIGHT + SPACING.COMPACT_GAP
                          : 0),
                    },
                  ]}
                  onLayout={e => setGridBannerHeight(e.nativeEvent.layout.height)}
                >
                  <LinearGradient
                    colors={gridBannerGradient}
                    start={GRID_BANNER_GRADIENT_START}
                    end={GRID_BANNER_GRADIENT_END}
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
                        count isn't known or is below MIN_ACTIVE_HUNTERS_TO_SHOW
                        — same rule as the pill in the other layouts, so a quiet
                        area reads as ordinary copy rather than a broken stat. */}
                    {showActiveHunters ? (
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
            data={rankedFeedMeta.ordered}
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

      {/* Your bounties' progress — every layout (card, compact, grid). Floats
          over the top of the feed (last child, so it layers above everything,
          the grid's green banner and the fade included)
          and can be swiped up out of the way, leaving a small tab. One card
          per live bounty, paged sideways; tapping opens the poster's command
          center for it. */}
      {myActiveBounties.length > 0 && (
        <MyBountyProgressCarousel
          items={myActiveBounties}
          // Grid only: the minimized tab hangs over the green banner, so it
          // drops its frosted background to blend in and is drawn larger so it
          // still stands out. White reads on the
          // green; once the banner scrolls away, fall back to the text color.
          transparentTab={bountyFormat === 'grid'}
          largeTab={bountyFormat === 'grid'}
          onTabVisibleChange={setProgressTabVisible}
          tabContentColor={gridBannerCoversStatusBar ? '#ffffff' : theme.text}
          onPressItem={bounty =>
            router.push({
              pathname: '/postings/[bountyId]',
              params: { bountyId: String(bounty.id) },
            } as never)
          }
        />
      )}
    </View>
  );
});

/**
 * The feed's cards open their detail popup in this host instead of inside
 * their own row, so it stays open when the row leaves the feed under it —
 * see components/bounty-detail-host.tsx.
 */
export const BountyFeed = forwardRef<BountyFeedHandle, BountyFeedProps>(function BountyFeed(props, ref) {
  return (
    <BountyDetailHost>
      <BountyFeedContent ref={ref} {...props} />
    </BountyDetailHost>
  );
});

function makeStyles(t: AppTheme) {
  return StyleSheet.create({
    dashboardArea: {
      flex: 1,
      backgroundColor: t.background,
    },
    // Grid banner only — the shared SearchBarRow draws its own leading icon.
    searchIcon: { marginRight: SPACING.COMPACT_GAP },
    // Placeholder label inside the shared field. Takes its type scale from
    // SearchBarRow so it matches the real input on the search screen.
    searchText: {
      ...SEARCH_FIELD_TEXT,
      color: t.textDisabled,
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
