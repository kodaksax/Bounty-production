"use client"

import { CategoryFilter } from "components/category-filter"
import { MessengerScreen } from "components/messenger-screen"
import { PostingsScreen } from "components/postings-screen"
import { ProfileScreen } from "components/profile-screen"
import { SearchScreen } from "components/search-screen"
import { TaskCard } from "components/task-card"
import { WalletScreen } from "components/wallet-screen"
import { DollarSign, MessageSquare, Package, Search, Target, User, Calendar as CalendarIcon } from "lucide-react"
import React, { useEffect, useState } from "react"
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Pressable } from 'react-native';
// Define the Bounty type here if not exported from data-utils
type Bounty = {
  id: string
  user_id: string
  title: string
  amount: number | string
  location?: string
  description?: string
}

import { Calendar } from "components/ui/calendar"

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#059669', // emerald-600
  },
  dashboardContainer: {
    flex: 1,
    paddingHorizontal: 16,
  },
  header: {
    paddingTop: 40,
    paddingBottom: 20,
    alignItems: 'center',
  },
  headerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  targetIcon: {
    marginRight: 8,
    color: 'white',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: 'white',
    letterSpacing: 2,
  },
  headerSubtitle: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.8)',
  },
  balanceContainer: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    padding: 16,
    borderRadius: 12,
    marginBottom: 20,
    alignItems: 'center',
  },
  balanceLabel: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.8)',
    marginBottom: 4,
  },
  balanceAmount: {
    fontSize: 28,
    fontWeight: 'bold',
    color: 'white',
  },
  categoriesContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    marginBottom: 20,
    gap: 12,
  },
  bountiesContainer: {
    paddingBottom: 100, // Space for bottom navigation
  },
  loadingText: {
    color: 'white',
    textAlign: 'center',
    fontSize: 16,
    marginTop: 20,
  },
  errorText: {
    color: '#FCA5A5', // red-300
    textAlign: 'center',
    fontSize: 16,
    marginTop: 20,
  },
  emptyText: {
    color: 'rgba(255,255,255,0.8)',
    textAlign: 'center',
    fontSize: 16,
    marginTop: 20,
  },
  calendarContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  bottomNavigation: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 64,
    backgroundColor: 'rgba(6, 95, 70, 0.8)', // emerald-800 with opacity
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingBottom: 8, // Safe area inset
  },
  navButton: {
    padding: 12,
  },
  centerNavButton: {
    height: 56,
    width: 56,
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: 'white',
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -20,
  },
});

export function  BountyApp() {
  const [activeCategory, setActiveCategory] = useState("local")
  const [activeScreen, setActiveScreen] = useState("bounty") // Changed default to "bounty"
  const [showSearch, setShowSearch] = useState(false)
  const [bounties, setBounties] = useState<Bounty[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [userBalance, setUserBalance] = useState(40)
  const [error, setError] = useState<string | null>(null)
  const [date, setDate] = React.useState<Date | undefined>(new Date())

  // Define categories
  const categories = [
    { id: "local", label: "Local", icon: <Package className="h-4 w-4" /> },
    { id: "highpaying", label: "High Paying", icon: <DollarSign className="h-4 w-4" /> },
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
  const filteredBounties = React.useMemo(() => {
    let sortedBounties = [...bounties]

    if (activeCategory === "local") {
      // Sort by proximity (distance)
      sortedBounties = sortedBounties.sort((a, b) => {
        const distanceA = calculateDistance(a.location || "")
        const distanceB = calculateDistance(b.location || "")
        return distanceA - distanceB // Ascending order (closest first)
      })
    } else if (activeCategory === "highpaying") {
      // Sort by highest amount
      sortedBounties = sortedBounties.sort((a, b) => {
        return Number(b.amount) - Number(a.amount) // Descending order (highest first)
      })
    }

    return sortedBounties
  }, [bounties, activeCategory])

  // Fetch bounties from your new Hostinger backend
  useEffect(() => {
    const fetchBounties = async () => {
      try {
        setIsLoading(true)
        setError(null)

        // TODO: Replace with your Hostinger backend API endpoint for fetching bounties
        const response = await fetch("https://your-hostinger-api.com/bounties")
        if (!response.ok) {
          throw new Error("Failed to fetch bounties from the server.")
        }
        const data = await response.json()
        setBounties(data)
      } catch (err: any) {
        console.error("Error fetching bounties:", err)
        setError(err.message || "An unknown error occurred.")
      } finally {
        setIsLoading(false)
      }
    }
    fetchBounties()
  }, [])

  // Ensure activeCategory is valid when categories change
  useEffect(() => {
    // If the current activeCategory is not in the available categories, reset to "local"
    const categoryIds = categories.map((cat) => cat.id)
    if (!categoryIds.includes(activeCategory)) {
      setActiveCategory("local")
    }
  }, [categories, activeCategory])

  if (showSearch) {
    return <SearchScreen onBack={() => setShowSearch(false)} />
  }

  // Render dashboard content when activeScreen is "bounty" (previously "home")
  const renderDashboardContent = () => {
    return (
      <ScrollView style={styles.dashboardContainer}>
        <View style={styles.header}>
          <View style={styles.headerContent}>
            <Target style={styles.targetIcon} />
            <Text style={styles.headerTitle}>BOUNTY</Text>
          </View>
          <Text style={styles.headerSubtitle}>Find bounties near you</Text>
        </View>

        <View style={styles.balanceContainer}>
          <Text style={styles.balanceLabel}>Your Balance</Text>
          <Text style={styles.balanceAmount}>${userBalance.toFixed(2)}</Text>
        </View>

        <View style={styles.categoriesContainer}>
          {categories.map((category) => (
            <CategoryFilter
              key={category.id}
              label={category.label}
              icon={category.icon}
              isActive={activeCategory === category.id}
              onClick={() => setActiveCategory(category.id)}
            />
          ))}
        </View>

        <View style={styles.bountiesContainer}>
          {isLoading ? (
            <Text style={styles.loadingText}>Loading bounties...</Text>
          ) : error ? (
            <Text style={styles.errorText}>Error: {error}</Text>
          ) : filteredBounties.length === 0 ? (
            <Text style={styles.emptyText}>No bounties available</Text>
          ) : (
            filteredBounties.map((bounty) => (
              <TaskCard
                key={bounty.id}
                id={Number(bounty.id)}
                username={bounty.user_id}
                title={bounty.title}
                price={Number(bounty.amount)}
                distance={calculateDistance(bounty.location || "")}
                description={bounty.description}
              />
            ))
          )}
        </View>
      </ScrollView>
    );
  };

  return (
    <View style={styles.container}>
      {activeScreen === "bounty" ? (
        renderDashboardContent()
      ) : activeScreen === "wallet" ? (
        <WalletScreen onBack={() => setActiveScreen("bounty")} />
      ) : activeScreen === "postings" ? (
        <PostingsScreen onBack={() => setActiveScreen("bounty")} />
      ) : activeScreen === "profile" ? (
        <ProfileScreen onBack={() => setActiveScreen("bounty")} />
      ) : activeScreen === "create" ? (
        <MessengerScreen />
      ) : activeScreen === "calendar" ? (
        <View style={styles.calendarContainer}>
          <Calendar
            mode="single"
            selected={date}
            onSelect={setDate}
          />
        </View>
      ) : null}

      {/* Bottom Navigation - iPhone optimized with safe area inset */}
      <View style={styles.bottomNavigation}>
        <TouchableOpacity onPress={() => setActiveScreen("create")} style={styles.navButton}>
          <MessageSquare color={activeScreen === "create" ? "white" : "rgba(255,255,255,0.7)"} size={24} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setActiveScreen("wallet")} style={styles.navButton}>
          <DollarSign color={activeScreen === "wallet" ? "white" : "rgba(255,255,255,0.7)"} size={24} />
        </TouchableOpacity>
        <Pressable
          style={styles.centerNavButton}
          onPress={() => setActiveScreen("bounty")}
        >
          <Target color={activeScreen === "bounty" ? "white" : "rgba(255,255,255,0.7)"} size={28} />
        </Pressable>
        <TouchableOpacity onPress={() => setActiveScreen("postings")} style={styles.navButton}>
          <Search color={activeScreen === "postings" ? "white" : "rgba(255,255,255,0.7)"} size={24} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setActiveScreen("calendar")} style={styles.navButton}>
          <CalendarIcon color={activeScreen === "calendar" ? "white" : "rgba(255,255,255,0.7)"} size={24} />
        </TouchableOpacity>
      </View>
    </View>
  )
}
