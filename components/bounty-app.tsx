"use client"

import { MessengerScreen } from "components/messenger-screen"
import { PostingsScreen } from "components/postings-screen"
import { ProfileScreen } from "components/profile-screen"
import { SearchScreen } from "components/search-screen"
import { WalletScreen } from "components/wallet-screen"
import { Calendar as CalendarIcon, DollarSign, MessageSquare, Package, Search, Target } from "lucide-react"
import React, { useEffect, useState } from "react"
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import { Calendar } from "components/ui/calendar"
// Define the Bounty type here if not exported from data-utils
type Bounty = {
  id: string
  user_id: string
  title: string
  amount: number | string
  location?: string
  description?: string
}

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
  function renderDashboardContent() {
    return (
      <View style={styles.dashboardContainer}>
        <Text style={styles.dashboardTitle}>Dashboard</Text>
        {/* Add your dashboard components here */}
      </View>
    );
  }

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
            // className="rounded-md border" // Not used in RN
          />
        </View>
      ) : null}

      {/* Bottom Navigation - iPhone optimized with safe area inset */}
      <View style={styles.bottomNav}>
        <TouchableOpacity onPress={() => setActiveScreen("create")}
          style={styles.navButton}
        >
          <MessageSquare color={activeScreen === "create" ? "#fff" : "#d1fae5"} size={24} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setActiveScreen("wallet")}
          style={styles.navButton}
        >
          <DollarSign color={activeScreen === "wallet" ? "#fff" : "#d1fae5"} size={24} />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.centerButton}
          onPress={() => setActiveScreen("bounty")}
        >
          <Target color={activeScreen === "bounty" ? "#fff" : "#d1fae5"} size={28} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setActiveScreen("postings")}
          style={styles.navButton}
        >
          <Search color={activeScreen === "postings" ? "#fff" : "#d1fae5"} size={24} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setActiveScreen("calendar")}
          style={styles.navButton}
        >
          <CalendarIcon color={activeScreen === "calendar" ? "#fff" : "#d1fae5"} size={24} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#059669', // emerald-600
  },
  dashboardContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  dashboardTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 16,
  },
  calendarContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  bottomNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    height: 64,
    backgroundColor: '#065f46', // emerald-800
    paddingHorizontal: 24,
    paddingBottom: 8,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    elevation: 10,
  },
  navButton: {
    padding: 12,
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
});
