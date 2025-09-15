"use client"

import { View, Text, TouchableOpacity, StyleSheet } from "react-native"
import { Avatar, AvatarFallback, AvatarImage } from "components/ui/avatar"
import { MoreVertical } from "lucide-react"

interface ArchivedBountyCardProps {
  id: string
  username: string
  title: string
  amount: number
  distance: number
  avatarSrc?: string
  onMenuClick?: () => void
}

export function ArchivedBountyCard({
  id,
  username,
  title,
  amount,
  distance,
  avatarSrc,
  onMenuClick,
}: ArchivedBountyCardProps) {
  // Generate a unique gradient based on the bounty ID
  const getGradient = (id: string) => {
    const hash = id.split("").reduce((acc, char) => {
      return char.charCodeAt(0) + ((acc << 5) - acc)
    }, 0)

    const hue1 = hash % 360
    const hue2 = (hue1 + 40) % 360

    return `linear-gradient(135deg, hsla(${hue1}, 80%, 40%, 0.1), hsla(${hue2}, 90%, 30%, 0.2))`
  }

  return (
    <View
      className="relative mb-4 rounded-xl overflow-hidden"
      style={{ background: "linear-gradient(to bottom, rgba(75, 85, 99, 0.9), rgba(55, 65, 81, 0.95))" }}
    >
      {/* Animated gradient overlay */}
      <View
        className="absolute inset-0 opacity-60"
        style={{
          background: getGradient(id),
          backgroundSize: "200% 200%",
          animation: "gradientShift 8s ease infinite",
        }}
      />

      {/* Content */}
      <View className="relative p-4">
        {/* Username and menu */}
        <View className="flex justify-between items-center mb-2">
          <View className="flex items-center gap-2">
            <View className="h-6 w-6 rounded-full bg-emerald-500 flex items-center justify-center">
              <Avatar className="h-5 w-5">
                <AvatarImage src={avatarSrc || "/placeholder.svg?height=20&width=20"} alt={username} />
                <AvatarFallback className="bg-emerald-700 text-emerald-200 text-[8px]">
                  {username.substring(1, 3).toUpperCase()}
                </AvatarFallback>
              </Avatar>
            </View>
            <Text className="text-xs text-emerald-200">{username}</Text>
          </View>
          <TouchableOpacity onPress={onMenuClick} className="text-gray-300 hover:text-white transition-colors">
            <MoreVertical className="h-5 w-5" />
          </TouchableOpacity>
        </View>

        {/* Title */}
        <Text className="text-white font-medium mb-6">{title}</Text>

        {/* Watermark */}
        <View className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-20">
          <Text className="text-4xl font-bold tracking-widest text-white rotate-12">BOUNTY</Text>
        </View>

        {/* NFT details */}
        <View className="flex justify-between items-center mt-2">
          <Text className="text-yellow-500 font-bold text-lg">${amount.toLocaleString()}</Text>
          <Text className="text-sm text-gray-300">{distance} mi</Text>
        </View>

        {/* NFT badge */}
        <View className="absolute top-2 right-2">
          <View className="text-xs bg-emerald-900/50 text-emerald-300 px-2 py-0.5 rounded-full border border-emerald-700/50">
            <Text className="text-xs text-emerald-300">NFT #{id.substring(0, 6)}</Text>
          </View>
        </View>
      </View>
    </View>
  )
}
