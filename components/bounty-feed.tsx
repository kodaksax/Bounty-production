import { MaterialIcons } from '@expo/vector-icons'
import { useLocation } from 'app/hooks/useLocation'
import { BountyCompactItem } from 'components/bounty-compact-item'
import { BountyGridFeed } from 'components/bounty-grid-feed'
import { BountyListItem } from 'components/bounty-list-item'
import { NotificationsBell } from 'components/notifications-bell'
import { BrandingLogo } from 'components/ui/branding-logo'
import { EmptyState } from 'components/ui/empty-state'
import { PostingsListSkeleton } from 'components/ui/skeleton-loaders'
import { WalletBalanceButton } from 'components/ui/wallet-balance-button'
import { LinearGradient } from 'expo-linear-gradient'
import { useRouter } from 'expo-router'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { Alert, Animated, Dimensions, FlatList, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useValidUserId } from '../hooks/useValidUserId'
import { HEADER_LAYOUT, SIZING, SPACING, TYPOGRAPHY } from '../lib/constants/accessibility'
import { useBountyFormat } from '../lib/bounty-format-context'
import { useAppThemeContext } from '../lib/themes/AppThemeContext'
import type { AppTheme } from '../lib/themes/types'
import { bountyRequestService } from '../lib/services/bounty-request-service'
import { bountyService } from '../lib/services/bounty-service'
import type { Bounty } from '../lib/services/database.types'
import { locationService } from '../lib/services/location-service'
import { searchService } from '../lib/services/search-service'
import { storage } from '../lib/storage'
import type { TrendingBounty } from '../lib/types'

export type BountyFeedHandle = {
  refresh: () => void
  handleTabRepress: () => void
}

interface BountyFeedProps {
  activeScreen: string
  setActiveScreen: (screen: string) => void
  currentUserId?: string
}

const PAGE_SIZE = 10

export const BountyFeed = forwardRef<BountyFeedHandle, BountyFeedProps>(function BountyFeed(
  { activeScreen, setActiveScreen, currentUserId },
  ref
) {
  const router = useRouter()
  const [listHeight, setListHeight] = useState(0)  // ← measured height
  const [bounties, setBounties] = useState<Bounty[]>([])
  const [isLoadingBounties, setIsLoadingBounties] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [appliedBountyIds, setAppliedBountyIds] = useState<Set<string>>(new Set())
  const [applicationsLoaded, setApplicationsLoaded] = useState(false)
  const [loadError, setLoadError] = useState<Error | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [trendingBounties, setTrendingBounties] = useState<TrendingBounty[]>([])
  const [isLoadingTrending, setIsLoadingTrending] = useState(true)
  const [activeCategory, setActiveCategory] = useState<string | 'all'>('all')
  const [distanceFilter, setDistanceFilter] = useState<number | null>(null)
  const [distanceDropdownOpen, setDistanceDropdownOpen] = useState(false)
  const [distanceChipLayout, setDistanceChipLayout] = useState<{ x: number; y: number; width: number; height: number } | null>(null)

  const { theme } = useAppThemeContext()
  const { bountyFormat } = useBountyFormat()
  const isCompact = bountyFormat === 'compact'
  const s = useMemo(() => makeStyles(theme), [theme])

  const scrollY = useRef(new Animated.Value(0)).current
  const bountyListRef = useRef<FlatList>(null)
  const offsetRef = useRef(0)
  const distanceChipRef = useRef<any>(null)

  const { location: userLocation, permission } = useLocation()
  const validUserId = useValidUserId()

  const HEADER_EXPANDED = HEADER_LAYOUT.expandedHeight
  const HEADER_COLLAPSED = HEADER_LAYOUT.collapsedHeight
  const headerTopPad = 0
  const headerHeight = scrollY.interpolate({
    inputRange: [0, HEADER_EXPANDED - HEADER_COLLAPSED],
    outputRange: [HEADER_EXPANDED + headerTopPad, HEADER_COLLAPSED + headerTopPad],
    extrapolate: 'clamp',
  })
  const extraContentOpacity = scrollY.interpolate({
    inputRange: [0, 40, 80],
    outputRange: [1, 0.4, 0],
    extrapolate: 'clamp',
  })

  const categories = useMemo(() => [
    { id: 'crypto', label: 'Crypto', icon: 'attach-money' as const },
    { id: 'remote', label: 'Remote', icon: 'inventory' as const },
    { id: 'highpaying', label: 'High Paying', icon: 'payments' as const },
    { id: 'distance', label: 'Distance', icon: 'near-me' as const, special: true },
    { id: 'forkids', label: 'For Honor', icon: 'favorite' as const },
  ], [])

  const DISTANCE_OPTIONS = [5, 10, 25, 50]

  const calculateDistance = useCallback((bountyLocation: string) => {
    if (!bountyLocation) return null
    if (userLocation && permission?.granted) {
      const coordMatch = bountyLocation.match(/^(-?\d+\.?\d*),\s*(-?\d+\.?\d*)$/)
      if (coordMatch) {
        const lat = parseFloat(coordMatch[1])
        const lng = parseFloat(coordMatch[2])
        if (!isNaN(lat) && !isNaN(lng)) {
          return locationService.calculateDistance(
            userLocation,
            { latitude: lat, longitude: lng },
            'miles'
          )
        }
      }
    }
    const seed = bountyLocation.length
    const hash = bountyLocation.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
    return 1 + ((hash % seed) % 15)
  }, [userLocation, permission])

  const bountyDistances = useMemo(() => {
    const distances = new Map<string, number | null>()
    bounties.forEach(bounty => {
      distances.set(String(bounty.id), calculateDistance(bounty.location || ''))
    })
    return distances
  }, [bounties, calculateDistance])
  
  const filteredBounties = useMemo(() => {
    let list = [...bounties]
    if (appliedBountyIds.size > 0) {
      list = list.filter((b) => !appliedBountyIds.has(String(b.id)))
    }
    if (activeCategory !== 'all') {
      if (activeCategory === 'forkids') {
        list = list.filter((b) => Boolean(b.is_for_honor))
      } else if (activeCategory === 'remote') {
        list = list.filter((b) => b.work_type === 'online')
      } else if (activeCategory === 'highpaying') {
        list = list.filter((b) => !b.is_for_honor && Number(b.amount) > 0)
      } else {
        list = list.filter((b) =>
          (b.title + ' ' + (b.description || '')).toLowerCase().includes(activeCategory.replace(/_/g, ' ')),
        )
      }
    }
    if (distanceFilter !== null && userLocation && permission?.granted) {
      list = list.filter((b) => {
        if (b.work_type === 'online') return true
        const distance = bountyDistances.get(String(b.id))
        if (distance == null) return true
        return distance <= distanceFilter
      })
    }
    if (activeCategory === 'highpaying') {
      list.sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0))
    } else {
      list.sort((a, b) => {
        const distA = bountyDistances.get(String(a.id))
        const distB = bountyDistances.get(String(b.id))
        if (distA == null && distB == null) return 0
        if (distA == null) return 1
        if (distB == null) return -1
        return (distA ?? Infinity) - (distB ?? Infinity)
      })
    }
    return list
  }, [bounties, activeCategory, distanceFilter, userLocation, permission, bountyDistances, appliedBountyIds])

  const resultsLabel = useMemo(() => {
    const count = filteredBounties.length
    if (count === 0) return 'No bounties'
    if (count === 1) return '1 bounty'
    let label = `${count} bounties`
    if (distanceFilter) label += ` • within ${distanceFilter} mi`
    if (activeCategory !== 'all') label += ` • ${activeCategory}`
    return label
  }, [filteredBounties.length, distanceFilter, activeCategory])

  const loadUserApplications = useCallback(async () => {
    const uid = validUserId ?? currentUserId
    if (!uid) {
      setApplicationsLoaded(true)
      return
    }
    try {
      const requests = await bountyRequestService.getAll({ userId: uid })
      const ids = new Set<string>(
        requests
          .filter(r => r.bounty_id != null)
          .map(r => String(r.bounty_id))
      )
      setAppliedBountyIds(ids)
    } catch (error) {
      console.error('Error loading user applications:', error)
    } finally {
      setApplicationsLoaded(true)
    }
  }, [currentUserId])

  const activeCategoryTimerRef = useRef<number | null>(null)
  const handleSetActiveCategory = useCallback((val: string | 'all') => {
    if (activeCategoryTimerRef.current) clearTimeout(activeCategoryTimerRef.current)
    // @ts-ignore
    activeCategoryTimerRef.current = setTimeout(() => {
      setActiveCategory(val)
    }, 250) as unknown as number
  }, [])

  useEffect(() => {
    return () => {
      if (activeCategoryTimerRef.current) {
        clearTimeout(activeCategoryTimerRef.current)
        // @ts-ignore
        activeCategoryTimerRef.current = null
      }
    }
  }, [])

  const loadBounties = useCallback(async ({ reset = false }: { reset?: boolean } = {}) => {
    if (reset) {
      setIsLoadingBounties(true)
      setLoadError(null)
    } else {
      setLoadingMore(true)
    }
    try {
      const pageOffset = reset ? 0 : offsetRef.current
      const fetchedBounties = await bountyService.getAll({ status: 'open', limit: PAGE_SIZE, offset: pageOffset })
      const mergeUniqueById = (existing: Bounty[], incoming: Bounty[]) => {
        const map = new Map<string, Bounty>()
        existing.concat(incoming).forEach(b => { map.set(String(b.id), b) })
        return Array.from(map.values())
      }
      if (reset) {
        setBounties(mergeUniqueById([], fetchedBounties))
      } else {
        setBounties(prev => mergeUniqueById(prev, fetchedBounties))
      }
      offsetRef.current = pageOffset + fetchedBounties.length
      setHasMore(fetchedBounties.length === PAGE_SIZE)
      setLoadError(null)
    } catch (error) {
      console.error('Error loading bounties:', error)
      if (reset) {
        setLoadError(error as Error)
        setBounties(prev => prev.length === 0 ? [] : prev)
        setHasMore(false)
      }
    } finally {
      setIsLoadingBounties(false)
      setLoadingMore(false)
    }
  }, [])

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      offsetRef.current = 0
      setHasMore(true)
      await Promise.all([
        loadBounties({ reset: true }),
        loadUserApplications().catch(err => console.error('Failed to refresh user applications:', err)),
      ])
    } catch (error) {
      console.error('Error refreshing bounties:', error)
    } finally {
      setRefreshing(false)
    }
  }, [loadBounties, loadUserApplications])

  useImperativeHandle(ref, () => ({
    refresh: () => {
      offsetRef.current = 0
      setHasMore(true)
      loadBounties({ reset: true })
    },
    handleTabRepress: () => {
      bountyListRef.current?.scrollToOffset({ offset: 0, animated: true })
      onRefresh()
    },
  }), [loadBounties, onRefresh])

  useEffect(() => { loadUserApplications() }, [loadUserApplications])
  useEffect(() => { loadBounties({ reset: true }) }, []) // eslint-disable-line
  useEffect(() => {
    if (activeScreen === 'bounty') {
      loadBounties({ reset: false })
      loadUserApplications()
    }
  }, [activeScreen, loadBounties, loadUserApplications])

  useEffect(() => {
    ;(async () => {
      try {
        const saved = await storage.getItem('BE:lastFilter')
        if (saved) setActiveCategory(saved as any)
      } catch {}
    })()
  }, [])

  useEffect(() => {
    ;(async () => {
      try { await storage.setItem('BE:lastFilter', String(activeCategory)) } catch {}
    })()
  }, [activeCategory])

  useEffect(() => {
    const ids = categories.map((c) => c.id)
    if (activeCategory !== 'all' && !ids.includes(String(activeCategory))) {
      setActiveCategory('all')
    }
  }, [categories, activeCategory])

  const keyExtractor = useCallback((item: Bounty) => item.id.toString(), [])

  const renderBountyItem = useCallback(({ item }: { item: Bounty }) => {
    const distance = bountyDistances.get(String(item.id)) ?? calculateDistance(item.location || '')
    const props = {
      id: item.id,
      title: item.title,
      username: item.username,
      price: Number(item.amount),
      distance,
      description: item.description,
      isForHonor: Boolean(item.is_for_honor),
      user_id: item.user_id,
      work_type: item.work_type,
      poster_avatar: item.poster_avatar,
    }
    if (isCompact) {
      return <BountyCompactItem {...props} />
    }
    return (
      <View style={{ height: listHeight }}>
        <BountyListItem {...props} />
      </View>
    )
  }, [bountyDistances, calculateDistance, listHeight, isCompact])

  const handleEndReached = useCallback(() => {
    if (!isLoadingBounties && !loadingMore && hasMore) loadBounties()
  }, [isLoadingBounties, loadingMore, hasMore, loadBounties])

  const ItemSeparator = useCallback(() => null, [])

  const EmptyListComponent = useCallback(() => {
    if (isLoadingBounties || !applicationsLoaded) {
      return (
        <View style={{ width: '100%' }}>
          <PostingsListSkeleton count={5} />
        </View>
      )
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
      )
    }
    if (activeCategory && activeCategory !== 'all') {
      return (
        <View style={{ width: '100%', alignItems: 'center' }}>
          <Text style={{ color: theme.textSecondary, marginBottom: 8 }}>No bounties match this filter.</Text>
          <TouchableOpacity onPress={() => handleSetActiveCategory('all')} style={{ backgroundColor: theme.surfaceSecondary, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999, borderWidth: 1, borderColor: theme.border }}>
            <Text style={{ color: theme.text, fontWeight: '700' }}>Clear filter</Text>
          </TouchableOpacity>
        </View>
      )
    }
    return (
      <EmptyState
        icon="search-off"
        title="No bounties yet"
        description="No bounties near you yet. Be the first to post one!"
        actionLabel="Post a bounty"
        onAction={() => router.push('/screens/CreateBounty')}
      />
    )
  }, [isLoadingBounties, applicationsLoaded, loadError, loadBounties, activeCategory, setActiveCategory, router])

  const ListFooterComponent = useCallback(() => (
    loadingMore ? (
      <View style={{ paddingVertical: 8 }}>
        <PostingsListSkeleton count={2} />
      </View>
    ) : null
  ), [loadingMore])
   
  return (


 


    

    
    <View style={s.dashboardArea}>


      
      {/* Search Bar — only shown for card/compact; grid gets it inside the list header */}
          {bountyFormat !== 'grid' && (
            <View style={s.searchWrapper}>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Open search"
                onPress={() => router.push('/tabs/search')}
                style={s.searchButton}
              >
                <MaterialIcons
                  name="search"
                  size={20}
                  color={theme.textDisabled}
                  style={s.searchIcon}
                />
                <Text style={s.searchText}>Search bounties or users...</Text>
              </TouchableOpacity>
            </View>
          )}








      {/* ← This View measures the true available height */}
      <View
        style={{ flex: 1 }}
        onLayout={(e) => setListHeight(e.nativeEvent.layout.height)}
      >
        {bountyFormat === 'grid' ? (
          <BountyGridFeed
            bounties={filteredBounties}
            bountyDistances={bountyDistances}
            listHeader={
              <View style={[s.searchWrapper, s.searchWrapperGrid]}>
                <LinearGradient
                  colors={['#064e3b', '#059669', '#10b981']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
                />
                <Text style={s.gridHeaderTitle}>Find your Bounty</Text>
                <View style={s.gridHeaderSubRow}>
                  <Text style={s.gridHeaderSubtitle}>Explore tasks near you</Text>
                  <View style={s.gridHeaderCountBadge}>
                    <Text style={s.gridHeaderCountText}>{filteredBounties.length} active bounties</Text>
                  </View>
                </View>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Open search"
                  onPress={() => router.push('/tabs/search')}
                  style={[s.searchButton, s.searchButtonGrid]}
                >
                  <MaterialIcons name="search" size={20} color="rgba(255,255,255,0.75)" style={s.searchIcon} />
                  <Text style={[s.searchText, s.searchTextGrid]}>Search bounties or users...</Text>
                </TouchableOpacity>
              </View>
            }
          />
        ) : (
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
            onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: false })}
            scrollEventThrottle={16}
            onEndReachedThreshold={0.5}
            onEndReached={handleEndReached}
            ItemSeparatorComponent={ItemSeparator}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#ffffff" />}
            ListEmptyComponent={EmptyListComponent}
            ListFooterComponent={ListFooterComponent}
            renderItem={renderBountyItem}
            removeClippedSubviews={true}
            maxToRenderPerBatch={5}
            windowSize={5}
            initialNumToRender={3}
          />
        )}
      </View>
      <LinearGradient
        colors={[
          `${theme.background}00`,
          `${theme.background}CC`,
          theme.background,
        ] as [string, string, string]}
        style={s.bottomFade}
        pointerEvents="none"
      />
    </View>
  )
})

function makeStyles(t: AppTheme) {
  return StyleSheet.create({
    dashboardArea: {
      flex: 1,
      backgroundColor: t.background,
    },
    collapsingHeader: {
      position: 'absolute',
      left: 0,
      right: 0,
      top: 0,
      zIndex: 10,
      backgroundColor: t.background,
      borderBottomWidth: 0.5,
      borderBottomColor: t.border,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: SPACING.SCREEN_HORIZONTAL,
      paddingTop: 12,
      paddingBottom: SPACING.COMPACT_GAP,
    },
    headerLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: HEADER_LAYOUT.iconToTitleGap,
      transform: [{ translateX: -2 }, { translateY: -1 }],
    },
    searchWrapper: {
      paddingHorizontal: SPACING.SCREEN_HORIZONTAL,
      marginBottom: SPACING.COMPACT_GAP,
      marginTop: 12,
    },
    searchWrapperGrid: {
      paddingTop: 64,
      paddingBottom: 36,
      marginTop: 0,
      marginHorizontal: -SPACING.SCREEN_HORIZONTAL,
      overflow: 'hidden',
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
    searchButtonGrid: {
      backgroundColor: 'rgba(255,255,255,0.15)',
      borderColor: 'rgba(255,255,255,0.3)',
      shadowOpacity: 0,
      elevation: 0,
    },
    searchIcon: { marginRight: SPACING.COMPACT_GAP },
    searchText: {
      color: t.textDisabled,
      fontSize: 14,
      fontWeight: '500',
      flex: 1,
    },
    searchTextGrid: {
      color: 'rgba(255,255,255,0.72)',
    },
    filtersRow: { paddingVertical: SPACING.COMPACT_GAP },
    gradientSeparator: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 40 },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: t.surfaceSecondary,
      borderWidth: 1,
      borderColor: t.border,
      paddingHorizontal: 14,
      height: 36,
      borderRadius: 999,
      marginRight: SPACING.COMPACT_GAP,
      minHeight: SIZING.MIN_TOUCH_TARGET,
    },
    chipActive: {
      backgroundColor: t.surface,
      borderColor: t.primary,
    },
    chipLabel: {
      color: t.text,
      fontSize: TYPOGRAPHY.SIZE_SMALL,
      fontWeight: '600',
    },
    chipLabelActive: { color: t.primaryLight },
    disabledChip: { opacity: 0.4 },
    distanceDropdown: {
      position: 'absolute',
      top: 48,
      right: SPACING.SCREEN_HORIZONTAL,
      backgroundColor: t.surface,
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: 12,
      padding: SPACING.COMPACT_GAP,
      zIndex: 60,
      shadowColor: '#000',
      shadowOpacity: 0.08,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 2 },
      elevation: 4,
    },
    distanceOption: {
      paddingVertical: SPACING.COMPACT_GAP,
      paddingHorizontal: SPACING.ELEMENT_GAP,
    },
    dropdownNotice: {
      color: t.textSecondary,
      padding: SPACING.COMPACT_GAP,
      fontSize: TYPOGRAPHY.SIZE_XSMALL,
    },
    bottomFade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 140, zIndex: 50 },
    trendingSection: {
      marginBottom: 16,
      marginHorizontal: -16,
      paddingHorizontal: 16,
    },
    trendingHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 8,
    },
    trendingTitle: {
      color: t.text,
      fontSize: 16,
      fontWeight: '600',
    },
    trendingCard: {
      width: 200,
      backgroundColor: t.surface,
      borderRadius: 16,
      padding: 14,
      marginRight: 10,
      borderWidth: 1,
      borderColor: t.border,
    },
    trendingCardHeader: { marginBottom: 8 },
    trendingCardTitle: {
      color: t.text,
      fontSize: 14,
      fontWeight: '600',
      marginBottom: 4,
    },
    trendingAmount: {
      color: t.primary,
      fontSize: 15,
      fontWeight: '700',
    },
    trendingHonorBadge: {
      backgroundColor: '#FEF3C7',
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: 6,
      alignSelf: 'flex-start',
    },
    trendingHonorText: {
      color: '#92400E',
      fontSize: 11,
      fontWeight: '700',
    },
    trendingNewBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      marginTop: 4,
    },
    trendingNewText: {
      color: t.primary,
      fontSize: 11,
      fontWeight: '500',
    },
    resultsRow: {
      paddingHorizontal: SPACING.SCREEN_HORIZONTAL,
      paddingBottom: 6,
    },
    resultsText: {
      fontSize: TYPOGRAPHY.SIZE_XSMALL,
      color: t.textSecondary,
      fontWeight: '500',
    },
    searchIconRight: {
      marginRight: 10,
    },
    gridHeaderTitle: {
      color: '#ffffff',
      fontSize: 40,
      fontWeight: '800',
      letterSpacing: -0.5,
      marginBottom: 6,
    },
    gridHeaderSubRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 18,
    },
    gridHeaderSubtitle: {
      color: 'rgba(255,255,255,0.72)',
      fontSize: 13,
      fontWeight: '500',
    },
    gridHeaderCountBadge: {
      backgroundColor: 'rgba(255,255,255,0.18)',
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.3)',
    },
    gridHeaderCountText: {
      color: '#ffffff',
      fontSize: 12,
      fontWeight: '700',
    },
  })
}