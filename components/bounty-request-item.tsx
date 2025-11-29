"use client"

import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import { Avatar, AvatarFallback, AvatarImage } from "components/ui/avatar"
import { getValidAvatarUrl } from "lib/utils/avatar-utils"
import React from 'react'
import { Text, TouchableOpacity, View } from 'react-native'

interface BountyRequestItemProps {
  username: string
  title: string
  amount: number
  distance: number
  timeAgo: string
  avatarSrc?: string
  onMenuClick?: () => void
  onAccept?: () => Promise<void>;
  onReject?: () => Promise<void>;
  status: "pending" | "accepted" | "rejected";
  workType?: 'online' | 'in_person'
  deadline?: string
}

export function BountyRequestItem({
  username,
  title,
  amount,
  distance,
  timeAgo,
  avatarSrc,
  onMenuClick,
  workType,
  deadline,
}: BountyRequestItemProps) {
  // Validate avatar URL
  const validAvatarUrl = getValidAvatarUrl(avatarSrc);
  
  return (
    <View className="bg-emerald-800/50 backdrop-blur-sm rounded-lg overflow-hidden mb-3">
      <View className="p-3">
        <View className="flex items-center gap-3">
          <View className="h-10 w-10 rounded-full bg-emerald-500 flex items-center justify-center border border-emerald-400/30">
            <Avatar className="h-8 w-8">
              <AvatarImage src={validAvatarUrl} alt={username} />
              <AvatarFallback className="bg-emerald-900 text-emerald-200 text-xs">
                {username.substring(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
          </View>

          <View className="flex-1">
            <View className="flex justify-between items-center">
              <Text className="text-sm text-emerald-100">{username}</Text>
              <View className="flex items-center gap-2">
                <Text className="text-xs text-emerald-300">{timeAgo}</Text>
                <TouchableOpacity onPress={onMenuClick} className="text-emerald-300">
                  <MaterialIcons name="more-vert" size={24} color="#000000" />
                </TouchableOpacity>
              </View>
            </View>
            <Text className="text-white font-medium mt-0.5">{title}</Text>
            <View className="flex-row gap-2 mt-1">
              {workType && (
                <View className="bg-emerald-700/40 px-2 py-0.5 rounded">
                  <Text className="text-emerald-200 text-[10px] uppercase tracking-wide">{workType === 'online' ? 'Online' : 'In Person'}</Text>
                </View>
              )}
              {deadline && (
                <View className="bg-emerald-900/40 px-2 py-0.5 rounded">
                  <Text className="text-emerald-300 text-[10px] tracking-wide">Due: {deadline.length > 16 ? deadline.slice(0,16)+'…' : deadline}</Text>
                </View>
              )}
            </View>
          </View>
        </View>

        <View className="flex justify-between items-center mt-2">
          <View className="bg-emerald-900/50 px-2 py-1 rounded text-emerald-400 font-bold text-sm">${amount}</View>
          <View className="text-sm text-emerald-200">{distance} mi</View>
        </View>
      </View>
    </View>
  )
}
