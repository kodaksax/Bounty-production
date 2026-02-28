import { MaterialIcons } from '@expo/vector-icons'
import { useLocation } from 'app/hooks/useLocation'
import { BountyListItem } from 'components/bounty-list-item'
import { NotificationsBell } from 'components/notifications-bell'
import { BrandingLogo } from 'components/ui/branding-logo'
import { EmptyState } from 'components/ui/empty-state'
import { PostingsListSkeleton } from 'components/ui/skeleton-loaders'
import { WalletBalanceButton } from 'components/ui/wallet-balance-button'
import { LinearGradient } from 'expo-linear-gradient'
import { useRouter } from 'expo-router'
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { Alert, Animated, Dimensions, FlatList, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { HEADER_LAYOUT, SIZING, SPACING, TYPOGRAPHY } from '../lib/constants/accessibility'
import { bountyRequestService } from '../lib/services/bounty-request-service'
import { bountyService } from '../lib/services/bounty-service'
import type { Bounty } from '../lib/services/database.types'
import { locationService } from '../lib/services/location-service'
import { searchService } from '../lib/services/search-service'
import { storage } from '../lib/storage'
import type { TrendingBounty } from '../lib/types'
import { CURRENT_USER_ID } from '../lib/utils/data-utils'
import { colors } from '../lib/theme';

export type BountyFeedHandle = {
  /** Reload the first page of bounties (reset pagination). */
  refresh: () => void
  /** Scroll list to top and trigger a refresh — used when user re-taps the bounty tab. */
  handleTabRepress: () => void
}

interface BountyFeedProps {
  activeScreen: string
  setActiveScreen: (screen: string) => void
  currentUserId?: string
}

const PAGE_SIZE = 20

export const BountyFeed = forwardRef<BountyFeedHandle, BountyFeedProps>(function BountyFeed(
  { activeScreen, setActiveScreen, currentUserId },
  ref
) {
  const router = useRouter()

  const [bounties, setBounties] = useState<Bounty[]>([])
  const [isLoadingBounties, setIsLoadingBounties] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  // Track bounty IDs the user has applied to (pending, accepted, or rejected)
  const [appliedBountyIds, setAppliedBountyIds] = useState<Set<string>>(new Set())
  // Track whether user applications have been loaded (prevents flash of unfiltered content)
  const [applicationsLoaded, setApplicationsLoaded] = useState(false)
  // Track error state to show offline/error UI instead of perpetual loading
  const [loadError, setLoadError] = useState<Error | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  // Trending bounties state
  const [trendingBounties, setTrendingBounties] = useState<TrendingBounty[]>([])
  const [isLoadingTrending, setIsLoadingTrending] = useState(true)

  const [activeCategory, setActiveCategory] = useState<string | 'all'>('all')
  const [distanceFilter, setDistanceFilter] = useState<number | null>(null) // Max distance in miles, null = no filter
  const [distanceDropdownOpen, setDistanceDropdownOpen] = useState(false)
  const [distanceChipLayout, setDistanceChipLayout] = useState<{ x: number; y: number; width: number; height: number } | null>(null)

  const scrollY = useRef(new Animated.Value(0)).current
  const bountyListRef = useRef<FlatList>(null)
  const offsetRef = useRef(0)
  const distanceChipRef = useRef<any>(null)

  // Location hook for calculating real distances
  const { location: userLocation, permission } = useLocation()

  // Collapsing header config (using standardized constants)
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

  // Filter chips per design - memoized to prevent dependency issues
  const categories = useMemo(() => [
    { id: 'crypto', label: 'Crypto', icon: 'attach-money' as const },
    { id: 'remote', label: 'Remote', icon: 'inventory' as const },
    { id: 'highpaying', label: 'High Paying', icon: 'payments' as const },
    // Insert distance as a synthetic chip so it renders inline between High Paying and For Honor
    { id: 'distance', label: 'Distance', icon: 'near-me' as const, special: true },
    { id: 'forkids', label: 'For Honor', icon: 'favorite' as const },
  ], [])

  const DISTANCE_OPTIONS = [5, 10, 25, 50]

  // Calculate distance - uses real geolocation when available, falls back to mock
  const calculateDistance = useCallback((bountyLocation: string) => {
    if (!bountyLocation) return null // Return null for missing location (will show "Location TBD")

    // If user has location permission and coordinates
    if (userLocation && permission?.granted) {
      // Try to parse bounty location if it has coordinates
      // Format: "lat,lng" or just address string
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

    // Fallback: deterministic mock distance calculation based on location string
    const seed = bountyLocation.length
    const hash = bountyLocation.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
    return 1 + ((hash % seed) % 15)
  }, [userLocation, permission])

  // Memoize distance calculations to avoid recalculating on each filter/sort
  const bountyDistances = useMemo(() => {
    const distances = new Map<string, number | null>()
    bounties.forEach(bounty => {
      distances.set(String(bounty.id), calculateDistance(bounty.location || ''))
    })
    return distances
  }, [bounties, calculateDistance])

  // Filter and sort bounties by category
  const filteredBounties = useMemo(() => {
    let list = [...bounties]

    // Filter out bounties the user has applied to (pending, accepted, or rejected)
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

    // Apply distance filter if active (only for in-person bounties)
    if (distanceFilter !== null && userLocation && permission?.granted) {
      list = list.filter((b) => {
        if (b.work_type === 'online') return true
        const distance = bountyDistances.get(String(b.id))
        if (distance == null) return true
        return distance <= distanceFilter
      })
    }

    // Sorting
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

  // Load user's bounty applications (to filter out applied/rejected bounties from feed)
  const loadUserApplications = useCallback(async () => {
    if (!currentUserId || currentUserId === CURRENT_USER_ID) {
      setApplicationsLoaded(true)
      return
    }
    try {
      const requests = await bountyRequestService.getAll({ userId: currentUserId })
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

  // Load bounties from backend
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
        existing.concat(incoming).forEach(b => {
          map.set(String(b.id), b)
        })
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

  // Load trending bounties
  const loadTrendingBounties = useCallback(async () => {
    setIsLoadingTrending(true)
    try {
      const trending = await searchService.getTrendingBounties(5)
      const unique = Array.from(new Map(trending.map(t => [String(t.id), t])).values())
      setTrendingBounties(unique)
    } catch (error) {
      console.error('Error loading trending bounties:', error)
    } finally {
      setIsLoadingTrending(false)
    }
  }, [])

  // Pull-to-refresh handler
  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      offsetRef.current = 0
      setHasMore(true)
      await Promise.all([
        loadBounties({ reset: true }),
        loadUserApplications().catch(err => {
          console.error('Failed to refresh user applications:', err)
        }),
        loadTrendingBounties().catch(err => {
          console.error('Failed to refresh trending bounties:', err)
        }),
      ])
    } catch (error) {
      console.error('Error refreshing bounties:', error)
    } finally {
      setRefreshing(false)
    }
  }, [loadBounties, loadUserApplications, loadTrendingBounties])

  // Expose refresh and tab-repress handlers to parent via ref
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

  // Load user applications when component mounts or user changes
  useEffect(() => {
    loadUserApplications()
  }, [loadUserApplications])

  // Load initial data on mount only
  useEffect(() => {
    loadBounties({ reset: true })
    loadTrendingBounties()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Reload bounties when returning to bounty screen from other screens
  useEffect(() => {
    if (activeScreen === 'bounty') {
      loadBounties({ reset: false })
      loadUserApplications()
      loadTrendingBounties()
    }
  }, [activeScreen, loadBounties, loadUserApplications, loadTrendingBounties])

  // Restore last-selected chip on mount
  useEffect(() => {
    ;(async () => {
      try {
        const saved = await storage.getItem('BE:lastFilter')
        if (saved) setActiveCategory(saved as any)
      } catch {}
    })()
  }, [])

  // Persist chip selection
  useEffect(() => {
    ;(async () => {
      try {
        await storage.setItem('BE:lastFilter', String(activeCategory))
      } catch {}
    })()
  }, [activeCategory])

  // Ensure activeCategory matches available filters
  useEffect(() => {
    const ids = categories.map((c) => c.id)
    if (activeCategory !== 'all' && !ids.includes(String(activeCategory))) {
      setActiveCategory('all')
    }
  }, [categories, activeCategory])

  // FlatList optimization: memoized functions
  const keyExtractor = useCallback((item: Bounty) => item.id.toString(), [])

  const getItemLayout = useCallback((_data: any, index: number) => ({
    length: 90,
    offset: 90 * index,
    index,
  }), [])

  const renderBountyItem = useCallback(({ item }: { item: Bounty }) => {
    const distance = bountyDistances.get(String(item.id)) ?? calculateDistance(item.location || '')
    return (
      <BountyListItem
        id={item.id}
        title={item.title}
        username={item.username}
        price={Number(item.amount)}
        distance={distance}
        description={item.description}
        isForHonor={Boolean(item.is_for_honor)}
        user_id={item.user_id}
        work_type={item.work_type}
        poster_avatar={item.poster_avatar}
      />
    )
  }, [bountyDistances, calculateDistance])

  const handleEndReached = useCallback(() => {
    if (!isLoadingBounties && !loadingMore && hasMore) {
      loadBounties()
    }
  }, [isLoadingBounties, loadingMore, hasMore, loadBounties])

  const ItemSeparator = useCallback(() => <View style={{ height: 2 }} />, [])

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

    return (
      <>
        <Text style={{ color: '#e5e7eb', marginBottom: 8 }}>No bounties match this filter.</Text>
        <TouchableOpacity onPress={() => setActiveCategory('all')} style={{ backgroundColor: '#a7f3d0', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999 }}>
          <Text style={{ color: '#052e1b', fontWeight: '700' }}>Clear filter</Text>
        </TouchableOpacity>
      </>
    )
  }, [isLoadingBounties, applicationsLoaded, loadError, loadBounties])

  const ListFooterComponent = useCallback(() => (
    loadingMore ? (
      <View style={{ paddingVertical: 8 }}>
        <PostingsListSkeleton count={2} />
      </View>
    ) : null
  ), [loadingMore])

  // Trending Section Component
  const TrendingSection = useCallback(() => {
    if (isLoadingTrending && trendingBounties.length === 0) {
      return (
        <View style={styles.trendingSection}>
          <View style={styles.trendingHeader}>
            <MaterialIcons name="trending-up" size={20} color="#fcd34d" />
            <Text style={styles.trendingTitle}>Trending This Week</Text>
          </View>
          <View style={{ paddingVertical: 16 }}>
            <PostingsListSkeleton count={2} />
          </View>
        </View>
      )
    }

    if (trendingBounties.length === 0) {
      return null
    }

    const getAgeBadge = (createdAt: string | undefined | null): string | null => {
      if (!createdAt) return null
      const date = new Date(createdAt)
      if (isNaN(date.getTime())) return null
      const hours = (Date.now() - date.getTime()) / (1000 * 60 * 60)
      if (hours < 24) return 'New today'
      if (hours < 48) return 'Yesterday'
      if (hours < 72) return '2 days ago'
      return null
    }

    return (
      <View style={styles.trendingSection}>
        <View style={styles.trendingHeader}>
          <MaterialIcons name="trending-up" size={20} color="#fcd34d" />
          <Text style={styles.trendingTitle}>Trending This Week</Text>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingVertical: 8 }}
        >
          {trendingBounties.map((item) => {
            const ageBadge = getAgeBadge(item.createdAt)
            return (
              <TouchableOpacity
                key={item.id}
                style={styles.trendingCard}
                onPress={() => router.push(`/postings/${item.id}`)}
                accessibilityRole="button"
                accessibilityLabel={`Trending bounty: ${item.title}, ${item.isForHonor ? 'for honor' : '$' + item.amount}${ageBadge ? ', ' + ageBadge : ''}`}
              >
                <View style={styles.trendingCardHeader}>
                  <Text style={styles.trendingCardTitle} numberOfLines={2}>
                    {item.title}
                  </Text>
                  {item.isForHonor ? (
                    <View style={styles.trendingHonorBadge}>
                      <Text style={styles.trendingHonorText}>Honor</Text>
                    </View>
                  ) : item.amount ? (
                    <Text style={styles.trendingAmount}>${item.amount}</Text>
                  ) : null}
                </View>
                {ageBadge && (
                  <View style={styles.trendingNewBadge}>
                    <MaterialIcons name="schedule" size={12} color="#6ee7b7" />
                    <Text style={styles.trendingNewText}>{ageBadge}</Text>
                  </View>
                )}
              </TouchableOpacity>
            )
          })}
        </ScrollView>
      </View>
    )
  }, [isLoadingTrending, trendingBounties, router])

  return (
    <View style={styles.dashboardArea}>
      {/* Collapsing Header */}
      <Animated.View style={[styles.collapsingHeader, { height: headerHeight, paddingTop: headerTopPad }]}>
        <View style={styles.headerRow}>
          <View style={styles.headerLeft}>
            <BrandingLogo size="medium" />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <NotificationsBell />
            <WalletBalanceButton onPress={() => setActiveScreen('wallet')} />
          </View>
        </View>
        <Animated.View style={{ opacity: extraContentOpacity }}>
          {/* Search Bar */}
          <View style={styles.searchWrapper}>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Open search"
              onPress={() => router.push('/tabs/search')}
              style={styles.searchButton}
            >
              <MaterialIcons name="search" size={18} color="rgba(255,255,255,0.85)" style={styles.searchIcon} />
              <Text style={styles.searchText}>Search bounties or users...</Text>
            </TouchableOpacity>
          </View>
          {/* Filter Chips + Distance chip */}
          <View style={styles.filtersRow}>
            <FlatList
              horizontal
              showsHorizontalScrollIndicator={false}
              data={categories}
              keyExtractor={(item) => item.id}
              contentContainerStyle={{ paddingHorizontal: 16 }}
              renderItem={({ item }) => {
                const isDistance = item.id === 'distance'
                const isActive = isDistance ? Boolean(distanceFilter) : activeCategory === item.id
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
                          // fallthrough to open without positioning
                        }
                        setDistanceDropdownOpen((s) => !s)
                      }}
                      style={[styles.chip, isActive && styles.chipActive, !permission?.granted ? styles.disabledChip : undefined]}
                      accessibilityRole="button"
                      accessibilityLabel={distanceFilter ? `Filter by ${distanceFilter} miles, currently active` : 'Filter by distance'}
                      accessibilityHint={distanceFilter ? 'Tap to clear distance filter' : 'Tap to select distance radius'}
                      accessibilityState={{ selected: isActive, disabled: !permission?.granted }}
                    >
                      <MaterialIcons
                        name={item.icon}
                        size={SIZING.ICON_SMALL}
                        color={isActive ? '#052e1b' : '#d1fae5'}
                        style={{ marginRight: SPACING.COMPACT_GAP }}
                        accessibilityElementsHidden={true}
                      />
                      <Text style={[styles.chipLabel, isActive && styles.chipLabelActive]}>{distanceFilter ? `${distanceFilter}mi` : item.label}</Text>
                    </TouchableOpacity>
                  )
                }
                return (
                  <TouchableOpacity
                    onPress={() => setActiveCategory(isActive ? 'all' : (item.id as any))}
                    style={[styles.chip, isActive && styles.chipActive]}
                    accessibilityRole="button"
                    accessibilityLabel={`Filter by ${item.label}${isActive ? ', currently active' : ''}`}
                    accessibilityHint={isActive ? 'Tap to remove filter and show all bounties' : `Tap to filter bounties by ${item.label}`}
                    accessibilityState={{ selected: isActive }}
                  >
                    <MaterialIcons
                      name={item.icon}
                      size={SIZING.ICON_SMALL}
                      color={isActive ? '#052e1b' : '#d1fae5'}
                      style={{ marginRight: SPACING.COMPACT_GAP }}
                      accessibilityElementsHidden={true}
                    />
                    <Text style={[styles.chipLabel, isActive && styles.chipLabelActive]}>{item.label}</Text>
                  </TouchableOpacity>
                )
              }}
            />
          </View>

          {/* Distance dropdown */}
          {distanceDropdownOpen && (
            distanceChipLayout ? (
              (() => {
                const windowWidth = Dimensions.get('window').width
                const dropdownWidth = Math.max(160, distanceChipLayout.width)
                let left = distanceChipLayout.x
                if (left + dropdownWidth > windowWidth - 8) {
                  left = Math.max(8, windowWidth - dropdownWidth - 8)
                }
                const top = distanceChipLayout.y + distanceChipLayout.height + 2
                return (
                  <View style={[styles.distanceDropdown, { position: 'absolute', left, top, width: dropdownWidth }]}>
                    {permission?.granted && userLocation ? (
                      DISTANCE_OPTIONS.map((m) => (
                        <TouchableOpacity key={m} onPress={() => { setDistanceFilter(distanceFilter === m ? null : m); setDistanceDropdownOpen(false) }} style={styles.distanceOption}>
                          <Text style={{ color: '#e6ffee', fontWeight: '700' }}>{m} mi</Text>
                        </TouchableOpacity>
                      ))
                    ) : (
                      <Text style={styles.dropdownNotice}>Location permission required to use distance filter.</Text>
                    )}
                  </View>
                )
              })()
            ) : (
              <View style={styles.distanceDropdown}>
                {permission?.granted && userLocation ? (
                  DISTANCE_OPTIONS.map((m) => (
                    <TouchableOpacity key={m} onPress={() => { setDistanceFilter(distanceFilter === m ? null : m); setDistanceDropdownOpen(false) }} style={styles.distanceOption}>
                      <Text style={{ color: '#e6ffee', fontWeight: '700' }}>{m} mi</Text>
                    </TouchableOpacity>
                  ))
                ) : (
                  <Text style={styles.dropdownNotice}>Location permission required to use distance filter.</Text>
                )}
              </View>
            )
          )}
        </Animated.View>
        <LinearGradient
          colors={['rgba(5,150,105,0.0)', 'rgba(5,150,105,0.25)', 'rgba(5,150,105,0.55)']}
          style={styles.gradientSeparator}
          pointerEvents="none"
        />
      </Animated.View>

      {/* Bounty List with scroll listener (content extends under BottomNav) */}
      <Animated.FlatList
        ref={bountyListRef}
        data={filteredBounties}
        keyExtractor={keyExtractor}
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: HEADER_EXPANDED + headerTopPad + 10,
          paddingBottom: 160,
        }}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: false })}
        scrollEventThrottle={16}
        onEndReachedThreshold={0.5}
        onEndReached={handleEndReached}
        ItemSeparatorComponent={ItemSeparator}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#ffffff" />}
        ListHeaderComponent={TrendingSection}
        ListEmptyComponent={EmptyListComponent}
        ListFooterComponent={ListFooterComponent}
        renderItem={renderBountyItem}
        removeClippedSubviews={true}
        maxToRenderPerBatch={10}
        updateCellsBatchingPeriod={100}
        initialNumToRender={8}
        windowSize={10}
        getItemLayout={getItemLayout}
      />
      {/* Subtle gradient fade behind BottomNav to imply depth */}
      <LinearGradient
        colors={['rgba(5,150,105,0)', 'rgba(5,150,105,0.5)', colors.background.secondary]}
        style={styles.bottomFade}
        pointerEvents="none"
      />
    </View>
  )
})

const styles = StyleSheet.create({
  dashboardArea: { flex: 1 },
  collapsingHeader: { position: 'absolute', left: 0, right: 0, top: 0, zIndex: 10, backgroundColor: colors.background.secondary },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.SCREEN_HORIZONTAL,
    paddingBottom: SPACING.COMPACT_GAP,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: HEADER_LAYOUT.iconToTitleGap,
    transform: [
      { translateX: -2 },
      { translateY: -1 },
    ],
  },
  searchWrapper: {
    paddingHorizontal: SPACING.SCREEN_HORIZONTAL,
    marginBottom: SPACING.COMPACT_GAP,
  },
  searchButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(5,46,27,0.35)',
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: SPACING.SCREEN_HORIZONTAL,
    minHeight: SIZING.MIN_TOUCH_TARGET,
  },
  searchIcon: { marginRight: SPACING.COMPACT_GAP },
  searchText: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: TYPOGRAPHY.SIZE_SMALL,
  },
  filtersRow: { paddingVertical: SPACING.COMPACT_GAP },
  gradientSeparator: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 40 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(5,46,27,0.2)',
    paddingHorizontal: 14,
    height: 36,
    borderRadius: 999,
    marginRight: SPACING.COMPACT_GAP,
    minHeight: SIZING.MIN_TOUCH_TARGET,
  },
  chipActive: { backgroundColor: '#a7f3d0' },
  chipLabel: {
    color: '#d1fae5',
    fontSize: TYPOGRAPHY.SIZE_SMALL,
    fontWeight: '600',
  },
  chipLabelActive: { color: '#052e1b' },
  disabledChip: { opacity: 0.5 },
  distanceDropdown: {
    position: 'absolute',
    top: 48,
    right: SPACING.SCREEN_HORIZONTAL,
    backgroundColor: 'rgba(2,44,34,0.9)',
    padding: SPACING.COMPACT_GAP,
    borderRadius: SPACING.COMPACT_GAP,
    zIndex: 60,
  },
  distanceOption: {
    paddingVertical: SPACING.COMPACT_GAP,
    paddingHorizontal: SPACING.ELEMENT_GAP,
  },
  dropdownNotice: {
    color: '#f3fff9',
    padding: SPACING.COMPACT_GAP,
    fontSize: TYPOGRAPHY.SIZE_XSMALL,
  },
  bottomFade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 140, zIndex: 50 },
  // Trending section styles
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
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  trendingCard: {
    width: 200,
    backgroundColor: 'rgba(0,0,0,0.2)',
    borderRadius: 12,
    padding: 12,
    marginRight: 10,
    borderWidth: 1,
    borderColor: 'rgba(252,211,77,0.2)',
  },
  trendingCardHeader: {
    marginBottom: 8,
  },
  trendingCardTitle: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 4,
  },
  trendingAmount: {
    color: '#6ee7b7',
    fontSize: 15,
    fontWeight: '700',
  },
  trendingHonorBadge: {
    backgroundColor: '#fcd34d',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    alignSelf: 'flex-start',
  },
  trendingHonorText: {
    color: '#065f46',
    fontSize: 10,
    fontWeight: '700',
  },
  trendingNewBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  trendingNewText: {
    color: '#6ee7b7',
    fontSize: 11,
    fontWeight: '500',
  },
})
