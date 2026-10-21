import React, { useEffect, useState } from "react"
import { Animated, ViewProps, StyleSheet, View, Dimensions } from "react-native"
import { LinearGradient } from 'expo-linear-gradient'
import { useReducedMotion } from 'react-native-reanimated'
import { cn } from "lib/utils"
import { easeInOut } from "../../lib/motion"

const { width: SCREEN_WIDTH } = Dimensions.get('window')

/** One full highlight sweep, start to finish. */
const SWEEP_MS = 1400

interface SkeletonProps extends ViewProps {
  className?: string
  /**
   * Animate the placeholder (a sweep, or a gentle pulse under Reduce Motion).
   * `false` renders a static block and doesn't start the shared clock.
   * @default true
   */
  shimmer?: boolean
  /**
   * @deprecated Every skeleton now shares one clock (see useSharedSweep) so
   * a screen of placeholders moves in step; a per-block duration would
   * break that. Kept so existing call sites still type-check.
   */
  duration?: number
}

// One clock drives every skeleton on screen. Each block used to run its own
// loop (and its own Reduce Motion subscription), so a list of placeholders
// shimmered out of phase — dozens of bands crossing at different moments.
// Now they sweep together, and only one loop runs no matter how many mount.
let sweep: Animated.Value | null = null
let sweepLoop: Animated.CompositeAnimation | null = null
let sweepUsers = 0

function useSharedSweep(active: boolean): Animated.Value {
  const [value] = useState(() => (sweep ??= new Animated.Value(0)))

  useEffect(() => {
    // A static skeleton doesn't count as a user, so it never starts the loop.
    if (!active) return
    sweepUsers += 1
    if (sweepUsers === 1) {
      value.setValue(0)
      sweepLoop = Animated.loop(
        Animated.timing(value, {
          toValue: 1,
          duration: SWEEP_MS,
          easing: easeInOut,
          useNativeDriver: true,
        })
      )
      sweepLoop.start()
    }
    return () => {
      sweepUsers -= 1
      if (sweepUsers === 0) {
        sweepLoop?.stop()
        sweepLoop = null
      }
    }
  }, [value, active])

  return value
}

/**
 * Placeholder block with a soft shimmer. Under Reduce Motion the sweep is
 * replaced by a gentle in-place pulse — no movement, same rhythm.
 */
const Skeleton = React.memo(function Skeleton({
  className,
  style,
  shimmer = true,
  duration: _duration,
  ...props
}: SkeletonProps) {
  const clock = useSharedSweep(shimmer)
  const reduceMotion = useReducedMotion()

  if (!shimmer) {
    return (
      <View
        className={cn("rounded-md overflow-hidden", className)}
        style={[styles.base, style]}
        accessible={false}
        importantForAccessibility="no-hide-descendants"
        {...props}
      />
    )
  }

  if (reduceMotion) {
    // 0.5 at both ends of the clock, so the loop's restart is seamless.
    const pulse = clock.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.5, 1, 0.5] })
    return (
      <Animated.View
        className={cn("rounded-md overflow-hidden", className)}
        style={[styles.base, { opacity: pulse }, style]}
        accessible={false}
        importantForAccessibility="no-hide-descendants"
        {...props}
      />
    )
  }

  const shimmerTranslate = clock.interpolate({
    inputRange: [0, 1],
    outputRange: [-SCREEN_WIDTH, SCREEN_WIDTH],
  })

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
            'rgba(255, 255, 255, 0.07)',
            'rgba(255, 255, 255, 0.13)',
            'rgba(255, 255, 255, 0.07)',
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
    // A translucent neutral rather than a fixed dark tint: it reads as a
    // slightly raised block on dark surfaces and a light-gray one on light
    // surfaces. The old dark-at-40% rendered medium gray in light mode.
    backgroundColor: 'rgba(140, 140, 150, 0.16)',
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
