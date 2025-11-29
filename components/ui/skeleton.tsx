import React, { useEffect, useRef, useState } from "react"
import { Animated, Dimensions, ViewProps, View, StyleSheet } from "react-native"
import { LinearGradient } from "expo-linear-gradient"
import { cn } from "lib/utils"
import { useReducedMotion } from "lib/accessibility-utils"

interface SkeletonProps extends ViewProps {
  className?: string
  /** Enable shimmer effect for better perceived performance */
  shimmer?: boolean
  /** Shimmer animation duration in ms (default: 1500) */
  shimmerDuration?: number
}

/**
 * Skeleton loading placeholder with optional shimmer effect
 * Respects reduced motion preferences for accessibility
 */
const Skeleton = React.memo(function Skeleton({
  className,
  style,
  shimmer = true,
  shimmerDuration = 1500,
  ...props
}: SkeletonProps) {
  const { prefersReducedMotion } = useReducedMotion()
  
  // Handle screen dimensions for orientation changes
  const [screenWidth, setScreenWidth] = useState(Dimensions.get('window').width)
  
  useEffect(() => {
    const subscription = Dimensions.addEventListener('change', ({ window }) => {
      setScreenWidth(window.width)
    })
    return () => subscription?.remove()
  }, [])
  
  // Animated pulse effect using opacity (fallback for non-shimmer or reduced motion)
  const pulseAnim = useRef(new Animated.Value(0.4)).current
  // Shimmer translation animation
  const shimmerAnim = useRef(new Animated.Value(-screenWidth)).current

  useEffect(() => {
    // If user prefers reduced motion, use simpler animation
    if (prefersReducedMotion) {
      const simplePulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 0.7,
            duration: 1200,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 0.4,
            duration: 1200,
            useNativeDriver: true,
          }),
        ])
      )
      simplePulse.start()
      return () => simplePulse.stop()
    }

    // Create a looping pulse animation
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0.4,
          duration: 800,
          useNativeDriver: true,
        }),
      ])
    )

    pulse.start()

    // Start shimmer animation if enabled
    if (shimmer && !prefersReducedMotion) {
      const shimmerLoop = Animated.loop(
        Animated.timing(shimmerAnim, {
          toValue: screenWidth,
          duration: shimmerDuration,
          useNativeDriver: true,
        })
      )
      shimmerLoop.start()
      return () => {
        pulse.stop()
        shimmerLoop.stop()
      }
    }

    return () => {
      pulse.stop()
    }
  }, [pulseAnim, shimmerAnim, shimmer, shimmerDuration, prefersReducedMotion])

  // Render shimmer overlay if enabled and motion is allowed
  const renderShimmer = shimmer && !prefersReducedMotion

  return (
    <Animated.View
      className={cn("rounded-md bg-muted overflow-hidden", className)}
      style={[{ opacity: pulseAnim }, style]}
      accessibilityElementsHidden={true}
      importantForAccessibility="no-hide-descendants"
      {...props}
    >
      {renderShimmer && (
        <Animated.View
          style={[
            styles.shimmerOverlay,
            {
              transform: [{ translateX: shimmerAnim }],
            },
          ]}
          pointerEvents="none"
        >
          <LinearGradient
            colors={[
              'rgba(255, 255, 255, 0)',
              'rgba(255, 255, 255, 0.15)',
              'rgba(255, 255, 255, 0.3)',
              'rgba(255, 255, 255, 0.15)',
              'rgba(255, 255, 255, 0)',
            ]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={styles.shimmerGradient}
          />
        </Animated.View>
      )}
    </Animated.View>
  )
})

const styles = StyleSheet.create({
  shimmerOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '200%', // Wide enough to cover the entire element during animation
  },
  shimmerGradient: {
    flex: 1,
    width: '100%',
  },
})

export { Skeleton }
