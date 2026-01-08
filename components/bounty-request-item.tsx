"use client"

import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import { Avatar, AvatarFallback, AvatarImage } from "components/ui/avatar"
import { getAvatarInitials, getValidAvatarUrl } from "lib/utils/avatar-utils"
import React, { useMemo } from 'react'
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

/**
 * Optimized bounty request item component with React.memo to prevent unnecessary re-renders.
 * Memoizes expensive computations like avatar validation and string operations.
 */
function BountyRequestItemComponent({
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
  // Memoize expensive avatar validation
  const validAvatarUrl = useMemo(() => getValidAvatarUrl(avatarSrc), [avatarSrc]);
  
  // Memoize avatar initials computation
  const avatarInitials = useMemo(() => getAvatarInitials(username), [username]);
  
  // Memoize deadline truncation
  const displayDeadline = useMemo(() => {
    if (!deadline) return null;
    return deadline.length > 16 ? deadline.slice(0, 16) + '…' : deadline;
  }, [deadline]);
  
  return (
    <View className="bg-emerald-800/50 backdrop-blur-sm rounded-lg overflow-hidden mb-3">
      <View className="p-3">
        <View className="flex items-center gap-3">
          <View className="h-10 w-10 rounded-full bg-emerald-500 flex items-center justify-center border border-emerald-400/30">
            <Avatar className="h-8 w-8">
              <AvatarImage src={validAvatarUrl} alt={username} />
              <AvatarFallback className="bg-emerald-900 text-emerald-200 text-xs">
                {avatarInitials}
              </AvatarFallback>
            </Avatar>
          </View>

          <View className="flex-1">
            <View className="flex justify-between items-center">
              <Text className="text-sm text-emerald-100">{username}</Text>
              <View className="flex items-center gap-2">
                <Text className="text-xs text-emerald-300">{timeAgo}</Text>
                <TouchableOpacity accessibilityRole="button" onPress={onMenuClick} className="text-emerald-300">
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
              {displayDeadline && (
                <View className="bg-emerald-900/40 px-2 py-0.5 rounded">
                  <Text className="text-emerald-300 text-[10px] tracking-wide">Due: {displayDeadline}</Text>
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

/**
 * Memoized version to prevent re-renders when parent updates but props haven't changed.
 * Only re-renders when actual prop values change.
 * Note: onMenuClick is excluded from comparison - parent should memoize it with useCallback.
 */
export const BountyRequestItem = React.memo(BountyRequestItemComponent, (prevProps, nextProps) => {
  // Custom comparison for better performance
  // onMenuClick is intentionally excluded - the parent should memoize it with useCallback
  return (
    prevProps.username === nextProps.username &&
    prevProps.title === nextProps.title &&
    prevProps.amount === nextProps.amount &&
    prevProps.distance === nextProps.distance &&
    prevProps.timeAgo === nextProps.timeAgo &&
    prevProps.avatarSrc === nextProps.avatarSrc &&
    prevProps.status === nextProps.status &&
    prevProps.workType === nextProps.workType &&
    prevProps.deadline === nextProps.deadline
  );
});
