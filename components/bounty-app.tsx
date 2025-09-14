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
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
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
  // ...existing code...
  // (Refactored renderDashboardContent and return JSX to use React Native components)
  // ...existing code...

  return (
    <div className="flex flex-col min-h-screen bg-gradient-to-b from-emerald-600 to-emerald-700 text-white">
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
        <div className="flex justify-center items-center h-screen">
          <Calendar
            mode="single"
            selected={date}
            onSelect={setDate}
            className="rounded-md border"
          />
        </div>
      ) : null}

      {/* Bottom Navigation - iPhone optimized with safe area inset */}
      <div className="fixed bottom-0 left-0 right-0 h-16 bg-emerald-800/80 backdrop-blur-sm flex justify-around items-center px-6 pb-safe z-20 shadow-lg">
        <button onClick={() => setActiveScreen("create")} className="p-3 touch-target-min">
          <MessageSquare className={`h-6 w-6 ${activeScreen === "create" ? "text-white" : "text-white/70"}`} />
        </button>
        <button onClick={() => setActiveScreen("wallet")} className="p-3 touch-target-min">
          <DollarSign className={`h-6 w-6 ${activeScreen === "wallet" ? "text-white" : "text-white/70"}`} />
        </button>
        <div
          className="h-14 w-14 bg-transparent border-2 border-white rounded-full flex items-center justify-center -mt-5 cursor-pointer touch-target-min"
          onClick={() => setActiveScreen("bounty")}
        >
          <Target className={`h-7 w-7 ${activeScreen === "bounty" ? "text-white" : "text-white/70"}`} />
        </div>
        <button onClick={() => setActiveScreen("postings")} className="p-3 touch-target-min">
          <Search className={`h-6 w-6 ${activeScreen === "postings" ? "text-white" : "text-white/70"}`} />
        </button>
        <button onClick={() => setActiveScreen("calendar")} className="p-3 touch-target-min">
          <CalendarIcon className={`h-6 w-6 ${activeScreen === "calendar" ? "text-white" : "text-white/70"}`} />
        </button>
      </div>
    </div>
  )
}
