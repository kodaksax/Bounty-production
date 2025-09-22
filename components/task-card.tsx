"use client"

import { type ReactNode, useState } from "react"
import { View, Text, TouchableOpacity } from "react-native"
import { MaterialIcons } from "@expo/vector-icons"
import { BountyDetailModal } from "./bountydetailmodal"

interface TaskCardProps {
  id: number
  username: string
  title: string
  price: number
  distance: number
  icon?: ReactNode
  description?: string
  highlight?: "price" | "distance" // New prop to highlight either price or distance
}

export function TaskCard({
  id,
  username,
  title,
  price,
  distance,
  icon,
  description,
  highlight = "distance",
}: TaskCardProps) {
  const [showDetail, setShowDetail] = useState(false)

  return (
    <>
      <TouchableOpacity
        className="bg-black/30 backdrop-blur-sm rounded-xl overflow-hidden cursor-pointer transition-transform active:scale-[0.98] touch-target-min shadow-md"
        onPress={() => setShowDetail(true)}
      >
        <View className="p-4">
          {/* Header */}
          <View className="flex justify-between items-center mb-2">
            <View className="flex items-center">
              <View className="h-6 w-6 rounded-full bg-gray-700 flex items-center justify-center mr-2">{icon}</View>
              <Text className="text-sm text-gray-300">{username}</Text>
            </View>
            <TouchableOpacity style={{ padding: 8 }}>
              <MaterialIcons name="more-vert" size={20} color="#9ca3af" />
            </TouchableOpacity>
          </View>

          {/* Title */}
          <Text className="text-base font-medium mb-3 line-clamp-2 text-white">{title}</Text>

          {/* Footer */}
          <View className="flex justify-between items-center">
            <View>
              <Text className="text-xs text-gray-400">Total Bounty</Text>
              <Text className={`font-bold ${highlight === "price" ? "text-yellow-400 text-lg" : "text-yellow-400"}`}>
                ${price}
              </Text>
            </View>
            <View className="text-right">
              <Text className="text-xs text-gray-400">Approx. Distance</Text>
              <Text className={`${highlight === "distance" ? "text-white font-bold" : "text-gray-300"}`}>
                {distance} mi
              </Text>
            </View>
          </View>
        </View>
      </TouchableOpacity>

      {showDetail && (
        <BountyDetailModal
          bounty={{ id, username, title, price, distance, description }}
          onClose={() => setShowDetail(false)}
        />
      )}
    </>
  )
}
