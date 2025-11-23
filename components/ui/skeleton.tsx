import { useEffect, useRef } from "react"
import { Animated, ViewProps } from "react-native"
import { cn } from "lib/utils"

interface SkeletonProps extends ViewProps {
  className?: string
}

function Skeleton({
  className,
  style,
  ...props
}: SkeletonProps) {
  // Animated pulse effect using opacity
  const pulseAnim = useRef(new Animated.Value(0.3)).current

  useEffect(() => {
    // Create a looping pulse animation
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0.3,
          duration: 800,
          useNativeDriver: true,
        }),
      ])
    )

    pulse.start()

    return () => {
      pulse.stop()
    }
  }, [pulseAnim])

  return (
    <Animated.View
      className={cn("rounded-md bg-muted", className)}
      style={[{ opacity: pulseAnim }, style]}
      {...props}
    />
  )
}

export { Skeleton }
