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
  const renderDashboardContent = () => (
    <>
      {/* Status Bar - iPhone optimized with safe area inset */}
      <div className="flex justify-between items-center p-4 pt-safe">
        <div className="flex items-center">
          <Target className="h-6 w-6 mr-2" />
          <span className="text-xl font-bold tracking-wider">BOUNTY</span>
        </div>
        <button
          onClick={() => setActiveScreen("wallet")}
          className="flex items-center hover:opacity-80 transition-opacity touch-target-min"
        >
          <span className="text-xl font-bold">$ {userBalance.toFixed(2)}</span>
        </button>
      </div>

      {/* Error Display */}
      {error && (
        <div className="mx-4 mb-4 p-3 bg-red-500/70 rounded-lg text-white text-sm">
          <p className="font-medium">Error:</p>
          <p>{error}</p>
        </div>
      )}

      {/* Search Bar - Increased touch target */}
      <div className="px-4 mb-3">
        <div className="relative">
          <button
            className="h-12 w-full bg-white/20 rounded-full flex items-center px-4 touch-target-min"
            onClick={() => setShowSearch(true)}
          >
            <Search className="h-5 w-5 text-white/60" />
            <span className="ml-2 text-white/60 text-base">Search bounties or users...</span>
          </button>
        </div>
      </div>

      {/* Category Filters - Horizontal scrollable */}
      <div className="flex px-4 space-x-3 mb-4 overflow-x-auto ios-scroll no-scrollbar">
        {categories.map((category) => (
          <CategoryFilter
            key={category.id}
            label={category.label}
            icon={category.icon}
            isActive={activeCategory === category.id}
            onClick={() => setActiveCategory(category.id === activeCategory ? "all" : category.id)}
          />
        ))}
      </div>

      {/* Active Category Indicator */}
      <div className="px-4 mb-3">
        <h2 className="text-lg font-semibold">
          {activeCategory === "local" ? "Nearby Bounties" : "Highest Paying Bounties"}
        </h2>
        <p className="text-sm text-white/70">
          {activeCategory === "local"
            ? "Showing bounties closest to your location"
            : "Showing bounties with the highest rewards"}
        </p>
      </div>

      {/* Task Grid - Adjusted for iPhone */}
      <div className="flex-1 px-4 pb-28 ios-scroll">
        {isLoading ? (
          <div className="flex justify-center items-center py-10">
            <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-white"></div>
          </div>
        ) : filteredBounties.length === 0 ? (
          <div className="text-center py-10 text-white">
            <p>No bounties found</p>
            <button
              onClick={() => setActiveScreen("postings")}
              className="mt-4 px-6 py-3 bg-emerald-500 rounded-lg text-white text-base touch-target-min"
            >
              Create a Bounty
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {filteredBounties.map((bounty) => (
              <TaskCard
                key={bounty.id}
                id={Number(bounty.id)}
                username={bounty.user_id === "00000000-0000-0000-0000-000000000001" ? "@Jon_Doe" : "@User"}
                title={bounty.title}
                price={Number(bounty.amount)}
                distance={calculateDistance(bounty.location || "")}
                icon={<DollarSign className="h-4 w-4" />}
                description={bounty.description}
                highlight={activeCategory === "highpaying" ? "price" : "distance"}
              />
            ))}
          </div>
        )}
      </div>
    </>
  )

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
