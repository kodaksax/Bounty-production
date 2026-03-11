// components/onboarding/Hotspot.tsx
// Small pulsing circle overlay that draws the user's attention to a key UI element.
// Disappears once the user interacts with the target.

import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, TouchableOpacity, View } from 'react-native';

interface HotspotProps {
  /** Controls whether the hotspot is rendered. */
  visible: boolean;
  /**
   * Called when the user taps the hotspot indicator itself.
   * The parent should call onboardingManager.completeStep() here if appropriate.
   */
  onPress?: () => void;
  /** Optional size override for the outer pulse ring (default 36). */
  size?: number;
}

/**
 * Hotspot renders a small pulsing circle that can be layered on top of (or near)
 * a UI element to hint that it's interactive. Wrap the target element with a
 * relative-positioned View and place <Hotspot> as an absolute sibling, e.g.:
 *
 * ```tsx
 * <View style={{ position: 'relative' }}>
 *   <SomeButton />
 *   <View style={{ position: 'absolute', top: -4, right: -4 }}>
 *     <Hotspot visible={showHotspot} onPress={handleHotspotPress} />
 *   </View>
 * </View>
 * ```
 */
export function Hotspot({ visible, onPress, size = 36 }: HotspotProps) {
  const pulseAnim = useRef(new Animated.Value(0.6)).current;
  const opacityAnim = useRef(new Animated.Value(0.7)).current;

  useEffect(() => {
    if (!visible) return;

    const pulse = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 900,
            useNativeDriver: true,
          }),
          Animated.timing(opacityAnim, {
            toValue: 0,
            duration: 900,
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(pulseAnim, {
            toValue: 0.6,
            duration: 0,
            useNativeDriver: true,
          }),
          Animated.timing(opacityAnim, {
            toValue: 0.7,
            duration: 0,
            useNativeDriver: true,
          }),
        ]),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [visible, pulseAnim, opacityAnim]);

  if (!visible) return null;

  const inner = size * 0.4;

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel="Highlighted feature — tap to explore"
      style={styles.wrapper}
    >
      {/* Pulsing outer ring */}
      <Animated.View
        style={[
          styles.pulse,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            transform: [{ scale: pulseAnim }],
            opacity: opacityAnim,
          },
        ]}
      />
      {/* Solid inner dot */}
      <View
        style={[
          styles.dot,
          {
            width: inner,
            height: inner,
            borderRadius: inner / 2,
          },
        ]}
      />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulse: {
    position: 'absolute',
    backgroundColor: 'rgba(16, 185, 129, 0.35)',
    borderWidth: 2,
    borderColor: 'rgba(16, 185, 129, 0.6)',
  },
  dot: {
    backgroundColor: '#10b981',
  },
});
