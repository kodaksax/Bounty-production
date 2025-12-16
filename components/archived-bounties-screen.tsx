"use client"

import { MaterialIcons } from "@expo/vector-icons"
import { useEffect, useState } from "react"
import { ActivityIndicator, FlatList, RefreshControl, Text, TouchableOpacity, View } from "react-native"
import type { Bounty } from "lib/services/database.types"
import { bountyService } from "lib/services/bounty-service"
import { getCurrentUserId } from "lib/utils/data-utils"
import { ArchivedBountyCard } from "./archived-bounty-card"

interface ArchivedBountiesScreenProps {
  onBack?: () => void
}

export function ArchivedBountiesScreen({ onBack }: ArchivedBountiesScreenProps) {
  const [archivedBounties, setArchivedBounties] = useState<Bounty[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const currentUserId = getCurrentUserId()

  const loadArchivedBounties = async () => {
    try {
      setLoading(true)
      // Load archived bounties for the current user (both as poster and hunter)
      const allBounties = await bountyService.getAll({ status: "archived" })
      
      // Filter to show bounties where user is either poster or accepted hunter
      const userBounties = allBounties.filter(bounty => 
        bounty.poster_id === currentUserId || 
        bounty.user_id === currentUserId ||
        bounty.accepted_by === currentUserId
      )
      
      setArchivedBounties(userBounties.sort((a, b) => 
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      ))
    } catch (error) {
      console.error("Failed to load archived bounties:", error)
    } finally {
      setLoading(false)
    }
  }

  const handleRefresh = async () => {
    setRefreshing(true)
    await loadArchivedBounties()
    setRefreshing(false)
  }

  useEffect(() => {
    loadArchivedBounties()
  }, [])

  const renderBountyItem = ({ item }: { item: Bounty }) => (
    <ArchivedBountyCard
      id={String(item.id)}
      username={item.username || "@Unknown"}
      title={item.title}
      amount={item.amount}
      distance={item.distance || 0}
      avatarSrc={item.poster_avatar}
      onMenuClick={() => {}}
    />
  )

  return (
    <View className="flex flex-col min-h-screen bg-emerald-600">
      {/* Header: icon + title on left, back on right */}
      <View className="flex flex-row justify-between items-center p-4 pt-8">
        <View className="flex flex-row items-center gap-3">
          <MaterialIcons name="archive" size={24} color="#ffffff" />
          <Text className="text-lg font-bold tracking-wider text-white">ARCHIVED BOUNTIES</Text>
        </View>
        <TouchableOpacity onPress={onBack} className="p-2">
          <MaterialIcons name="arrow-back" size={24} color="#ffffff" />
        </TouchableOpacity>
      </View>

      {/* Bounty List */}
      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#ffffff" />
          <Text className="text-white mt-4">Loading archived bounties...</Text>
        </View>
      ) : (
        <FlatList
          data={archivedBounties}
          renderItem={renderBountyItem}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 16, paddingBottom: 80 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor="#ffffff"
            />
          }
          ListEmptyComponent={
            <View className="flex-1 items-center justify-center py-16">
              <MaterialIcons name="archive" size={64} color="rgba(255,255,255,0.5)" />
              <Text className="text-white text-xl font-bold mt-4">No Archived Bounties</Text>
              <Text className="text-emerald-200 text-center mt-2 px-8">
                Bounties you archive will appear here for future reference
              </Text>
            </View>
          }
        />
      )}

      {/* Bottom Navigation Indicator */}
      <View className="flex justify-center pb-6">
        <View className="h-1 w-1 rounded-full bg-white/50 mx-1"></View>
        <View className="h-1 w-1 rounded-full bg-white/50 mx-1"></View>
        <View className="h-1 w-1 rounded-full bg-white mx-1"></View>
        <View className="h-1 w-1 rounded-full bg-white/50 mx-1"></View>
        <View className="h-1 w-1 rounded-full bg-white/50 mx-1"></View>
      </View>
    </View>
  )
}
