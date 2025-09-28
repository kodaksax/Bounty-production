"use client"

import { MaterialIcons } from "@expo/vector-icons"
import { useState } from "react"
import { Text, TouchableOpacity, View } from "react-native"
import { ArchivedBountyCard } from "./archived-bounty-card"

interface ArchivedBountiesScreenProps {
  onBack?: () => void
}

export function ArchivedBountiesScreen({ onBack }: ArchivedBountiesScreenProps) {
  const [archivedBounties] = useState([
    {
      id: "b1e7a3c9d5f2",
      username: "@Jon_Doe",
      title: "Mow My Lawn!!!",
      amount: 600000,
      distance: 10,
    },
    {
      id: "a2c4e6g8i0k2",
      username: "@Jon_Doe",
      title: "Mow My Lawn!!!",
      amount: 600000,
      distance: 10,
    },
    {
      id: "z9y8x7w6v5u4",
      username: "@MtnOlympus",
      title: "Deliver this package",
      amount: 450000,
      distance: 15,
    },
    {
      id: "j1k2l3m4n5o6",
      username: "@CryptoKing",
      title: "Find my lost wallet",
      amount: 1200000,
      distance: 5,
    },
  ])

  return (
    <View className="flex flex-col min-h-screen bg-emerald-600">
      {/* Header: icon + title on left, back on right */}
      <View className="flex flex-row justify-between items-center p-4 pt-8">
        <View className="flex flex-row items-center gap-3">
          <MaterialIcons name="gps-fixed" size={24} color="#fffef5" />
          <Text className="text-lg font-bold tracking-wider text-white">BOUNTY</Text>
        </View>
        <TouchableOpacity onPress={onBack} className="p-2">
          <MaterialIcons name="arrow-back" size={24} color="#fffef5" />
        </TouchableOpacity>
      </View>

      {/* NFT Collection */}
      <View className="flex-1 px-4 py-4 overflow-y-auto">
        {archivedBounties.map((bounty) => (
          <ArchivedBountyCard
            key={bounty.id}
            id={bounty.id}
            username={bounty.username}
            title={bounty.title}
            amount={bounty.amount}
            distance={bounty.distance}
            onMenuClick={() => console.log(`Menu clicked for ${bounty.id}`)}
          />
        ))}
      </View>

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
