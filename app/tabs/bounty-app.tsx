import { MaterialIcons } from "@expo/vector-icons"
import AsyncStorage from '@react-native-async-storage/async-storage'
import { LocationScreen } from "app/tabs/location-screen"
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
import { Animated, FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useNormalizedProfile } from '../../hooks/useNormalizedProfile'
import { useUserProfile } from '../../hooks/useUserProfile'
import { useAdmin } from '../../lib/admin-context'
import { bountyService } from '../../lib/services/bounty-service'
import type { Bounty as BountyType } from '../../lib/services/database.types'
import { WalletProvider, useWallet } from '../../lib/wallet-context'

// Calendar removed in favor of Profile as the last tab

// Use the proper Bounty type from database types
type Bounty = BountyType


function BountyAppInner() {
  const router = useRouter()
  const { screen } = useLocalSearchParams<{ screen?: string }>()
  const { isAdmin } = useAdmin()
  const [activeCategory, setActiveCategory] = useState<string | "all">("all")
  const allowedScreens = new Set(['bounty', 'wallet', 'postings', 'location', 'profile', 'create', 'admin'])
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
  
  // Check if onboarding is needed (useUserProfile provides completeness)
  const { isComplete, loading: profileLoading } = useUserProfile()
  // Use normalized profile for display in the UI where needed
  const { profile: normalizedProfile } = useNormalizedProfile()
  const [hasCheckedOnboarding, setHasCheckedOnboarding] = useState(false)

  // Collapsing header config
  const HEADER_EXPANDED = 150
  const HEADER_COLLAPSED = 60
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
    { id: "forkids", label: "For Honor", icon: "favorite" as const },
  ], [])

  // Calculate distance (mock function - in a real app, this would use geolocation)
  const calculateDistance = (location: string) => {
    // More deterministic mock distance calculation based on location string
    if (!location) return 20 // Default for empty locations

    // Use the string length as a seed for a more consistent but still random-looking distance
    const seed = location.length
    const hash = location.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0)

    // Generate a distance between 1 and 15 miles
    return 1 + ((hash % seed) % 15)
  }

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
    // Sorting
    if (activeCategory === "highpaying") {
      // Highest amount first
      list.sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0))
    } else {
      // default by proximity
      list.sort((a, b) => calculateDistance(a.location || "") - calculateDistance(b.location || ""))
    }
    return list
  }, [bounties, activeCategory])

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
        username="@Jon_Doe"
        price={Number(item.amount)}
        distance={distance}
        description={item.description}
        isForHonor={Boolean(item.is_for_honor)}
      />
    )
  }, []);

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
            <MaterialIcons name="gps-fixed" size={24} color="#ffffff" />
            <Animated.Text style={[styles.headerTitle, { transform: [{ scale: titleScale }] }]}>BOUNTY</Animated.Text>
          </View>
          <TouchableOpacity onPress={() => setActiveScreen('wallet')}>
            <Text style={styles.headerBalance}>$ {balance.toFixed(2)}</Text>
          </TouchableOpacity>
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
          {/* Filter Chips */}
          <View style={styles.filtersRow}>
            <FlatList
              horizontal
              showsHorizontalScrollIndicator={false}
              data={categories}
              keyExtractor={(item) => item.id}
              contentContainerStyle={{ paddingHorizontal: 16 }}
              renderItem={({ item }) => {
                const isActive = activeCategory === item.id
                return (
                  <TouchableOpacity
                    onPress={() => setActiveCategory(isActive ? 'all' : (item.id as any))}
                    style={[styles.chip, isActive && styles.chipActive]}
                  >
                    <MaterialIcons
                      name={item.icon}
                      size={16}
                      color={isActive ? '#052e1b' : '#d1fae5'}
                      style={{ marginRight: 8 }}
                    />
                    <Text style={[styles.chipLabel, isActive && styles.chipLabelActive]}>{item.label}</Text>
                  </TouchableOpacity>
                )
              }}
            />
          </View>
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
          paddingTop: HEADER_EXPANDED + headerTopPad + 8,
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
          setShowBottomNav={setShowBottomNav}
        />
      ) : activeScreen === "location" ? (
        <LocationScreen />
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

// Styles (consolidated)
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#059669', position: 'relative' },
  dashboardArea: { flex: 1 },
  collapsingHeader: { position: 'absolute', left: 0, right: 0, top: 0, zIndex: 10, backgroundColor: '#059669' },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 8 },
  headerLeft: { flexDirection: 'row', alignItems: 'center' },
  headerTitle: { marginLeft: 8, fontSize: 20, fontWeight: 'bold', color: '#ffffff', letterSpacing: 1 },
  headerBalance: { fontSize: 18, fontWeight: 'bold', color: '#ffffff' },
  searchWrapper: { paddingHorizontal: 16, marginBottom: 8 },
  searchButton: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(5,46,27,0.35)', borderRadius: 999, paddingVertical: 10, paddingHorizontal: 16 },
  searchIcon: { marginRight: 8 },
  searchText: { color: 'rgba(255,255,255,0.85)', fontSize: 14 },
  filtersRow: { paddingVertical: 8 },
  gradientSeparator: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 40 },
  chip: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(5,46,27,0.2)', paddingHorizontal: 14, height: 36, borderRadius: 999, marginRight: 8 },
  chipActive: { backgroundColor: '#a7f3d0' },
  chipLabel: { color: '#d1fae5', fontSize: 14, fontWeight: '600' },
  chipLabelActive: { color: '#052e1b' },
  bottomFade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 140, zIndex: 50 },
  // searchOverlay removed (search is its own route now)
})
export default function BountyAppRoute() {
  return <BountyApp />
}
