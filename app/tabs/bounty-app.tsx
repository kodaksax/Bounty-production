import { MaterialIcons } from "@expo/vector-icons"
import { useLocation } from 'app/hooks/useLocation'
import { MessengerScreen } from "app/tabs/messenger-screen"
import { PostingsScreen } from "app/tabs/postings-screen"
import { ProfileScreen } from "app/tabs/profile-screen"
import { WalletScreen } from "app/tabs/wallet-screen"
import { BountyListItem } from 'components/bounty-list-item'
import { ConnectionStatus } from 'components/connection-status'
import { NotificationsBell } from 'components/notifications-bell'
import { storage } from '../../lib/storage'
// Search moved to its own route (app/tabs/search.tsx) so we no longer render it inline.
import { BottomNav } from 'components/ui/bottom-nav'
import { BrandingLogo } from 'components/ui/branding-logo'
import { PostingsListSkeleton } from 'components/ui/skeleton-loaders'
import { LinearGradient } from 'expo-linear-gradient'
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ActivityIndicator, Alert, Animated, FlatList, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { WalletBalanceButton } from '../../components/ui/wallet-balance-button'
import { useAuthContext } from '../../hooks/use-auth-context'

import { useAdmin } from '../../lib/admin-context'
import { HEADER_LAYOUT, SIZING, SPACING, TYPOGRAPHY } from '../../lib/constants/accessibility'
import { bountyRequestService } from '../../lib/services/bounty-request-service'
import { bountyService } from '../../lib/services/bounty-service'
import type { Bounty as BountyType } from '../../lib/services/database.types'
import { locationService } from '../../lib/services/location-service'
import { searchService } from '../../lib/services/search-service'
import type { TrendingBounty } from '../../lib/types'
import { CURRENT_USER_ID } from '../../lib/utils/data-utils'
import { WalletProvider } from '../../lib/wallet-context'
// Calendar removed in favor of Profile as the last tab

// Use the proper Bounty type from database types
type Bounty = BountyType


function BountyAppInner() {
  const router = useRouter()
  const { screen } = useLocalSearchParams<{ screen?: string }>()
  const { isAdmin, isAdminTabEnabled } = useAdmin()
  // Get current user ID from auth context (reactive to auth state changes)
  const { session, isLoading } = useAuthContext()
  const currentUserId = session?.user?.id
  
  // Admin tab is only shown if user has admin permissions AND has enabled the toggle
  const showAdminTab = isAdmin && isAdminTabEnabled
  const [activeCategory, setActiveCategory] = useState<string | "all">("all")
  const allowedScreens = new Set(['bounty', 'wallet', 'postings', 'profile', 'create', 'admin'])
  const paramScreen = typeof screen === 'string' && screen.length > 0 && allowedScreens.has(screen) ? screen : 'bounty'
  const [activeScreen, setActiveScreen] = useState(paramScreen)
  const [showBottomNav, setShowBottomNav] = useState(true)
  // Removed inline search overlay state; navigation now handles search route.
  const [bounties, setBounties] = useState<Bounty[]>([])
  const [isLoadingBounties, setIsLoadingBounties] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  // Track bounty IDs the user has applied to (pending, accepted, or rejected)
  const [appliedBountyIds, setAppliedBountyIds] = useState<Set<string>>(new Set())
  // Track whether user applications have been loaded (prevents flash of unfiltered content)
  const [applicationsLoaded, setApplicationsLoaded] = useState(false)
  // removed unused error state
  const [refreshing, setRefreshing] = useState(false)
  // Trending bounties state
  const [trendingBounties, setTrendingBounties] = useState<TrendingBounty[]>([])
  const [isLoadingTrending, setIsLoadingTrending] = useState(true)
  const insets = useSafeAreaInsets()
  const scrollY = useRef(new Animated.Value(0)).current
  // Reference to the FlatList for scroll-to-top functionality
  const bountyListRef = useRef<FlatList>(null)
  // Ref for pagination offset to avoid dependency in useCallback
  const offsetRef = useRef(0)
  // Reduce header vertical padding to move content up ~25px while respecting safe area
  // Adjusted again (additional 25px upward) so total upward shift = 50px from original safe area top
  const headerTopPad = Math.max(insets.top - 50, 0)
  
  // Location hook for calculating real distances
  const { location: userLocation, permission } = useLocation()
  const [distanceFilter, setDistanceFilter] = useState<number | null>(null) // Max distance in miles, null = no filter

  // Collapsing header config (using standardized constants)
  const HEADER_EXPANDED = HEADER_LAYOUT.expandedHeight
  const HEADER_COLLAPSED = HEADER_LAYOUT.collapsedHeight
  const headerHeight = scrollY.interpolate({
    inputRange: [0, HEADER_EXPANDED - HEADER_COLLAPSED],
    outputRange: [HEADER_EXPANDED + headerTopPad, HEADER_COLLAPSED + headerTopPad],
    extrapolate: 'clamp'
  })
  const extraContentOpacity = scrollY.interpolate({
    inputRange: [0, 40, 80],
    outputRange: [1, 0.4, 0],
    extrapolate: 'clamp'
  })
  // list layout (single column)

  // Filter chips per design - memoized to prevent dependency issues
  const categories = useMemo(() => [
    { id: "crypto", label: "Crypto", icon: "attach-money" as const },
    { id: "remote", label: "Remote", icon: "inventory" as const },
    { id: "highpaying", label: "High Paying", icon: "payments" as const },
    // Insert distance as a synthetic chip so it renders inline between High Paying and For Honor
    { id: "distance", label: "Distance", icon: "near-me" as const, special: true },
    { id: "forkids", label: "For Honor", icon: "favorite" as const },
  ], [])

  const DISTANCE_OPTIONS = [5, 10, 25, 50]
  const [distanceDropdownOpen, setDistanceDropdownOpen] = useState(false)
  // Layout info for positioning the dropdown under the distance chip
  const [distanceChipLayout, setDistanceChipLayout] = useState<{ x: number; y: number; width: number; height: number } | null>(null)
  const distanceChipRef = useRef<any>(null)

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
    const hash = bountyLocation.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0)
    return 1 + ((hash % seed) % 15)
  }, [userLocation, permission])

  // Memoize distance calculations to avoid recalculating on each filter/sort
  const bountyDistances = useMemo(() => {
    const distances = new Map<string, number | null>();
    bounties.forEach(bounty => {
      distances.set(String(bounty.id), calculateDistance(bounty.location || ""));
    });
    return distances;
  }, [bounties, calculateDistance]);

  // Filter and sort bounties by category
  const filteredBounties = useMemo(() => {
    let list = [...bounties]
    
    // Filter out bounties the user has applied to (pending, accepted, or rejected)
    if (appliedBountyIds.size > 0) {
      list = list.filter((b) => !appliedBountyIds.has(String(b.id)))
    }
    
    if (activeCategory !== "all") {
      if (activeCategory === 'forkids') {
        // For Honor chip should show bounties marked as for-honor
        list = list.filter((b) => Boolean(b.is_for_honor))
      } else if (activeCategory === 'remote') {
        // Remote chip filters for online work type
        list = list.filter((b) => b.work_type === 'online')
      } else if (activeCategory === 'highpaying') {
        // High Paying: exclude for-honor, only paid bounties
        list = list.filter((b) => !b.is_for_honor && Number(b.amount) > 0)
      } else {
        // simple contains filter on title/description to simulate other categories
        list = list.filter((b) =>
          (b.title + " " + (b.description || "")).toLowerCase().includes(activeCategory.replace(/_/g, " ")),
        )
      }
    }
    
    // Apply distance filter if active (only for in-person bounties)
    if (distanceFilter !== null && userLocation && permission?.granted) {
      list = list.filter((b) => {
        // Don't filter out online/remote bounties or bounties with no location
        if (b.work_type === 'online') return true
        const distance = bountyDistances.get(String(b.id))
        // Keep bounties with no location data (they'll show "Location TBD")
        if (distance == null) return true
        return distance <= distanceFilter
      })
    }
    
    // Sorting
    if (activeCategory === "highpaying") {
      // Highest amount first
      list.sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0))
    } else {
      // default by proximity - null distances (missing location) go to end
      list.sort((a, b) => {
        const distA = bountyDistances.get(String(a.id))
        const distB = bountyDistances.get(String(b.id))
        // Put null/undefined distances at the end
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
    // Guard: don't load if no valid user or using fallback ID
    if (!currentUserId || currentUserId === CURRENT_USER_ID) {
      setApplicationsLoaded(true)
      return
    }
    try {
      // Get all bounty requests for the current user (pending, accepted, or rejected)
      const requests = await bountyRequestService.getAll({ userId: currentUserId })
      // Build a Set of bounty IDs the user has applied to
      const ids = new Set<string>(
        requests
          .filter(r => r.bounty_id != null)
          .map(r => String(r.bounty_id))
      )
      setAppliedBountyIds(ids)
    } catch (error) {
      console.error('Error loading user applications:', error)
      // Don't block the UI if this fails - just show all bounties
    } finally {
      setApplicationsLoaded(true)
    }
  }, [currentUserId])

  // Load bounties from backend
  const PAGE_SIZE = 20
  const loadBounties = useCallback(async ({ reset = false }: { reset?: boolean } = {}) => {
    if (reset) {
      setIsLoadingBounties(true)
    } else {
      setLoadingMore(true)
    }
    try {
      const pageOffset = reset ? 0 : offsetRef.current
      const fetchedBounties = await bountyService.getAll({ status: 'open', limit: PAGE_SIZE, offset: pageOffset })
      if (reset) {
        setBounties(fetchedBounties)
      } else {
        setBounties(prev => [...prev, ...fetchedBounties])
      }
      offsetRef.current = pageOffset + fetchedBounties.length
      setHasMore(fetchedBounties.length === PAGE_SIZE)
    } catch (error) {
      console.error('Error loading bounties:', error)
      if (reset) {
        setBounties([])
        setHasMore(false)
      }
    } finally {
      setIsLoadingBounties(false)
      setLoadingMore(false)
    }
  }, []) // Empty dependencies - uses ref for offset

  // Load trending bounties
  const loadTrendingBounties = useCallback(async () => {
    setIsLoadingTrending(true)
    try {
      const trending = await searchService.getTrendingBounties(5)
      setTrendingBounties(trending)
    } catch (error) {
      console.error('Error loading trending bounties:', error)
    } finally {
      setIsLoadingTrending(false)
    }
  }, [])

  // Load user applications when component mounts or user changes
  useEffect(() => {
    loadUserApplications()
  }, [loadUserApplications]) // Depend on stable function, which already tracks currentUserId

  // Load initial data on mount only
  useEffect(() => {
    loadBounties({ reset: true })
    loadTrendingBounties()
    // We intentionally run this only once on mount; callbacks are stable (empty dependency arrays).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Reload bounties when returning to bounty screen from other screens
  useEffect(() => {
    if (activeScreen === "bounty") {
      // Refresh when returning to the bounty tab - also refresh applications and trending
      loadBounties({ reset: true })
      loadUserApplications()
      loadTrendingBounties()
    }
  }, [activeScreen, loadBounties, loadUserApplications, loadTrendingBounties]) // Depend on stable primitives and functions

  // Restore last-selected chip on mount
  useEffect(() => {
    (async () => {
      try {
        const saved = await storage.getItem('BE:lastFilter')
        if (saved) setActiveCategory(saved as any)
      } catch {}
    })()
  }, [])

  // Persist chip selection
  useEffect(() => {
    (async () => {
      try {
        await storage.setItem('BE:lastFilter', String(activeCategory))
      } catch {}
    })()
  }, [activeCategory])

  // Pull-to-refresh handler - reload data from backend
  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      // Reset pagination and reload first page, also refresh applications and trending
      offsetRef.current = 0
      setHasMore(true)
      await Promise.all([
        loadBounties({ reset: true }),
        loadUserApplications().catch(err => {
          console.error('Failed to refresh user applications:', err);
        }),
        loadTrendingBounties().catch(err => {
          console.error('Failed to refresh trending bounties:', err);
        })
      ])
    } catch (error) {
      console.error('Error refreshing bounties:', error)
    } finally {
      setRefreshing(false)
    }
  }, [loadBounties, loadUserApplications, loadTrendingBounties]) // Depend on stable functions

  // Handler for when bounty tab is pressed while already active - scroll to top and refresh
  const handleBountyTabRepress = useCallback(() => {
    // Scroll to top
    bountyListRef.current?.scrollToOffset({ offset: 0, animated: true })
    // Trigger refresh
    onRefresh()
  }, [onRefresh])

  // Ensure activeCategory matches available filters
  useEffect(() => {
    const ids = categories.map((c) => c.id)
    if (activeCategory !== "all" && !ids.includes(String(activeCategory))) {
      setActiveCategory("all")
    }
  }, [categories, activeCategory])

  // Removed early return of SearchScreen; will render as overlay so nav & state persist.

  // If the admin tab is selected, navigate to the admin route from an effect
  // to avoid triggering navigation/state updates during render (which causes
  // the "Cannot update a component while rendering a different component" error).
  useEffect(() => {
    if (activeScreen === 'admin' && showAdminTab) {
      // Perform navigation once when admin tab becomes active
      router.push('/(admin)')
    }
  }, [activeScreen, showAdminTab, router])

  // FlatList optimization: memoized functions
  const keyExtractor = useCallback((item: Bounty) => item.id.toString(), []);

  const getItemLayout = useCallback((_data: any, index: number) => ({
    length: 90, // Item height (88) + ItemSeparatorComponent height (2)
    offset: 90 * index,
    index
  }), []);

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
  }, [bountyDistances, calculateDistance]);

  const handleEndReached = useCallback(() => {
    if (!isLoadingBounties && !loadingMore && hasMore) {
      loadBounties()
    }
  }, [isLoadingBounties, loadingMore, hasMore, loadBounties]);

  const ItemSeparator = useCallback(() => <View style={{ height: 2 }} />, []);

  const EmptyListComponent = useCallback(() => (
    <View style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: 64 }}>
      {isLoadingBounties || !applicationsLoaded ? (
        <View style={{ width: '100%' }}>
          <PostingsListSkeleton count={5} />
        </View>
      ) : (
        <>
          <Text style={{ color: '#e5e7eb', marginBottom: 8 }}>No bounties match this filter.</Text>
          <TouchableOpacity onPress={() => setActiveCategory('all')} style={{ backgroundColor: '#a7f3d0', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999 }}>
            <Text style={{ color: '#052e1b', fontWeight: '700' }}>Clear filter</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  ), [isLoadingBounties, applicationsLoaded]);

  const ListFooterComponent = useCallback(() => (
    loadingMore ? (
      <View style={{ paddingVertical: 8 }}>
        <PostingsListSkeleton count={2} />
      </View>
    ) : null
  ), [loadingMore]);

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
      );
    }

    if (trendingBounties.length === 0) {
      return null;
    }

    // Helper to calculate how new a bounty is with safe date parsing
    const getAgeBadge = (createdAt: string | undefined | null): string | null => {
      if (!createdAt) return null;
      const date = new Date(createdAt);
      if (isNaN(date.getTime())) return null;
      
      const hours = (Date.now() - date.getTime()) / (1000 * 60 * 60);
      if (hours < 24) return 'New today';
      if (hours < 48) return 'Yesterday';
      if (hours < 72) return '2 days ago';
      return null;
    };

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
            const ageBadge = getAgeBadge(item.createdAt);
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
            );
          })}
        </ScrollView>
      </View>
    );
  }, [isLoadingTrending, trendingBounties, router]);

  // Render dashboard content when activeScreen is "bounty"
  const renderDashboardContent = () => (
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
                        // If a distance is already selected, pressing the chip clears it (toggle-off)
                        if (distanceFilter) {
                          setDistanceFilter(null)
                          setDistanceDropdownOpen(false)
                          return
                        }
                        // If dropdown is already open and no distance is selected, close it (tapped again without selection)
                        if (distanceDropdownOpen && !distanceFilter) {
                          setDistanceDropdownOpen(false)
                          return
                        }
                        // Measure chip position in window coordinates so we can anchor the dropdown below it
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
            // If we have a measured chip layout use absolute positioning anchored under the chip
            distanceChipLayout ? (
              (() => {
                const windowWidth = require('react-native').Dimensions.get('window').width
                const dropdownWidth = Math.max(160, distanceChipLayout.width)
                let left = distanceChipLayout.x
                // Clamp so dropdown doesn't overflow screen
                if (left + dropdownWidth > windowWidth - 8) {
                  left = Math.max(8, windowWidth - dropdownWidth - 8)
                }
                const top = distanceChipLayout.y + distanceChipLayout.height + 2
                return (
                  <View style={[styles.distanceDropdown, { position: 'absolute', left, top, width: dropdownWidth }] }>
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
          colors={["rgba(5,150,105,0.0)", "rgba(5,150,105,0.25)", "rgba(5,150,105,0.55)"]}
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
          paddingBottom: 160, // large enough so last item scrolls beneath nav
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
        // Performance optimizations
        removeClippedSubviews={true}
        maxToRenderPerBatch={10}
        updateCellsBatchingPeriod={100}
        initialNumToRender={8}
        windowSize={10}
        getItemLayout={getItemLayout}
      />
      {/* Subtle gradient fade behind BottomNav to imply depth */}
      <LinearGradient
        colors={["rgba(5,150,105,0)", "rgba(5,150,105,0.5)", "#059669"]}
        style={styles.bottomFade}
        pointerEvents="none"
      />
    </View>
  )

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-emerald-600">
        <ActivityIndicator size="large" color="#10b981" />
        <Text className="text-white mt-4 text-base">Loading...</Text>
      </View>
    )
  }

  if (!session) {
    if (__DEV__) {
      console.log('[bounty-app] Not authenticated, redirecting to index')
    }
    return <Redirect href="/" />
  }

  return (
    <View style={styles.container}>
      {/* Connection Status Banner - appears at top when offline */}
      <ConnectionStatus showQueueCount={true} />
      
      {activeScreen === "bounty" ? (
        renderDashboardContent()
      ) : activeScreen === "wallet" ? (
        <WalletScreen onBack={() => setActiveScreen("bounty")} />
      ) : activeScreen === "postings" ? (
        <PostingsScreen 
          onBack={() => setActiveScreen("bounty")} 
          activeScreen={activeScreen} 
          setActiveScreen={setActiveScreen}
          onBountyPosted={() => loadBounties({ reset: true })} // Refresh bounties when a new one is posted
          onBountyAccepted={() => loadBounties({ reset: true })} // Refresh bounties when a bounty is accepted
          setShowBottomNav={setShowBottomNav}
        />
      ) : activeScreen === "profile" ? (
        <ProfileScreen onBack={() => setActiveScreen("bounty")} />
      ) : activeScreen === "create" ? (
        <MessengerScreen
          activeScreen={activeScreen}
          onNavigate={setActiveScreen}
          onConversationModeChange={() => setShowBottomNav(true)}
        />
      ) : activeScreen === "admin" && showAdminTab ? (
        // admin navigation is handled by effect to avoid updating navigation during render
        null
      ) : null}

      {showBottomNav && <BottomNav activeScreen={activeScreen} onNavigate={setActiveScreen} showAdmin={showAdminTab} onBountyTabRepress={handleBountyTabRepress} />}
    </View>
    )
}

export function BountyApp() {
  return (
    <WalletProvider>
      <BountyAppInner />
    </WalletProvider>
  )
}

// Styles (consolidated with standardized spacing and sizing)
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#059669', position: 'relative' },
  dashboardArea: { flex: 1 },
  collapsingHeader: { position: 'absolute', left: 0, right: 0, top: 0, zIndex: 10, backgroundColor: '#059669' },
  headerRow: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'space-between', 
    paddingHorizontal: SPACING.SCREEN_HORIZONTAL, 
    paddingBottom: SPACING.COMPACT_GAP 
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
  headerTitle: { 
    fontSize: HEADER_LAYOUT.titleFontSize, 
    fontWeight: 'bold', 
    color: '#ffffff', 
    letterSpacing: TYPOGRAPHY.LETTER_SPACING_WIDE 
  },
  balanceContainer: {
    minWidth: SIZING.MIN_TOUCH_TARGET,
    minHeight: SIZING.MIN_TOUCH_TARGET,
    justifyContent: 'center',
    alignItems: 'flex-end',
  },
  balanceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#047857',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#6ee7b7',
  },
  headerBalance: { 
    fontSize: 14, 
    fontWeight: 'bold', 
    color: '#ffffff' 
  },
  searchWrapper: { 
    paddingHorizontal: SPACING.SCREEN_HORIZONTAL, 
    marginBottom: SPACING.COMPACT_GAP 
  },
  searchButton: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    backgroundColor: 'rgba(5,46,27,0.35)', 
    borderRadius: 999, 
    paddingVertical: 10, 
    paddingHorizontal: SPACING.SCREEN_HORIZONTAL,
    minHeight: SIZING.MIN_TOUCH_TARGET 
  },
  searchIcon: { marginRight: SPACING.COMPACT_GAP },
  searchText: { 
    color: 'rgba(255,255,255,0.85)', 
    fontSize: TYPOGRAPHY.SIZE_SMALL 
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
    minHeight: SIZING.MIN_TOUCH_TARGET 
  },
  chipActive: { backgroundColor: '#a7f3d0' },
  chipLabel: { 
    color: '#d1fae5', 
    fontSize: TYPOGRAPHY.SIZE_SMALL, 
    fontWeight: '600' 
  },
  chipLabelActive: { color: '#052e1b' },
  distanceChip: { 
    backgroundColor: 'rgba(5,46,27,0.2)', 
    paddingHorizontal: SPACING.ELEMENT_GAP, 
    height: 28, 
    borderRadius: 14, 
    justifyContent: 'center', 
    alignItems: 'center' 
  },
  distanceChipActive: { backgroundColor: '#6ee7b7' },
  distanceChipLabel: { 
    color: '#d1fae5', 
    fontSize: TYPOGRAPHY.SIZE_XSMALL, 
    fontWeight: '600' 
  },
  distanceChipLabelActive: { color: '#052e1b' },
  distanceClearButton: { 
    width: SIZING.ICON_LARGE, 
    height: SIZING.ICON_LARGE, 
    borderRadius: SIZING.ICON_LARGE / 2, 
    backgroundColor: 'rgba(239,68,68,0.3)', 
    justifyContent: 'center', 
    alignItems: 'center' 
  },
  bottomFade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 140, zIndex: 50 },
  disabledChip: { opacity: 0.5 },
  distanceDropdown: { 
    position: 'absolute', 
    top: 48, 
    right: SPACING.SCREEN_HORIZONTAL, 
    backgroundColor: 'rgba(2,44,34,0.9)', 
    padding: SPACING.COMPACT_GAP, 
    borderRadius: SPACING.COMPACT_GAP, 
    zIndex: 60 
  },
  distanceOption: { 
    paddingVertical: SPACING.COMPACT_GAP, 
    paddingHorizontal: SPACING.ELEMENT_GAP 
  },
  dropdownNotice: { 
    color: '#f3fff9', 
    padding: SPACING.COMPACT_GAP, 
    fontSize: TYPOGRAPHY.SIZE_XSMALL 
  },
  // Trending section styles
  trendingSection: {
    marginBottom: 16,
    marginHorizontal: -16, // Compensate for FlatList container padding
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
  trendingStats: {
    flexDirection: 'row',
    gap: 12,
  },
  trendingStat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  trendingStatText: {
    color: '#a7f3d0',
    fontSize: 12,
  },
  // searchOverlay removed (search is its own route now)
})
export default function BountyAppRoute() {
  return <BountyApp />
}
