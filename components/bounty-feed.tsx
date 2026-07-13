import { MaterialIcons } from '@expo/vector-icons'
import { useLocation } from 'app/hooks/useLocation'
import { BountyCompactItem } from 'components/bounty-compact-item'
import { BountyGridFeed } from 'components/bounty-grid-feed'
import { BountyListItem } from 'components/bounty-list-item'
import { EmptyState } from 'components/ui/empty-state'
import { PostingsListSkeleton } from 'components/ui/skeleton-loaders'
import { LinearGradient } from 'expo-linear-gradient'
import { useRouter } from 'expo-router'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { Alert, Animated, Dimensions, FlatList, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useValidUserId } from '../hooks/useValidUserId'
import { SIZING, SPACING, TYPOGRAPHY } from '../lib/constants/accessibility'
import { useBountyFormat } from '../lib/bounty-format-context'
import { useAppThemeContext } from '../lib/themes/AppThemeContext'
import type { AppTheme } from '../lib/themes/types'
import { bountyRequestService } from '../lib/services/bounty-request-service'
import { bountyService } from '../lib/services/bounty-service'
import type { Bounty } from '../lib/services/database.types'
import { locationService } from '../lib/services/location-service'
import { storage } from '../lib/storage'
import { isBountyDeadlinePassed } from '../lib/utils/schedule-utils'
import type { TrendingBounty } from '../lib/types'
import { logger } from '../lib/utils/error-logger'
import { withTimeout } from '../lib/utils/withTimeout'
import { API_TIMEOUTS } from '../lib/config/network'

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
const DISTANCE_OPTIONS = [5, 10, 25, 50]

export const BountyFeed = forwardRef<BountyFeedHandle, BountyFeedProps>(function BountyFeed(
  { activeScreen, setActiveScreen, currentUserId },
  ref
) {
  const router = useRouter()
  const [listHeight, setListHeight] = useState(0)
  const [bounties, setBounties] = useState<Bounty[]>([])
  const [isLoadingBounties, setIsLoadingBounties] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [appliedBountyIds, setAppliedBountyIds] = useState<Set<string>>(new Set())
  const [applicationsLoaded, setApplicationsLoaded] = useState(false)
  const [loadError, setLoadError] = useState<Error | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [activeCategory, setActiveCategory] = useState<string | 'all'>('all')
  const [distanceFilter, setDistanceFilter] = useState<number | null>(null)
  const [distanceDropdownOpen, setDistanceDropdownOpen] = useState(false)
  const [distanceChipLayout, setDistanceChipLayout] = useState<{ x: number; y: number; width: number; height: number } | null>(null)

  const { theme } = useAppThemeContext()
  const { bountyFormat } = useBountyFormat()
  const isCompact = bountyFormat === 'compact'
  const insets = useSafeAreaInsets()
  const s = useMemo(() => makeStyles(theme), [theme])

  const scrollY = useRef(new Animated.Value(0)).current
  const bountyListRef = useRef<FlatList>(null)
  const offsetRef = useRef(0)
  const distanceChipRef = useRef<any>(null)

  const { location: userLocation, permission } = useLocation()
  const validUserId = useValidUserId()

  const categories = useMemo(() => [
    { id: 'all', label: 'For You', icon: 'auto-awesome' as const },
    { id: 'crypto', label: 'Crypto', icon: 'attach-money' as const },
    { id: 'remote', label: 'Remote', icon: 'inventory' as const },
    { id: 'highpaying', label: 'High Paying', icon: 'payments' as const },
    { id: 'distance', label: 'Distance', icon: 'near-me' as const, special: true },
    { id: 'forkids', label: 'For Honor', icon: 'favorite' as const },
  ], [])

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
    // Hide bounties whose deadline has passed — they're still visible to the
    // poster (as "Deadline Passed") in My Postings, just not to hunters here.
    list = list.filter((b) => !isBountyDeadlinePassed(b))
    if (appliedBountyIds.size > 0) {
      list = list.filter((b) => !appliedBountyIds.has(String(b.id)))
    }
    if (activeCategory !== 'all') {
      if (activeCategory === 'forkids') {
        // For Honor: unpaid bounties done for goodwill
        list = list.filter((b) => Boolean(b.is_for_honor))
      } else if (activeCategory === 'remote') {
        // Remote: online/digital work only
        list = list.filter((b) => b.work_type === 'online')
      } else if (activeCategory === 'highpaying') {
        // High Paying: paid bounties only, sorted highest first
        list = list.filter((b) => !b.is_for_honor && Number(b.amount) > 0)
      } else if (activeCategory === 'crypto') {
        // Crypto: bounties related to blockchain, web3, or crypto work
        const cryptoKeywords = [
          'crypto', 'bitcoin', 'btc', 'ethereum', 'eth', 'blockchain', 'web3',
          'nft', 'defi', 'solana', 'sol', 'token', 'wallet', 'smart contract',
          'dao', 'dapp', 'metaverse', 'polygon', 'matic', 'binance', 'bnb',
        ]
        list = list.filter((b) => {
          const text = (b.title + ' ' + (b.description || '')).toLowerCase()
          return cryptoKeywords.some(kw => text.includes(kw))
        })
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

  const loadUserApplications = useCallback(async () => {
    const uid = validUserId ?? currentUserId
    if (!uid) {
      setAppliedBountyIds(new Set())
      setApplicationsLoaded(true)
      return
    }
    const startedAt = Date.now()
    logger.info('feed.applications.request_started', { userId: uid })
    try {
      // Timeout-protect this fetch: it gates the skeleton loader via
      // `applicationsLoaded`, so an un-timed hang here (stalled network, auth
      // lock deadlock, unresolved Supabase deferred proxy) would otherwise keep
      // the feed on the skeleton screen forever.
      const requests = await withTimeout(
        bountyRequestService.getAll({ userId: uid }),
        API_TIMEOUTS.DEFAULT
      )
      const ids = new Set<string>(
        requests
          .filter(r => r.bounty_id != null)
          .map(r => String(r.bounty_id))
      )
      setAppliedBountyIds(ids)
      logger.info('feed.applications.request_completed', {
        userId: uid,
        durationMs: Date.now() - startedAt,
        count: ids.size,
        success: true,
      })
    } catch (error) {
      // Non-fatal: applications only drive client-side filtering. On failure we
      // clear any stale applied IDs and proceed with an unfiltered feed rather
      // than blocking the UI. The finally block guarantees `applicationsLoaded`
      // is set so the skeleton clears.
      setAppliedBountyIds(new Set())
      const message = error instanceof Error ? error.message : String(error)
      logger.warning('feed.applications.request_failed', {
        userId: uid,
        durationMs: Date.now() - startedAt,
        timedOut: message.includes('timed out'),
        error: message,
      })
    } finally {
      setApplicationsLoaded(true)
    }
  }, [validUserId, currentUserId])

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
    const pageOffset = reset ? 0 : offsetRef.current
    const startedAt = Date.now()
    logger.info('feed.bounties.request_started', { reset, offset: pageOffset, pageSize: PAGE_SIZE })
    try {
      const fetchedBounties = await withTimeout(
        bountyService.getAll({ status: 'open', limit: PAGE_SIZE, offset: pageOffset }),
        API_TIMEOUTS.DEFAULT
      )
      const safeBounties = Array.isArray(fetchedBounties) ? fetchedBounties : []
      const mergeUniqueById = (existing: Bounty[], incoming: Bounty[]) => {
        const map = new Map<string, Bounty>()
        existing.concat(incoming).forEach(b => { map.set(String(b.id), b) })
        return Array.from(map.values())
      }
      if (reset) {
        setBounties(mergeUniqueById([], safeBounties))
      } else {
        setBounties(prev => mergeUniqueById(prev, safeBounties))
      }
      offsetRef.current = pageOffset + safeBounties.length
      setHasMore(safeBounties.length === PAGE_SIZE)
      setLoadError(null)
      logger.info('feed.bounties.request_completed', {
        reset,
        durationMs: Date.now() - startedAt,
        count: safeBounties.length,
        success: true,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error('feed.bounties.request_failed', {
        reset,
        durationMs: Date.now() - startedAt,
        timedOut: message.includes('timed out'),
        error: message,
      })
      if (reset) {
        setLoadError(error instanceof Error ? error : new Error(message))
        setBounties(prev => prev.length === 0 ? [] : prev)
        setHasMore(false)
      }
    } finally {
      // Guaranteed exit: both loading flags are always cleared so the skeleton
      // can never persist because of this request.
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
      // Schedule fields (Phase 1)
      schedule_type: item.schedule_type,
      start_date: item.start_date,
      end_date: item.end_date,
      duration_minutes: item.duration_minutes,
      is_time_sensitive: item.is_time_sensitive,
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
          <TouchableOpacity
            onPress={() => handleSetActiveCategory('all')}
            style={{ backgroundColor: theme.surfaceSecondary, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999, borderWidth: 1, borderColor: theme.border }}
          >
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
  }, [isLoadingBounties, applicationsLoaded, loadError, loadBounties, activeCategory, handleSetActiveCategory, theme, router])

  const ListFooterComponent = useCallback(() => (
    loadingMore ? (
      <View style={{ paddingVertical: 8 }}>
        <PostingsListSkeleton count={2} />
      </View>
    ) : null
  ), [loadingMore])

  // Renders the horizontal filter chips row.
  // Chips must always live OUTSIDE any FlatList — nesting a FlatList inside another
  // FlatList's ListHeaderComponent causes the gesture recognizer to steal all touches,
  // so onPress never fires. This is rendered as a sibling above the list for all formats.
  const renderChips = () => (
    <View style={s.filtersRow}>
      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        data={categories}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingHorizontal: 16 }}
        renderItem={({ item }) => {
          const isDistance = item.id === 'distance'
          const isActive = isDistance ? Boolean(distanceFilter) : activeCategory === item.id
          const iconColor = isActive ? theme.primary : theme.textSecondary
          const chipStyle = [s.chip, isActive && s.chipActive, !permission?.granted && isDistance ? s.disabledChip : undefined]
          const labelStyle = [s.chipLabel, isActive && s.chipLabelActive]

          if (isDistance) {
            return (
              <TouchableOpacity
                ref={(r) => { distanceChipRef.current = r }}
                onLayout={(e) => {
                  const { x, y, width, height } = e.nativeEvent.layout
                  setDistanceChipLayout({ x, y, width, height })
                }}
                onPress={() => {
                  if (!permission?.granted || !userLocation) {
                    Alert.alert('Location required', 'Enable location permission to filter by distance.')
                    return
                  }
                  if (distanceFilter) {
                    setDistanceFilter(null)
                    setDistanceDropdownOpen(false)
                    return
                  }
                  if (distanceDropdownOpen && !distanceFilter) {
                    setDistanceDropdownOpen(false)
                    return
                  }
                  try {
                    if (distanceChipRef.current && typeof distanceChipRef.current.measureInWindow === 'function') {
                      distanceChipRef.current.measureInWindow((x: number, y: number, width: number, height: number) => {
                        setDistanceChipLayout({ x, y, width, height })
                        setDistanceDropdownOpen(true)
                      })
                      return
                    }
                  } catch {
                    // fallthrough to toggle without measured position
                  }
                  setDistanceDropdownOpen((prev) => !prev)
                }}
                style={chipStyle}
                accessibilityRole="button"
                accessibilityLabel={distanceFilter ? `Filter by ${distanceFilter} miles, currently active` : 'Filter by distance'}
                accessibilityHint={distanceFilter ? 'Tap to clear distance filter' : 'Tap to select distance radius'}
                accessibilityState={{ selected: isActive, disabled: !permission?.granted }}
              >
                <MaterialIcons
                  name={item.icon}
                  size={SIZING.ICON_SMALL}
                  color={iconColor}
                  style={{ marginRight: SPACING.COMPACT_GAP }}
                  accessibilityElementsHidden={true}
                />
                <Text style={labelStyle}>{distanceFilter ? `${distanceFilter}mi` : item.label}</Text>
              </TouchableOpacity>
            )
          }

          return (
            <TouchableOpacity
              onPress={() => handleSetActiveCategory(isActive ? 'all' : (item.id as any))}
              style={chipStyle}
              accessibilityRole="button"
              accessibilityLabel={`Filter by ${item.label}${isActive ? ', currently active' : ''}`}
              accessibilityHint={isActive ? 'Tap to remove filter and show all bounties' : `Tap to filter bounties by ${item.label}`}
              accessibilityState={{ selected: isActive }}
            >
              <MaterialIcons
                name={item.icon}
                size={SIZING.ICON_SMALL}
                color={iconColor}
                style={{ marginRight: SPACING.COMPACT_GAP }}
                accessibilityElementsHidden={true}
              />
              <Text style={labelStyle}>{item.label}</Text>
            </TouchableOpacity>
          )
        }}
      />
    </View>
  )

  // Distance dropdown — rendered at dashboardArea level so it floats above all content.
  const renderDistanceDropdown = () => {
    const windowWidth = Dimensions.get('window').width
    const dropdownWidth = Math.max(160, distanceChipLayout?.width ?? 160)
    let left = distanceChipLayout?.x ?? 16
    if (left + dropdownWidth > windowWidth - 8) {
      left = Math.max(8, windowWidth - dropdownWidth - 8)
    }
    const top = distanceChipLayout ? distanceChipLayout.y + distanceChipLayout.height + 2 : 120
    const dropdownContent = permission?.granted && userLocation
      ? DISTANCE_OPTIONS.map((m) => (
          <TouchableOpacity
            key={m}
            onPress={() => { setDistanceFilter(distanceFilter === m ? null : m); setDistanceDropdownOpen(false) }}
            style={s.distanceOption}
          >
            <Text style={{ color: theme.text, fontWeight: '700' }}>{m} mi</Text>
          </TouchableOpacity>
        ))
      : <Text style={s.dropdownNotice}>Location permission required to use distance filter.</Text>

    return (
      <View style={[s.distanceDropdown, { position: 'absolute', left, top, width: dropdownWidth }]}>
        {dropdownContent}
      </View>
    )
  }

  return (
    <View style={s.dashboardArea}>
      {/* Search bar — non-grid only (grid has it inside the banner block below) */}
      {bountyFormat !== 'grid' && (
        <View style={s.searchWrapper}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Open search"
            onPress={() => router.push('/tabs/search')}
            style={s.searchButton}
          >
            <MaterialIcons name="search" size={20} color={theme.textDisabled} style={s.searchIcon} />
            <Text style={s.searchText}>Search bounties or users...</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Filter chips — outside FlatList for non-grid; grid gets them inside listHeader */}
      {bountyFormat !== 'grid' && renderChips()}

      {/* Distance dropdown — absolutely positioned over all content */}
      {distanceDropdownOpen && renderDistanceDropdown()}

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
                    <Text style={s.gridBannerSubtitle}>Explore tasks near you</Text>
                    <View style={s.gridBannerCountBadge}>
                      <Text style={s.gridBannerCountText}>{filteredBounties.length} active</Text>
                    </View>
                  </View>
                  <View style={s.gridBannerSearchWrapper}>
                    <TouchableOpacity
                      accessibilityRole="button"
                      accessibilityLabel="Open search"
                      onPress={() => router.push('/tabs/search')}
                      style={s.gridBannerSearchButton}
                    >
                      <MaterialIcons name="search" size={18} color="rgba(255,255,255,0.85)" style={s.searchIcon} />
                      <Text style={s.gridBannerSearchText}>Search bounties or users...</Text>
                    </TouchableOpacity>
                  </View>
                </View>
                {/* Chips below banner — ScrollView avoids nested-FlatList gesture conflict */}
                <View style={s.filtersRow}>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={{ paddingHorizontal: SPACING.SCREEN_HORIZONTAL }}
                    keyboardShouldPersistTaps="handled"
                  >
                    {categories.map((item) => {
                      const isDistance = item.id === 'distance'
                      const isActive = isDistance ? Boolean(distanceFilter) : activeCategory === item.id
                      const iconColor = isActive ? theme.primary : theme.textSecondary
                      const chipStyle = [s.chip, isActive && s.chipActive, !permission?.granted && isDistance ? s.disabledChip : undefined]
                      const labelStyle = [s.chipLabel, isActive && s.chipLabelActive]
                      if (isDistance) {
                        return (
                          <TouchableOpacity
                            key={item.id}
                            ref={(r) => { distanceChipRef.current = r }}
                            onLayout={(e) => { const { x, y, width, height } = e.nativeEvent.layout; setDistanceChipLayout({ x, y, width, height }) }}
                            onPress={() => {
                              if (!permission?.granted || !userLocation) { Alert.alert('Location required', 'Enable location permission to filter by distance.'); return }
                              if (distanceFilter) { setDistanceFilter(null); setDistanceDropdownOpen(false); return }
                              if (distanceDropdownOpen && !distanceFilter) { setDistanceDropdownOpen(false); return }
                              try {
                                if (distanceChipRef.current?.measureInWindow) {
                                  distanceChipRef.current.measureInWindow((x: number, y: number, width: number, height: number) => { setDistanceChipLayout({ x, y, width, height }); setDistanceDropdownOpen(true) })
                                  return
                                }
                              } catch {}
                              setDistanceDropdownOpen(prev => !prev)
                            }}
                            style={chipStyle}
                            accessibilityRole="button"
                            accessibilityState={{ selected: isActive, disabled: !permission?.granted }}
                          >
                            <MaterialIcons name={item.icon} size={SIZING.ICON_SMALL} color={iconColor} style={{ marginRight: SPACING.COMPACT_GAP }} accessibilityElementsHidden />
                            <Text style={labelStyle}>{distanceFilter ? `${distanceFilter}mi` : item.label}</Text>
                          </TouchableOpacity>
                        )
                      }
                      return (
                        <TouchableOpacity
                          key={item.id}
                          onPress={() => handleSetActiveCategory(isActive ? 'all' : item.id as any)}
                          style={chipStyle}
                          accessibilityRole="button"
                          accessibilityState={{ selected: isActive }}
                        >
                          <MaterialIcons name={item.icon} size={SIZING.ICON_SMALL} color={iconColor} style={{ marginRight: SPACING.COMPACT_GAP }} accessibilityElementsHidden />
                          <Text style={labelStyle}>{item.label}</Text>
                        </TouchableOpacity>
                      )
                    })}
                  </ScrollView>
                </View>
              </View>
            }
          />
        </View>
      ) : (
        <View
          style={{ flex: 1 }}
          onLayout={(e) => setListHeight(e.nativeEvent.layout.height)}
        >
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
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primary} />}
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
    searchWrapper: {
      paddingHorizontal: SPACING.SCREEN_HORIZONTAL,
      marginBottom: SPACING.COMPACT_GAP,
      marginTop: 30,
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

    // ── Filter chips ─────────────────────────────────────────────────────────
    filtersRow: {
      paddingVertical: SPACING.COMPACT_GAP,
    },
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
    chipLabelActive: {
      color: t.primaryLight,
    },
    disabledChip: { opacity: 0.4 },

    // ── Distance dropdown ─────────────────────────────────────────────────────
    distanceDropdown: {
      position: 'absolute',
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
  })
}
