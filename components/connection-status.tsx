"use client"

import { useEffect, useState } from "react"
import { Text, View } from "react-native"
// Make sure to install NetInfo: expo install @react-native-community/netinfo
import { MaterialIcons } from "@expo/vector-icons"
import NetInfo, { NetInfoState } from '@react-native-community/netinfo'
import { cn } from "lib/utils"

export function ConnectionStatus() {
  const [isOnline, setIsOnline] = useState(true)
  const [showStatus, setShowStatus] = useState(false)

  useEffect(() => {
    // Subscribe to NetInfo for online/offline status
    const unsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
      if (state.isConnected) {
        setIsOnline(true)
        setShowStatus(true)
        setTimeout(() => setShowStatus(false), 3000)
      } else {
        setIsOnline(false)
        setShowStatus(true)
      }
    })
    // Check initial status
    NetInfo.fetch().then((state: NetInfoState) => setIsOnline(!!state.isConnected))
    return () => {
      unsubscribe()
    }
  }, [])

  if (!showStatus) return null

  return (
    <View className={cn(
      "fixed top-safe z-50 left-0 right-0 flex items-center justify-center transition-all duration-300",
      isOnline ? "bg-green-500" : "bg-red-500",
    )}>
      <View className="flex items-center py-2 px-4">
        {isOnline ? (
          <>
            <MaterialIcons name="wifi" size={16} color="#fff" />
            <Text className="text-white text-sm font-medium">Back online</Text>
          </>
        ) : (
          <>
            <MaterialIcons name="wifi-off" size={16} color="#fff" />
            <Text className="text-white text-sm font-medium">You're offline</Text>
          </>
        )}
      </View>
    </View>
  )
}
