import { MaterialIcons } from '@expo/vector-icons';
import React, { useEffect } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { hapticFeedback } from '../../lib/haptic-feedback';
import { theme, colors } from '../../lib/theme';


interface SuccessAnimationProps {
  /**
   * Whether to show the animation
   */
  visible: boolean;
  /**
   * Icon to display (default: check-circle)
   */
  icon?: keyof typeof MaterialIcons.glyphMap;
  /**
   * Size of the icon
   */
  size?: number;
  /**
   * Color of the icon
   */
  color?: string;
  /**
   * Callback when animation completes
   */
  onComplete?: () => void;
}

/**
 * Success animation component that shows a checkmark with a scale and fade effect.
 * Respects reduced motion preferences for accessibility.
 */
export function SuccessAnimation({
  visible,
  icon = 'check-circle',
  size = 80,
  color = colors.primary[500],
  onComplete,
}: SuccessAnimationProps) {
  const scale = useSharedValue(0);
  const opacity = useSharedValue(0);
  const checkScale = useSharedValue(0);
  const [prefersReducedMotion, setPrefersReducedMotion] = React.useState(false);

  // Check for reduced motion preference
  useEffect(() => {
    const checkMotionPreference = async () => {
      try {
        const isReduceMotionEnabled = await AccessibilityInfo.isReduceMotionEnabled();
        setPrefersReducedMotion(isReduceMotionEnabled);
      } catch {
        setPrefersReducedMotion(false);
      }
    };
    checkMotionPreference();
  }, []);

  useEffect(() => {
    if (visible) {
      // Trigger success haptic
      hapticFeedback.success();

      if (prefersReducedMotion) {
        // Simple instant appearance for reduced motion
        scale.value = 1;
        opacity.value = 1;
        checkScale.value = 1;

        // Still call onComplete after a brief delay
        const timer = setTimeout(() => {
          onComplete?.();
        }, 800);
        return () => clearTimeout(timer);
      } else {
        // Full animation sequence
        // 1. Fade in container
        opacity.value = withTiming(1, { duration: 200 });

        // 2. Scale up circle with bounce
        scale.value = withSequence(
          withSpring(1.2, {
            damping: 8,
            stiffness: 100,
          }),
          withSpring(1, {
            damping: 12,
            stiffness: 200,
          })
        );

        // 3. Pop in checkmark slightly delayed
        checkScale.value = withDelay(
          150,
          withSpring(1, {
            damping: 10,
            stiffness: 150,
          })
        );

        // Call onComplete after animation finishes
        const timer = setTimeout(() => {
          onComplete?.();
        }, 1200);
        return () => clearTimeout(timer);
      }
    } else {
      // Reset animation values
      scale.value = 0;
      opacity.value = 0;
      checkScale.value = 0;
    }
  }, [visible, prefersReducedMotion, scale, opacity, checkScale, onComplete]);

  const containerStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  const circleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const checkStyle = useAnimatedStyle(() => ({
    transform: [{ scale: checkScale.value }],
  }));

  if (!visible) return null;

  return (
    <Animated.View style={[styles.container, containerStyle]}>
      <Animated.View style={[styles.circle, circleStyle]}>
        <Animated.View style={checkStyle}>
          <MaterialIcons
            name={icon}
            size={size}
            color={color}
            accessibilityLabel="Success"
          />
        </Animated.View>
      </Animated.View>
    </Animated.View>
  );
}

/**
 * Confetti animation component for celebration moments.
 * Uses simple particle effects that respect reduced motion preferences.
 */
interface ConfettiParticle {
  id: number;
  x: number;
  color: string;
}

export function ConfettiAnimation({ visible, onComplete }: { visible: boolean; onComplete?: () => void }) {
  const [particles] = React.useState<ConfettiParticle[]>(() =>
    Array.from({ length: 20 }, (_, i) => ({
      id: i,
      x: Math.random() * 100,
      color: [colors.primary[500], '#6ee7b7', colors.primary[600], '#34d399'][Math.floor(Math.random() * 4)],
    }))
  );
  const [prefersReducedMotion, setPrefersReducedMotion] = React.useState(false);

  // Check for reduced motion preference
  useEffect(() => {
    const checkMotionPreference = async () => {
      try {
        const isReduceMotionEnabled = await AccessibilityInfo.isReduceMotionEnabled();
        setPrefersReducedMotion(isReduceMotionEnabled);
      } catch {
        setPrefersReducedMotion(false);
      }
    };
    checkMotionPreference();
  }, []);

  useEffect(() => {
    if (visible) {
      hapticFeedback.success();
      const timer = setTimeout(() => {
        onComplete?.();
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [visible, onComplete]);

  if (!visible || prefersReducedMotion) return null;

  return (
    <View style={styles.confettiContainer} pointerEvents="none">
      {particles.map((particle) => (
        <ConfettiParticle key={particle.id} particle={particle} />
      ))}
    </View>
  );
}

function ConfettiParticle({ particle }: { particle: ConfettiParticle }) {
  const translateY = useSharedValue(-50);
  const translateX = useSharedValue(0);
  const opacity = useSharedValue(1);
  const rotation = useSharedValue(0);

  useEffect(() => {
    // Random fall duration between 1.5-2.5s
    const duration = 1500 + Math.random() * 1000;
    // Random horizontal drift
    const drift = (Math.random() - 0.5) * 100;

    translateY.value = withTiming(600, {
      duration,
      easing: Easing.bezier(0.25, 0.1, 0.25, 1),
    });

    translateX.value = withTiming(drift, {
      duration,
      easing: Easing.bezier(0.5, 0, 0.5, 1),
    });

    opacity.value = withTiming(0, {
      duration: duration * 0.8,
    });

    rotation.value = withTiming(360 * (2 + Math.random() * 2), {
      duration,
      easing: Easing.linear,
    });
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: translateY.value },
      { translateX: translateX.value },
      { rotate: `${rotation.value}deg` },
    ],
    opacity: opacity.value,
  }));

  return (
    <Animated.View
      style={[
        styles.particle,
        {
          left: `${particle.x}%`,
          backgroundColor: particle.color,
        },
        animatedStyle,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    zIndex: 1000,
  },
  circle: {
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderRadius: 80,
    width: 160,
    height: 160,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: colors.primary[500],
    ...theme.shadows.emerald,
  },

  confettiContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 999,
  },
  particle: {
    position: 'absolute',
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});
