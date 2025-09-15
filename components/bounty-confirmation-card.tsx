import React, { useEffect, useRef, useState } from "react"
import { 
  View, 
  Text, 
  TouchableOpacity, 
  Animated, 
  PanGestureHandler,
  Dimensions,
  StyleSheet 
} from "react-native"
import { MaterialIcons } from "@expo/vector-icons"

interface BountyConfirmationCardProps {
  bountyData: {
    title: string
    description: string
    amount: number
    isForHonor: boolean
    location: string
  }
  onConfirm: () => Promise<void>
  onCancel: () => void
}

export function BountyConfirmationCard({ bountyData, onConfirm, onCancel }: BountyConfirmationCardProps) {
  const [isDragging, setIsDragging] = useState(false)
  const [dragProgress, setDragProgress] = useState(0)
  const [isConfirming, setIsConfirming] = useState(false)
  const cardControls = useAnimation()
  const dragConstraintsRef = useRef<HTMLDivElement>(null)
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
  const handleDragEnd = async (event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    setIsDragging(false)

    // If dragged up more than 40% of the height, confirm the bounty
    if (dragProgress > 0.4) {
      setIsConfirming(true)

      // Animate to the top but keep centered
      await cardControls.start({
        y: -windowHeight * 0.3, // Move up but stay visible
        scale: 0.98,
        transition: {
          duration: 0.5,
          ease: [0.32, 0.72, 0, 1], // iOS-like easing
        },
      })

      // Call the confirm function
      await onConfirm()
    } else {
      // Reset position with spring animation
      cardControls.start({
        y: 0,
        scale: 1,
        transition: {
          type: "spring",
          stiffness: 400,
          damping: 30,
        },
      })
      setDragProgress(0)
    }
  }

  // Handle drag
  const handleDrag = (event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    setIsDragging(true)

    // Calculate drag progress (negative because we're dragging upward)
    const maxDrag = -windowHeight * 0.3 // Proportional to screen height
    const progress = Math.min(Math.max((info.offset.y / maxDrag) * -1, 0), 1)
    setDragProgress(progress)
  }

  // Cancel with escape key (not supported in React Native, so this is omitted)
  // If you want to handle hardware back button on Android, use BackHandler from 'react-native'.

  return (
    <View
      style="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onPress={onCancel}
    >
      <View
        ref={dragConstraintsRef}
        style="flex items-center justify-center w-full h-full px-4"
        onPress={(e) => e.stopPropagation()}
      >
        <motion.div
          className="bg-emerald-600 rounded-2xl overflow-hidden shadow-xl w-full max-w-md mx-auto"
          initial={{ y: windowHeight, opacity: 0 }}
          animate={{
            y: 0,
            opacity: 1,
            transition: {
              type: "spring",
              stiffness: 300,
              damping: 30,
              opacity: { duration: 0.2 },
            },
          }}
          exit={{ y: windowHeight, opacity: 0 }}
          drag="y"
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={0.1}
          onDrag={handleDrag}
          onDragEnd={handleDragEnd}
          dragDirectionLock
          style={{
            maxHeight: `${windowHeight * 0.8}px`, // Limit height to 80% of viewport
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            marginTop: isConfirming ? "-10%" : "0", // Move up slightly when confirming
          }}
        >
          {/* Header */}
          <View className="p-4 bg-emerald-700 flex items-center justify-center">
            <Target className="h-5 w-5 mr-2 text-white" />
            <Text className="text-lg font-bold tracking-wider text-white">BOUNTY</Text>
          </View>

          {/* Content */}
          <View className="p-5 overflow-y-auto" style={{ maxHeight: `${windowHeight * 0.5}px` }}>
            <Text className="text-xl font-bold text-white mb-3">{bountyData.title}</Text>
            <Text className="text-emerald-100 mb-4 text-base line-clamp-3">{bountyData.description}</Text>

            <View className="flex justify-between items-center mb-4">
              <View className="bg-emerald-700/50 px-4 py-2 rounded-lg text-white font-bold text-lg">
                {bountyData.isForHonor ? "For Honor" : `$${bountyData.amount.toLocaleString()}`}
              </View>
              <View className="text-base text-emerald-200">{bountyData.location}</View>
            </View>

            {/* Swipe indicator */}
            <View className="mt-8 flex flex-col items-center">
              <View

                className={cn(
                  "text-center text-emerald-200 font-medium mb-3 transition-opacity",
                  isConfirming ? "opacity-0" : "opacity-100",
                )}
              >
                <Text className="text-center text-emerald-200 font-medium">
                  {dragProgress > 0.4 ? "Release to confirm" : "Swipe up to confirm"}
                </Text>
              </View>

              <View className="relative h-16 w-full flex justify-center">
                {/* Progress bar background */}
                <View className="absolute inset-0 bg-emerald-700/30 rounded-full max-w-48 mx-auto"></View>

                {/* Progress bar fill */}
                <motion.div
                  className="absolute inset-0 bg-emerald-500 rounded-full max-w-48 mx-auto origin-bottom"
                  style={{ scaleY: dragProgress }}
                  animate={{
                    scaleY: isConfirming ? 1 : dragProgress,
                  }}
                />

                {/* Chevron indicators */}
                <View className="absolute inset-0 flex flex-col items-center justify-center space-y-1 overflow-hidden max-w-48 mx-auto">
                  <ChevronUp
                    className={cn(
                      "h-6 w-6 text-white transition-all",
                      isDragging ? "opacity-0" : "opacity-100 animate-bounce",
                    )}
                  />
                  <ChevronUp
                    className={cn(
                      "h-6 w-6 text-white transition-all",
                      isDragging ? "opacity-0" : "opacity-70 animate-bounce animation-delay-100",
                    )}
                  />
                  <ChevronUp
                    className={cn(
                      "h-6 w-6 text-white transition-all",
                      isDragging ? "opacity-0" : "opacity-40 animate-bounce animation-delay-200",
                    )}
                  />
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
        </motion.div>
      </View>
    </View>
  )
}
