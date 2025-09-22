import { MaterialIcons } from "@expo/vector-icons"
import AsyncStorage from '@react-native-async-storage/async-storage'
import { MessengerScreen } from "app/tabs/messenger-screen"
import { PostingsScreen } from "app/tabs/postings-screen"
import { ProfileScreen } from "app/tabs/profile-screen"
import { WalletScreen } from "app/tabs/wallet-screen"
import { BountyListItem } from 'components/bounty-list-item'
import { SearchScreen } from "components/search-screen"
import { BottomNav } from 'components/ui/bottom-nav'
import React, { useCallback, useEffect, useMemo, useState } from "react"
import { FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native'

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


export function BountyApp() {
  const [activeCategory, setActiveCategory] = useState<string | "all">("all")
  const [activeScreen, setActiveScreen] = useState("bounty")
  const [showSearch, setShowSearch] = useState(false)
  const [bounties, setBounties] = useState<Bounty[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [userBalance] = useState(40)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  // list layout (single column)

  // Filter chips per design
  const categories = [
    { id: "crypto", label: "Crypto", icon: "attach-money" as const },
    { id: "remote", label: "Remote", icon: "inventory" as const },
    { id: "highpaying", label: "High Paying", icon: "payments" as const },
    { id: "forkids", label: "For Honor", icon: "favorite" as const },
  ]

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

  if (showSearch) {
    return <SearchScreen onBack={() => setShowSearch(false)} />
  }


  // Render dashboard content when activeScreen is "bounty"
  const renderDashboardContent = () => (
    <View style={styles.dashboardArea}>
      {/* Header */}
      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          <MaterialIcons name="gps-fixed" size={24} color="#000000" />
          <Text style={styles.headerTitle}>BOUNTY</Text>
        </View>
        <TouchableOpacity onPress={() => setActiveScreen('wallet')}>
          <Text style={styles.headerBalance}>$ 40.00</Text>
        </TouchableOpacity>
      </View>

      {/* Search Bar */}
      <View style={styles.searchWrapper}>
        <TouchableOpacity accessibilityRole="button" onPress={() => setShowSearch(true)} style={styles.searchButton}>
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

      {/* Bounty List */}
      <FlatList
        data={filteredBounties}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 140 }}
        ItemSeparatorComponent={() => <View style={{ height: 2 }} />}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#ffffff" />}
        ListEmptyComponent={() => (
          <View style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: 64 }}>
            <Text style={{ color: '#e5e7eb', marginBottom: 8 }}>No bounties match this filter.</Text>
            <TouchableOpacity onPress={() => setActiveCategory('all')} style={{ backgroundColor: '#a7f3d0', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999 }}>
              <Text style={{ color: '#052e1b', fontWeight: '700' }}>Clear filter</Text>
            </TouchableOpacity>
          </View>
        )}
        renderItem={({ item }) => {
          const distance = calculateDistance(item.location || '')
          const numericId = typeof item.id === 'number' ? item.id : Number(String(item.id).replace(/\D/g, '')) || Math.abs([...String(item.id)].reduce((acc, ch) => acc + ch.charCodeAt(0), 0))
          return (
            <BountyListItem
              id={numericId}
              title={item.title}
              username="@Jon_Doe"
              price={Number(item.amount)}
              distance={distance}
            />
          )
        }}
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
        <PostingsScreen onBack={() => setActiveScreen("bounty")} activeScreen={activeScreen} setActiveScreen={setActiveScreen} />
      ) : activeScreen === "profile" ? (
        <ProfileScreen onBack={() => setActiveScreen("bounty")} />
      ) : activeScreen === "create" ? (
        <MessengerScreen activeScreen={activeScreen} onNavigate={setActiveScreen} />
      ) : null}

      {/* Bottom Navigation - iPhone optimized with safe area inset */}
          <BottomNav activeScreen={activeScreen} onNavigate={setActiveScreen}/>
    </View>
  );

}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#059669',
    position: 'relative',
    paddingBottom: 100, // space for BottomNav height
  },
  dashboardArea: {
    flex: 1,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 32,
    paddingBottom: 8,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerTitle: {
    marginLeft: 8,
    fontSize: 20,
    fontWeight: 'bold',
    color: '#ffffff',
    letterSpacing: 1,
  },
  headerBalance: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  centerButton: {
    height: 56,
    width: 56,
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: '#fff',
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -20,
  },
  bottomNavContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 100,
    paddingBottom: 0,
  },
  // Search bar controls
  searchWrapper: {
    paddingHorizontal: 16,
    marginTop: 8,
    marginBottom: 8,
  },
  searchButton: {
    width: '100%',
    height: 44,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
  },
  searchIcon: {
    marginRight: 10,
  },
  searchText: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 14,
  },
  filtersRow: {
    marginBottom: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(5,46,27,0.2)',
    paddingHorizontal: 14,
    height: 36,
    borderRadius: 999,
    marginRight: 8,
  },
  chipActive: {
    backgroundColor: '#a7f3d0',
  },
  chipLabel: {
    color: '#d1fae5',
    fontSize: 14,
    fontWeight: '600',
  },
  chipLabelActive: {
    color: '#052e1b',
  },
});
