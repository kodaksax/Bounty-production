"use client"

import { Avatar, AvatarFallback, AvatarImage } from "components/ui/avatar"
import { bountyService } from "lib/services/bounty-service"
import type { Bounty } from "lib/services/database.types"
import { cn } from "lib/utils"
import { ArrowLeft, Mic, SearchIcon, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { View, Text, TouchableOpacity, ScrollView } from "react-native"

interface SearchScreenProps {
  onBack: () => void
}

interface BountyItem {
  id: string
  username: string
  title: string
  amount: number
  distance: number
  timeAgo: string
}

export function SearchScreen({ onBack }: SearchScreenProps) {
  const [searchQuery, setSearchQuery] = useState("")
  const [searchResults, setSearchResults] = useState<BountyItem[]>([])
  const [recentSearches, setRecentSearches] = useState<string[]>(["@Jon_Doe", "lawn", "package"])
  const [isInputFocused, setIsInputFocused] = useState(false)
  const [allBounties, setAllBounties] = useState<Bounty[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Fetch all bounties when the component mounts
  useEffect(() => {
    const fetchBounties = async () => {
      setIsLoading(true)
      try {
        const bounties = await bountyService.getAll({ status: "open" })
        setAllBounties(bounties)
      } catch (error) {
        console.error("Error fetching bounties for search:", error)
      } finally {
        setIsLoading(false)
      }
    }

    fetchBounties()
  }, [])

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

  // Format timestamp to relative time
  const formatTimeAgo = (timestamp: string) => {
    const date = new Date(timestamp)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffHrs = Math.floor(diffMs / (1000 * 60 * 60))

    if (diffHrs < 1) return "Just now"
    if (diffHrs < 24) return `${diffHrs}h AGO`
    return `${Math.floor(diffHrs / 24)}d AGO`
  }

  // Convert Bounty to BountyItem
  const convertToBountyItem = (bounty: Bounty): BountyItem => {
    return {
      id: bounty.id.toString(),
      username: bounty.user_id === "00000000-0000-0000-0000-000000000001" ? "@Jon_Doe" : "@User",
      title: bounty.title,
      amount: Number(bounty.amount),
      distance: calculateDistance(bounty.location || ""),
      timeAgo: formatTimeAgo(bounty.created_at),
    }
  }

  // Search function
  useEffect(() => {
    if (searchQuery.trim() === "") {
      setSearchResults([])
      return
    }

    const query = searchQuery.toLowerCase()
    const results = allBounties
      .filter(
        (bounty) => bounty.title.toLowerCase().includes(query) || bounty.description?.toLowerCase().includes(query),
      )
      .map(convertToBountyItem)

    setSearchResults(results)
  }, [searchQuery, allBounties])

  // Focus input on mount
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus()
    }
  }, [])

  // Handle search submission
  const handleSearch = (query: string) => {
    setSearchQuery(query)
    if (query.trim() !== "" && !recentSearches.includes(query)) {
      setRecentSearches((prev) => [query, ...prev.slice(0, 4)])
    }
  }

  // Highlight matching text
  const highlightMatch = (text: string, query: string) => {
    if (!query.trim()) return text

    const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi")
    const parts = text.split(regex)

    return parts.map((part, i) =>
      regex.test(part) ? (
        <Text key={i} className="bg-yellow-300/30 text-white font-medium">
          {part}
        </Text>
      ) : (
        part
      ),
    )
  }

  // Add a refresh function
  const refreshBounties = async () => {
    setIsLoading(true)
    try {
      const bounties = await bountyService.getAll({ status: "open" })
      setAllBounties(bounties)

      // Re-apply search if there's an active query
      if (searchQuery.trim() !== "") {
        const query = searchQuery.toLowerCase()
        const results = bounties
          .filter(
            (bounty) => bounty.title.toLowerCase().includes(query) || bounty.description?.toLowerCase().includes(query),
          )
          .map(convertToBountyItem)

        setSearchResults(results)
      }
    } catch (error) {
      console.error("Error refreshing bounties for search:", error)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <View className="flex flex-col min-h-screen bg-emerald-600">
      {/* Search Header */}
      <View className="p-4 pt-8">
        <View className="flex items-center gap-3">
          <TouchableOpacity onPress={onBack} className="text-white">
            <ArrowLeft className="h-5 w-5" />
          </TouchableOpacity>
          <Text className="text-xl font-bold text-white">Search</Text>
        </View>
      </View>

      {/* Search Input */}
      <View className="px-4 mb-4">
        <View
          className={cn(
            "relative flex items-center bg-emerald-700/50 rounded-full transition-all",
            isInputFocused ? "ring-2 ring-white/30" : "",
          )}
        >
          <SearchIcon className="absolute left-3 h-4 w-4 text-emerald-300" />
          <input
            ref={inputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => setIsInputFocused(true)}
            onBlur={() => setIsInputFocused(false)}
            placeholder="Search bounties or users..."
            className="w-full bg-transparent border-none py-2 pl-10 pr-10 text-white placeholder:text-emerald-300/70 focus:outline-none"
          />
          {searchQuery && (
            <TouchableOpacity onPress={() => setSearchQuery("")} className="absolute right-3 text-emerald-300">
              <X className="h-4 w-4" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Search Results or Recent Searches */}
      <View className="flex-1 px-4 overflow-y-auto">
        {searchQuery.trim() === "" ? (
          <>
            {recentSearches.length > 0 && (
              <View className="mb-4">
                <View className="flex justify-between items-center mb-2">
                  <Text className="text-sm font-medium text-emerald-200">Recent searches</Text>
                  <TouchableOpacity onPress={() => setRecentSearches([])} className="text-xs text-emerald-300">
                    Clear all
                  </TouchableOpacity>
                </View>
                <View className="space-y-2">
                  {recentSearches.map((search, index) => (
                    <button
                      key={index}
                      onPress={() => handleSearch(search)}
                      className="flex items-center justify-between w-full p-2 rounded-lg bg-emerald-700/30 hover:bg-emerald-700/50 transition-colors"
                    >
                      <View className="flex items-center">
                        <SearchIcon className="h-4 w-4 text-emerald-300 mr-3" />
                        <Text className="text-white">{search}</Text>
                      </View>
                      <X
                        className="h-4 w-4 text-emerald-300 opacity-0 group-hover:opacity-100"
                        onPress={(e) => {
                          e.stopPropagation()
                          setRecentSearches((prev) => prev.filter((_, i) => i !== index))
                        }}
                      />
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}
            <View>
              <Text className="text-sm font-medium text-emerald-200 mb-2">Suggested searches</Text>
              <View className="space-y-2">
                <button
                  onPress={() => handleSearch("@Jon_Doe")}
                  className="flex items-center w-full p-2 rounded-lg bg-emerald-700/30 hover:bg-emerald-700/50 transition-colors"
                >
                  <SearchIcon className="h-4 w-4 text-emerald-300 mr-3" />
                  <Text className="text-white">@Jon_Doe</Text>
                </TouchableOpacity>
                <button
                  onPress={() => handleSearch("package")}
                  className="flex items-center w-full p-2 rounded-lg bg-emerald-700/30 hover:bg-emerald-700/50 transition-colors"
                >
                  <SearchIcon className="h-4 w-4 text-emerald-300 mr-3" />
                  <Text className="text-white">package delivery</Text>
                </TouchableOpacity>
              </View>
            </View>
          </>
        ) : searchResults.length > 0 ? (
          <View className="space-y-3">
            {searchResults.map((bounty) => (
              <View key={bounty.id} className="bg-emerald-700/40 rounded-lg p-3">
                <View className="flex items-center gap-3 mb-2">
                  <Avatar className="h-8 w-8 border border-emerald-400/30">
                    <AvatarImage src={`/placeholder.svg?height=32&width=32`} alt={bounty.username} />
                    <AvatarFallback className="bg-emerald-900 text-emerald-200 text-xs">
                      {bounty.username.substring(1, 3).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <View>
                    <View className="text-sm text-emerald-100">{highlightMatch(bounty.username, searchQuery)}</View>
                    <View className="text-xs text-emerald-300">{bounty.timeAgo}</View>
                  </View>
                </View>
                <View className="font-medium text-white mb-2">{highlightMatch(bounty.title, searchQuery)}</View>
                <View className="flex justify-between items-center">
                  <View className="bg-emerald-900/50 px-2 py-1 rounded text-emerald-400 font-bold text-sm">
                    ${bounty.amount}
                  </View>
                  <View className="text-sm text-emerald-200">{bounty.distance} mi</View>
                </View>
              </View>
            ))}
          </View>
        ) : (
          <View className="flex flex-col items-center justify-center h-full text-emerald-200 text-center">
            <Text className="mb-2">No Results Found</Text>
            <Text className="text-sm text-emerald-300/70">Try a different search term</Text>
          </View>
        )}
      </View>

      {/* Search Bar at Bottom */}
      <View className="p-4 mt-auto">
        <View className="flex items-center justify-between bg-white/20 backdrop-blur-sm rounded-full p-1">
          <TouchableOpacity className="h-10 w-10 rounded-full flex items-center justify-center text-white">
            <SearchIcon className="h-5 w-5" />
          </TouchableOpacity>
          <TouchableOpacity className="h-10 w-10 rounded-full flex items-center justify-center text-white">
            <Mic className="h-5 w-5" />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  )
}
