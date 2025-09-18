import {
  MaterialIcons
} from "@expo/vector-icons"
import { MessengerScreen } from "components/messenger-screen"
import { PostingsScreen } from "components/postings-screen"
import { ProfileScreen } from "components/profile-screen"
import { SearchScreen } from "components/search-screen"
import { WalletScreen } from "components/wallet-screen"
import React, { useEffect, useState } from "react"
import { Search } from "lucide-react-native";
import { BottomNav } from 'components/ui/bottom-nav'
import { StyleSheet, Text, View, TouchableOpacity, ScrollView } from 'react-native'

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
    { id: "local", label: "Local", icon: <MaterialIcons name="local-shipping" size={16} color="#374151" /> },
    { id: "highpaying", label: "High Paying", icon: <MaterialIcons name="attach-money" size={16} color="#374151" /> },
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
    {/* Search Bar */}
    <View style={styles.searchWrapper}>
      <TouchableOpacity
        accessibilityRole="button"
        onPress={() => setShowSearch(true)}
        style={styles.searchButton}
      >
        <Search size={18} color="rgba(255,255,255,0.85)" style={styles.searchIcon} />
        <Text style={styles.searchText}>Search bounties or users...</Text>
      </TouchableOpacity>
    </View>
    {/* Search Bar End*/}
    <Text style={styles.dashboardTitle}>Dashboard</Text>
    {/* components/ui/command.tsx Add your dashboard components here */}
    {/* ...existing code... */}
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
    width: '100%',
    alignItems: 'center', // centers the search bar horizontally
    marginBottom: 12,
    // Uncomment to absolute-position the search bar near the top:
     position: 'absolute',
     top: 128,
    // left: 16,
    // right: 16,
  },
  searchButton: {
    width: '92%',         // change to fixed number (e.g., 320) for exact width
    maxWidth: 640,
    height: 50,           // adjust height
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
});
