import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import React, { useEffect, useRef, useState } from "react"
import {
    Dimensions,
    Text,
    View
} from "react-native"

interface BountyConfirmationCardProps {
  bountyData: {
    title: string
    description: string
    amount: number
    isForHonor: boolean
    location: string
    workType?: 'online' | 'in_person'
    isTimeSensitive?: boolean
    deadline?: string
  }
  onConfirm: () => Promise<void>
  onCancel: () => void
}

export function BountyConfirmationCard({ bountyData, onConfirm, onCancel }: BountyConfirmationCardProps) {
  const [isDragging, setIsDragging] = useState(false)
  const [dragProgress, setDragProgress] = useState(0)
  const [isConfirming, setIsConfirming] = useState(false)
  const dragConstraintsRef = useRef(null)
  const [windowHeight, setWindowHeight] = useState(Dimensions.get("window").height)

  // Get window dimensions on mount and listen for changes
  useEffect(() => {
    const updateWindowDimensions = ({ window }: { window: { width: number; height: number } }) => {
      setWindowHeight(window.height)
    }
    const subscription = Dimensions.addEventListener("change", updateWindowDimensions)
    return () => {
      subscription.remove()
    }
  }, [])

  // Handle drag end
  const handleDragEnd = async (event: any, info: any) => {
    setIsDragging(false)

    // If dragged up more than 40% of the height, confirm the bounty
    if (dragProgress > 0.4) {
      setIsConfirming(true)
      // Call the confirm function
      await onConfirm()
    } else {
      // Reset position with spring animation
      setDragProgress(0)
      setDragProgress(0)
    }
  }

  // Handle drag
  const handleDrag = (event: any, info: any) => {
    setIsDragging(true)

    // Calculate drag progress (negative because we're dragging upward)
    const maxDrag = -windowHeight * 0.3 // Proportional to screen height
    const progress = Math.min(Math.max((info.offset.y / maxDrag) * -1, 0), 1)
    setDragProgress(progress)
  }

  // Cancel with escape key (not supported in React Native, so this is omitted)
  // If you want to handle hardware back button on Android, use BackHandler from 'react-native'.

  return (
    <View className="absolute inset-0 z-50 flex items-center justify-center bg-black/50" onTouchStart={onCancel}>
      <View
        ref={dragConstraintsRef}
        className="flex items-center justify-center w-full h-full px-4"
        onStartShouldSetResponder={() => true}
      >
        <View className="bg-emerald-600 rounded-2xl overflow-hidden shadow-xl w-full max-w-md mx-auto" style={{ maxHeight: windowHeight * 0.8 }}>
          {/* Header */}
          <View className="p-4 bg-emerald-700 flex items-center justify-center">
            <MaterialIcons name="place" size={20} color="#ffffff" style={{ marginRight: 8 }} />
            <Text className="text-lg font-bold tracking-wider text-white">BOUNTY</Text>
          </View>

          {/* Content */}
          <View className="p-5" style={{ maxHeight: windowHeight * 0.5 }}>
            <Text className="text-xl font-bold text-white mb-3">{bountyData.title}</Text>
            <Text className="text-emerald-100 mb-4 text-base line-clamp-3">{bountyData.description}</Text>

            <View className="flex justify-between items-center mb-4">
              <View className="bg-emerald-700/50 px-4 py-2 rounded-lg text-white font-bold text-lg">
                {bountyData.isForHonor ? "For Honor" : `$${bountyData.amount.toLocaleString()}`}
              </View>
              <View className="items-end">
                {bountyData.workType && (
                  <Text className="text-emerald-200 text-sm mb-1">{bountyData.workType === 'online' ? 'Online' : 'In Person'}</Text>
                )}
                {bountyData.workType === 'in_person' && !!bountyData.location && (
                  <Text className="text-base text-emerald-200">{bountyData.location}</Text>
                )}
                {bountyData.isTimeSensitive && bountyData.deadline && (
                  <Text className="text-emerald-100 text-xs mt-1">Deadline: {bountyData.deadline}</Text>
                )}
              </View>
            </View>

            {/* Swipe indicator */}
              <View className="mt-8 flex flex-col items-center">
                <View style={{ opacity: isConfirming ? 0 : 1 }} className="text-center text-emerald-200 font-medium mb-3">
                  <Text className="text-center text-emerald-200 font-medium">
                    {dragProgress > 0.4 ? "Release to confirm" : "Swipe up to confirm"}
                  </Text>
                </View>

                <View className="relative h-16 w-full flex justify-center">
                  {/* Progress bar background */}
                  <View style={{ position: 'absolute', left: 0, right: 0, backgroundColor: 'rgba(0,92,28,0.3)', borderRadius: 999, height: 16, alignSelf: 'center', width: 192 }} />

                  {/* Progress bar fill */}
                  <View style={{ position: 'absolute', left: 0, right: 0, borderRadius: 999, height: 16, alignSelf: 'center', width: (dragProgress * 192), backgroundColor: '#008e2a' }} />

                  {/* Chevron indicators */}
                  <View className="absolute inset-0 flex flex-col items-center justify-center space-y-1 overflow-hidden max-w-48 mx-auto">
                    <MaterialIcons name="keyboard-arrow-up" size={24} color="#ffffff" />
                    <MaterialIcons name="keyboard-arrow-up" size={20} color="#ffffff" />
                    <MaterialIcons name="keyboard-arrow-up" size={16} color="#ffffff" />
                  </View>
                </View>
              </View>
          </View>

          {/* Confirmation state */}
          {isConfirming && (
            <View className="absolute inset-0 bg-emerald-600 flex items-center justify-center flex-col">
              <View className="h-16 w-16 rounded-full border-4 border-white border-t-transparent animate-spin mb-4"></View>
              <Text className="text-white font-medium text-lg">Posting your bounty...</Text>
            </View>
          )}
  </View>
      </View>
    </View>
  )
}
