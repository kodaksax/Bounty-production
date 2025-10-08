import { MaterialIcons } from "@expo/vector-icons"
import AsyncStorage from '@react-native-async-storage/async-storage'
import { MessengerScreen } from "app/tabs/messenger-screen"
import { PostingsScreen } from "app/tabs/postings-screen"
import { ProfileScreen } from "app/tabs/profile-screen"
import { WalletScreen } from "app/tabs/wallet-screen"
import { BountyListItem } from 'components/bounty-list-item'
import { NetworkStatusBar } from 'components/network-status'
import { SearchScreen } from "app/tabs/search-screen"
import { BottomNav } from 'components/ui/bottom-nav'
import { BountyEmptyState } from 'components/ui/empty-state'
import { FogEffect } from 'components/ui/fog-effect'
import { BountySkeleton } from 'components/ui/skeleton-loading'
import { LinearGradient } from 'expo-linear-gradient'
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Animated, FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { WalletProvider, useWallet } from '../../lib/wallet-context'

// Calendar removed in favor of Profile as the last tab

// Define the Bounty type here if not exported from data-utils
type Bounty = {
  id: string
  user_id: string
  title: string
  amount: number | string
  location?: string
  description?: string
}


function BountyAppInner() {
  const [activeCategory, setActiveCategory] = useState<string | "all">("all")
  const [activeScreen, setActiveScreen] = useState("bounty")
  const [showBottomNav, setShowBottomNav] = useState(true)
  const [showSearch, setShowSearch] = useState(false)
  const [bounties, setBounties] = useState<Bounty[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const { balance } = useWallet()
  // removed unused error state
  const [refreshing, setRefreshing] = useState(false)
  const insets = useSafeAreaInsets()
  const scrollY = useRef(new Animated.Value(0)).current
  // Reduce header vertical padding to move content up ~25px while respecting safe area
  // Adjusted again (additional 25px upward) so total upward shift = 50px from original safe area top
  const headerTopPad = Math.max(insets.top - 50, 0)

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

  // Filter chips per design
  const categories = [
    { id: "crypto", label: "Crypto", icon: "attach-money" as const },
    { id: "remote", label: "Remote", icon: "inventory" as const },
    { id: "highpaying", label: "High Paying", icon: "payments" as const },
    { id: "forkids", label: "For Honor", icon: "favorite" as const },
  ]

  // Calculate distance (mock function - in a real app, this would use geolocation)
  const calculateDistance = useCallback((location: string) => {
    // More deterministic mock distance calculation based on location string
    if (!location) return 20 // Default for empty locations

    // Use the string length as a seed for a more consistent but still random-looking distance
    const seed = location.length
    const hash = location.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0)

    // Generate a distance between 1 and 15 miles
    return 1 + ((hash % seed) % 15)
  }, [])

  // Filter and sort bounties by category
  const filteredBounties = useMemo(() => {
    let list = [...bounties]
    if (activeCategory !== "all") {
      // simple contains filter on title/description to simulate
      list = list.filter((b) =>
        (b.title + " " + (b.description || "")).toLowerCase().includes(activeCategory.replace(/_/g, " ")),
      )
    }
    // High paying sorts by amount when selected
    if (activeCategory === "highpaying") {
      list.sort((a, b) => Number(b.amount) - Number(a.amount))
    } else {
      // default by proximity
      list.sort((a, b) => calculateDistance(a.location || "") - calculateDistance(b.location || ""))
    }
    return list
  }, [bounties, activeCategory])

  // Placeholder data until backend is connected
  useEffect(() => {
    const placeholders: Bounty[] = [
      { id: "1", user_id: "u1", title: "Mow My lawn!!!", amount: 60, location: "Downtown" },
      { id: "2", user_id: "u2", title: "Delivering a Package", amount: 60, location: "Midtown" },
      { id: "3", user_id: "u3", title: "Find my fathers murderer", amount: 500, location: "Uptown" },
      { id: "4", user_id: "u4", title: "Help setting up crypto wallet", amount: 45, location: "Westside" },
      { id: "5", user_id: "u5", title: "Coffee delivery service", amount: 15, location: "Eastside" },
      { id: "6", user_id: "u6", title: "Birthday party helper", amount: 80, location: "Riverside" },
      { id: "7", user_id: "u7", title: "Yard cleanup", amount: 55, location: "Lakeside" },
      { id: "8", user_id: "u8", title: "Assemble furniture", amount: 70, location: "Heights" },
    ]
    setBounties(placeholders)
    setIsLoading(false)
  }, [])

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

  // Pull-to-refresh handler
  const onRefresh = useCallback(() => {
    setRefreshing(true)
    // Simulate network refresh; replace with real fetch later
    setTimeout(() => {
      // e.g., you could reshuffle placeholder order here
      setRefreshing(false)
    }, 800)
  }, [])

  // Ensure activeCategory matches available filters
  useEffect(() => {
    const ids = categories.map((c) => c.id)
    if (activeCategory !== "all" && !ids.includes(String(activeCategory))) {
      setActiveCategory("all")
    }
  }, [categories, activeCategory])

  // Optimized render functions (extracted to avoid inline recreation)
  const ItemSeparator = useCallback(() => <View style={{ height: 2.8 }} />, [])
  
  const EmptyListComponent = useCallback(() => (
    <View style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: 64 }}>
      <Text style={{ color: '#e5e7eb', marginBottom: 8 }}>No bounties match this filter.</Text>
      <TouchableOpacity onPress={() => setActiveCategory('all')} style={{ backgroundColor: '#a7f3d0', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999 }}>
        <Text style={{ color: '#052e1b', fontWeight: '700' }}>Clear filter</Text>
      </TouchableOpacity>
    </View>
  ), [])

  const renderBountyItem = useCallback(({ item }: { item: Bounty }) => {
    const distance = calculateDistance(item.location || '')
    const numericId = typeof item.id === 'number' ? item.id : Number(String(item.id).replace(/\D/g, '')) || Math.abs([...String(item.id)].reduce((acc, ch) => acc + ch.charCodeAt(0), 0))
    return (
      <BountyListItem
        key={item.id}
        id={numericId}
        title={item.title}
        username="@Jon_Doe"
        price={Number(item.amount)}
        distance={distance}
      />
    )
  }, [calculateDistance])

  if (showSearch) {
    return <SearchScreen onBack={() => setShowSearch(false)} />
  }


  // Render dashboard content when activeScreen is "bounty"
  const renderDashboardContent = () => (
    <View style={styles.dashboardArea}>
      {/* Collapsing Header */}
  <Animated.View style={[styles.collapsingHeader, { height: headerHeight, paddingTop: headerTopPad }]}> 
        <View style={styles.headerRow}> 
          <View style={styles.headerLeft}> 
            <MaterialIcons name="gps-fixed" size={24} color="#fffef5" />
            <Animated.Text style={[styles.headerTitle, { transform: [{ scale: titleScale }] }]}>BOUNTY</Animated.Text>
          </View>
          <TouchableOpacity 
            onPress={() => setActiveScreen('wallet')}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel={`Wallet balance: $${balance.toFixed(2)}`}
            accessibilityHint="Tap to view wallet and transaction history"
          >
            <Text style={styles.headerBalance}>$ {balance.toFixed(2)}</Text>
          </TouchableOpacity>
        </View>
        <Animated.View style={{ opacity: extraContentOpacity }}>
          {/* Search Bar */}
          <View style={styles.searchWrapper}>
            <TouchableOpacity 
              accessibilityRole="button" 
              onPress={() => setShowSearch(true)} 
              style={styles.searchButton}
              accessible={true}
              accessibilityLabel="Search bounties and users"
              accessibilityHint="Tap to open search screen"
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
                    accessible={true}
                    accessibilityRole="button"
                    accessibilityLabel={`Filter by ${item.label}`}
                    accessibilityState={{ selected: isActive }}
                    accessibilityHint={isActive ? "Tap to clear filter" : `Filter bounties by ${item.label} category`}
                  >
                    <MaterialIcons
                      name={item.icon}
                      size={16}
                      color={isActive ? '#1a3d2e' : '#c3c3c4'}
                      style={{ marginRight: 8 }}
                      accessibilityElementsHidden={true}
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

      {/* Bounty List with scroll listener */}
      <NetworkStatusBar />
      <Animated.FlatList
        data={filteredBounties}
        keyExtractor={(item) => item.id}
        // Allow content to scroll underneath the BottomNav by removing large bottom padding.
        // This makes the bottom of the list visually disappear behind the nav bar.
        contentContainerStyle={{ paddingHorizontal: 17, paddingTop: HEADER_EXPANDED + headerTopPad + 0, paddingBottom: 0, marginTop: 1 }}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: false })}
        scrollEventThrottle={16}
        ItemSeparatorComponent={ItemSeparator}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#ffffff" />}
        ListEmptyComponent={EmptyListComponent}
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
    </View>
  )


  return (
    <View style={styles.container}>
      {/* VANTA.FOG-like effect background */}
      <FogEffect 
        intensity={4}
        speed={0.8}
        color="#00912C"
        opacity={0.12}
      />

      {/* Top gradient covering safe area (status bar) for consistent highlight */}
      <LinearGradient
        colors={["#2d5240", "#1a3d2e90", "#1a3d2e00"]}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: headerTopPad + 60, // cover status bar + slight fade
          zIndex: 5,
        }}
        pointerEvents="none"
      />

      {/* Bottom fade so list items appear to disappear behind nav */}
      <LinearGradient
        colors={["rgba(26,61,46,0)", "rgba(26,61,46,0.75)", "#1a3d2e"]}
        style={{ position: 'absolute', left: 0, right: 0, bottom: 50, height: 80, zIndex: 50 }}
        pointerEvents="none"
      />
      
      {activeScreen === "bounty" ? (
        renderDashboardContent()
      ) : activeScreen === "wallet" ? (
        <WalletScreen onBack={() => setActiveScreen("bounty")} />
      ) : activeScreen === "postings" ? (
        <PostingsScreen onBack={() => setActiveScreen("bounty")} activeScreen={activeScreen} setActiveScreen={setActiveScreen} />
      ) : activeScreen === "profile" ? (
        <ProfileScreen onBack={() => setActiveScreen("bounty")} />
      ) : activeScreen === "create" ? (
        <MessengerScreen
          activeScreen={activeScreen}
          onNavigate={setActiveScreen}
          onConversationModeChange={(inConv) => setShowBottomNav(!inConv)}
        />
      ) : null}

      {showBottomNav && <BottomNav activeScreen={activeScreen} onNavigate={setActiveScreen} />}
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

// Styles (consolidated) - Enhanced spy-like aesthetic with lighter green base for fog contrast
const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: '#1a3d2e', // Updated to use new primary background
    position: 'relative'
  },
  dashboardArea: { flex: 1 },
  collapsingHeader: { 
    position: 'absolute', 
    left: 0, 
    right: 0, 
    top: 0, 
    zIndex: 10, 
    backgroundColor: '#2d5240', // Updated to use new secondary background
    // Add subtle gradient overlay
    shadowColor: '#00912C', // Company specified primary green base
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 8,
  },
  headerRow: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'space-between', 
    paddingHorizontal: 16, 
    paddingBottom: 12 
  },
  headerLeft: { 
    flexDirection: 'row', 
    alignItems: 'center' 
  },
  headerTitle: { 
    marginLeft: 8, 
    fontSize: 20, 
    fontWeight: '700', 
    color: '#fffef5', // Company specified header text/logos color
    letterSpacing: 1.2,
    // Add subtle text shadow
    textShadowColor: '#00912C', // Company specified primary green base
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 8,
  },
  headerBalance: { 
    fontSize: 18, 
    fontWeight: '600', 
    color: '#fffef5', // Company specified header text/logos color
    // Add premium styling
    backgroundColor: 'rgba(0, 145, 44, 0.1)', // Using company specified primary green
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.2)',
  },
  searchWrapper: { 
    paddingHorizontal: 16, 
    marginBottom: 12 
  },
  searchButton: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    backgroundColor: 'rgba(16, 97, 62, 0.6)', // lighter emerald with opacity for better fog contrast
    borderRadius: 16, 
    paddingVertical: 10, 
    paddingHorizontal: 18,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.35)', // more visible emerald border
    // Add glass-morphism effect
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 4,
  },
  searchIcon: { 
    marginRight: 10 
  },
  searchText: { 
    color: 'rgba(255,255,255,0.75)', 
    fontSize: 15,
    fontWeight: '400',
  },
  filtersRow: { 
    paddingVertical: 10 
  },
  gradientSeparator: { 
    position: 'absolute', 
    left: 0, 
    right: 0, 
    bottom: 0, 
    height: 10 
  },
  chip: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    backgroundColor: 'rgba(16, 97, 62, 0.5)', // lighter emerald base for better fog contrast
    paddingHorizontal: 16, 
    height: 28, 
    borderRadius: 20, 
    marginRight: 10,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.45)', // more visible emerald border
    // Add subtle shadow
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  chipActive: { 
    backgroundColor: 'rgba(0, 145, 44, 0.15)', // Using company specified primary green
    borderColor: 'rgba(0, 145, 44, 0.4)', // Using company specified primary green
    // Add glow effect for active state
    shadowColor: '#00912C', // Company specified primary green base
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  chipLabel: { color: '#c3c3c4', fontSize: 14, fontWeight: '600' }, // Company specified subtle highlight color
  chipLabelActive: { color: '#1a3d2e' }, // Updated to use new primary background
})
