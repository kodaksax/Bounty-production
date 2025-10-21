import { MaterialIcons } from "@expo/vector-icons"
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useLocation } from 'app/hooks/useLocation'
import { MessengerScreen } from "app/tabs/messenger-screen"
import { PostingsScreen } from "app/tabs/postings-screen"
import { ProfileScreen } from "app/tabs/profile-screen"
import { WalletScreen } from "app/tabs/wallet-screen"
import { BountyListItem } from 'components/bounty-list-item'
// Search moved to its own route (app/tabs/search.tsx) so we no longer render it inline.
import { BottomNav } from 'components/ui/bottom-nav'
import { LinearGradient } from 'expo-linear-gradient'
import { useLocalSearchParams, useRouter } from 'expo-router'
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Alert, Animated, FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { WalletBalanceButton } from '../../components/ui/wallet-balance-button'
import { useNormalizedProfile } from '../../hooks/useNormalizedProfile'
import { useUserProfile } from '../../hooks/useUserProfile'
import { useAdmin } from '../../lib/admin-context'
import { HEADER_LAYOUT, SIZING, SPACING, TYPOGRAPHY } from '../../lib/constants/accessibility'
import { bountyService } from '../../lib/services/bounty-service'
import type { Bounty as BountyType } from '../../lib/services/database.types'
import { locationService } from '../../lib/services/location-service'
import { WalletProvider, useWallet } from '../../lib/wallet-context'
// Calendar removed in favor of Profile as the last tab

// Use the proper Bounty type from database types
type Bounty = BountyType


function BountyAppInner() {
  const router = useRouter()
  const { screen } = useLocalSearchParams<{ screen?: string }>()
  const { isAdmin } = useAdmin()
  const [activeCategory, setActiveCategory] = useState<string | "all">("all")
  const allowedScreens = new Set(['bounty', 'wallet', 'postings', 'profile', 'create', 'admin'])
  const paramScreen = typeof screen === 'string' && screen.length > 0 && allowedScreens.has(screen) ? screen : 'bounty'
  const [activeScreen, setActiveScreen] = useState(paramScreen)
  const [showBottomNav, setShowBottomNav] = useState(true)
  // Removed inline search overlay state; navigation now handles search route.
  const [bounties, setBounties] = useState<Bounty[]>([])
  const [isLoadingBounties, setIsLoadingBounties] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const { balance } = useWallet()
  // removed unused error state
  const [refreshing, setRefreshing] = useState(false)
  const insets = useSafeAreaInsets()
  const scrollY = useRef(new Animated.Value(0)).current
  // Reduce header vertical padding to move content up ~25px while respecting safe area
  // Adjusted again (additional 25px upward) so total upward shift = 50px from original safe area top
  const headerTopPad = Math.max(insets.top - 50, 0)
  
  // Location hook for calculating real distances
  const { location: userLocation, permission } = useLocation()
  const [distanceFilter, setDistanceFilter] = useState<number | null>(null) // Max distance in miles, null = no filter
  
  // Check if onboarding is needed (useUserProfile provides completeness)
  const { isComplete, loading: profileLoading } = useUserProfile()
  // Use normalized profile for display in the UI where needed
  const { profile: normalizedProfile } = useNormalizedProfile()
  const [hasCheckedOnboarding, setHasCheckedOnboarding] = useState(false)

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
  const titleScale = scrollY.interpolate({
    inputRange: [0, 80],
    outputRange: [1, 0.85],
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

  // Filter and sort bounties by category
  const filteredBounties = useMemo(() => {
    let list = [...bounties]
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
        const distance = calculateDistance(b.location || "")
        // Keep bounties with no location data (they'll show "Location TBD")
        if (distance === null) return true
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
        const distA = calculateDistance(a.location || "")
        const distB = calculateDistance(b.location || "")
        // Put null distances at the end
        if (distA === null && distB === null) return 0
        if (distA === null) return 1
        if (distB === null) return -1
        return distA - distB
      })
    }
    return list
  }, [bounties, activeCategory, distanceFilter, userLocation, permission, calculateDistance])

  // Load bounties from backend
  const PAGE_SIZE = 20
  const loadBounties = useCallback(async ({ reset = false }: { reset?: boolean } = {}) => {
    if (reset) {
      setIsLoadingBounties(true)
    } else {
      setLoadingMore(true)
    }
    try {
      const pageOffset = reset ? 0 : offset
      const fetchedBounties = await bountyService.getAll({ status: 'open', limit: PAGE_SIZE, offset: pageOffset })
      if (reset) {
        setBounties(fetchedBounties)
      } else {
        setBounties(prev => [...prev, ...fetchedBounties])
      }
      setOffset(pageOffset + fetchedBounties.length)
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
  }, [offset])

  useEffect(() => {
    loadBounties({ reset: true })
  }, [loadBounties])

  // Reload bounties when returning to bounty screen from other screens
  useEffect(() => {
    if (activeScreen === "bounty") {
      // Refresh when returning to the bounty tab
      loadBounties({ reset: true })
    }
  }, [activeScreen, loadBounties])

  // Check if onboarding is needed and redirect
  useEffect(() => {
    if (!profileLoading && !hasCheckedOnboarding) {
      setHasCheckedOnboarding(true)
      if (!isComplete) {
        // Profile is incomplete, redirect to onboarding
        router.push('/onboarding/username')
      }
    }
  }, [profileLoading, isComplete, hasCheckedOnboarding, router])

  // Restore last-selected chip on mount
  useEffect(() => {
    (async () => {
      try {
        const saved = await AsyncStorage.getItem('BE:lastFilter')
        if (saved) setActiveCategory(saved as any)
      } catch {}
    })()
  }, [])

  // Persist chip selection
  useEffect(() => {
    (async () => {
      try {
        await AsyncStorage.setItem('BE:lastFilter', String(activeCategory))
      } catch {}
    })()
  }, [activeCategory])

  // Pull-to-refresh handler - reload data from backend
  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      // Reset pagination and reload first page
      setOffset(0)
      setHasMore(true)
      await loadBounties({ reset: true })
    } catch (error) {
      console.error('Error refreshing bounties:', error)
    } finally {
      setRefreshing(false)
    }
  }, [loadBounties])

  // Ensure activeCategory matches available filters
  useEffect(() => {
    const ids = categories.map((c) => c.id)
    if (activeCategory !== "all" && !ids.includes(String(activeCategory))) {
      setActiveCategory("all")
    }
  }, [categories, activeCategory])

  // Removed early return of SearchScreen; will render as overlay so nav & state persist.

  // FlatList optimization: memoized functions
  const keyExtractor = useCallback((item: Bounty) => item.id.toString(), []);

  const renderBountyItem = useCallback(({ item }: { item: Bounty }) => {
    const distance = calculateDistance(item.location || '')
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
  }, [calculateDistance]);

  const handleEndReached = useCallback(() => {
    if (!isLoadingBounties && !loadingMore && hasMore) {
      loadBounties()
    }
  }, [isLoadingBounties, loadingMore, hasMore, loadBounties]);

  const ItemSeparator = useCallback(() => <View style={{ height: 2 }} />, []);

  const EmptyListComponent = useCallback(() => (
    <View style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: 64 }}>
      {isLoadingBounties ? (
        <Text style={{ color: '#e5e7eb', marginBottom: 8 }}>Loading bounties...</Text>
      ) : (
        <>
          <Text style={{ color: '#e5e7eb', marginBottom: 8 }}>No bounties match this filter.</Text>
          <TouchableOpacity onPress={() => setActiveCategory('all')} style={{ backgroundColor: '#a7f3d0', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999 }}>
            <Text style={{ color: '#052e1b', fontWeight: '700' }}>Clear filter</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  ), [isLoadingBounties]);

  const ListFooterComponent = useCallback(() => (
    loadingMore ? (
      <View style={{ paddingVertical: 16, alignItems: 'center' }}>
        <Text style={{ color: '#e5e7eb' }}>Loading more...</Text>
      </View>
    ) : null
  ), [loadingMore]);

  // Render dashboard content when activeScreen is "bounty"
  const renderDashboardContent = () => (
    <View style={styles.dashboardArea}>
      {/* Collapsing Header */}
  <Animated.View style={[styles.collapsingHeader, { height: headerHeight, paddingTop: headerTopPad }]}> 
        <View style={styles.headerRow}> 
          <View style={styles.headerLeft}> 
            <MaterialIcons 
              name="gps-fixed" 
              size={HEADER_LAYOUT.iconSize} 
              color="#ffffff"
              accessibilityElementsHidden={true}
            />
            <Animated.Text 
              style={[styles.headerTitle, { transform: [{ scale: titleScale }] }]}
              accessibilityRole="header"
            >
              BOUNTY
            </Animated.Text>
          </View>
          <WalletBalanceButton onPress={() => setActiveScreen('wallet')} />
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
                        } catch (err) {
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
        ListEmptyComponent={EmptyListComponent}
        ListFooterComponent={ListFooterComponent}
        renderItem={renderBountyItem}
        // Performance optimizations
        removeClippedSubviews={true}
        maxToRenderPerBatch={10}
        updateCellsBatchingPeriod={100}
        initialNumToRender={8}
        windowSize={10}
        getItemLayout={(data, index) => (
          {length: 88, offset: 90 * index, index} // Approximate item height + margin
        )}
      />
      {/* Subtle gradient fade behind BottomNav to imply depth */}
      <LinearGradient
        colors={["rgba(5,150,105,0)", "rgba(5,150,105,0.5)", "#059669"]}
        style={styles.bottomFade}
        pointerEvents="none"
      />
    </View>
  )


  return (
    <View style={styles.container}>
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
          onConversationModeChange={(inConv) => setShowBottomNav(!inConv)}
        />
      ) : activeScreen === "admin" && isAdmin ? (
        // Navigate to admin route when admin tab is selected
        (() => {
          router.push('/(admin)')
          return null
        })()
      ) : null}

      {showBottomNav && <BottomNav activeScreen={activeScreen} onNavigate={setActiveScreen} showAdmin={isAdmin} />}
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
    gap: HEADER_LAYOUT.iconToTitleGap 
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
  // searchOverlay removed (search is its own route now)
})
export default function BountyAppRoute() {
  return <BountyApp />
}
