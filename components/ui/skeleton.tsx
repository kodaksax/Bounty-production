import React, { useEffect, useRef } from "react"
import { Animated, ViewProps, StyleSheet, View, Dimensions, AccessibilityInfo } from "react-native"
import { LinearGradient } from 'expo-linear-gradient'
import { cn } from "lib/utils"
import { COLORS } from "../../lib/constants/accessibility"

const { width: SCREEN_WIDTH } = Dimensions.get('window')

interface SkeletonProps extends ViewProps {
  className?: string
  /**
   * Enable shimmer effect for better perceived performance
   * @default true
   */
  shimmer?: boolean
  /**
   * Animation duration in milliseconds
   * @default 1200
   */
  duration?: number
}

/**
 * Enhanced Skeleton component with shimmer effect for better perceived performance.
 * Respects reduced motion preferences for accessibility.
 */
const Skeleton = React.memo(function Skeleton({
  className,
  style,
  shimmer = true,
  duration = 1200,
  ...props
}: SkeletonProps) {
  // Animated value for shimmer translation
  const shimmerAnim = useRef(new Animated.Value(-1)).current
  // Fallback pulse animation for reduced motion
  const pulseAnim = useRef(new Animated.Value(0.4)).current
  const [prefersReducedMotion, setPrefersReducedMotion] = React.useState(false)

  // Check for reduced motion preference
  useEffect(() => {
    let mounted = true
    
    const checkMotionPreference = async () => {
      try {
        const isReduceMotionEnabled = await AccessibilityInfo.isReduceMotionEnabled()
        if (mounted) {
          setPrefersReducedMotion(isReduceMotionEnabled)
        }
      } catch {
        // Default to false if we can't determine
        if (mounted) {
          setPrefersReducedMotion(false)
        }
      }
    }
    checkMotionPreference()

    // Listen for changes to the preference
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      (reduceMotionEnabled) => {
        if (mounted) {
          setPrefersReducedMotion(reduceMotionEnabled)
        }
      }
    )

    return () => {
      mounted = false
      subscription?.remove()
    }
  }, [])

  useEffect(() => {
    if (prefersReducedMotion) {
      // Simple pulse animation for reduced motion
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 0.7,
            duration: duration,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 0.4,
            duration: duration,
            useNativeDriver: true,
          }),
        ])
      )
      pulse.start()
      return () => pulse.stop()
    } else if (shimmer) {
      // Shimmer animation for normal motion
      const shimmerLoop = Animated.loop(
        Animated.timing(shimmerAnim, {
          toValue: 1,
          duration: duration,
          useNativeDriver: true,
        })
      )
      shimmerLoop.start()
      return () => shimmerLoop.stop()
    }
  }, [shimmer, duration, shimmerAnim, pulseAnim, prefersReducedMotion])

  // Calculate shimmer translation based on animation progress
  const shimmerTranslate = shimmerAnim.interpolate({
    inputRange: [-1, 1],
    outputRange: [-SCREEN_WIDTH, SCREEN_WIDTH],
  })

  // For reduced motion or no shimmer, use simple opacity animation
  if (prefersReducedMotion || !shimmer) {
    return (
      <Animated.View
        className={cn("rounded-md overflow-hidden", className)}
        style={[
          styles.base,
          { opacity: pulseAnim },
          style,
        ]}
        accessible={false}
        importantForAccessibility="no-hide-descendants"
        {...props}
      />
    )
  }

  // Shimmer effect with gradient
  return (
    <View
      className={cn("rounded-md overflow-hidden", className)}
      style={[styles.base, style]}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      {...props}
    >
      <Animated.View
        style={[
          styles.shimmerContainer,
          {
            transform: [{ translateX: shimmerTranslate }],
          },
        ]}
      >
        <LinearGradient
          colors={[
            'transparent',
            'rgba(255, 255, 255, 0.15)',
            'rgba(255, 255, 255, 0.25)',
            'rgba(255, 255, 255, 0.15)',
            'transparent',
          ]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={styles.shimmerGradient}
        />
      </Animated.View>
    </View>
  )
})

const styles = StyleSheet.create({
  base: {
    backgroundColor: COLORS.EMERALD_700 + '66', // emerald-700 with ~40% opacity (0x66 = 102/255 ≈ 40%)
  },
  shimmerContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: '100%',
  },
  shimmerGradient: {
    width: '50%',
    height: '100%',
  },
})

export { Skeleton }
