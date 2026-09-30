/**
 * Shared step-progress indicator for the onboarding flow. Every onboarding
 * screen previously hand-rolled its own row of <View> dots with a hardcoded
 * count (some stale — e.g. a 5-dot indicator on a 3-step branch), so this
 * consolidates that into one accessible, animated, dynamically-sized version.
 */
import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, StyleSheet, View } from 'react-native';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';

/**
 * Steps in the onboarding funnel, and so the total every screen's dots show:
 * sign up (app/auth/sign-up-form.tsx, or app/onboarding/username.tsx) -> style
 * -> location -> role select -> payouts. The founder note
 * (app/onboarding/founder-note.tsx) closes the flow and is deliberately
 * unnumbered — it asks for nothing — and payouts renders no dots of its own,
 * but it is a step the user passes through, so it counts here.
 *
 * One constant, not a per-screen totalStepsFor(): the flow used to run two
 * lengths (poster/hunter branches were a step longer than the generic path)
 * and the count was duplicated in four files that had to be kept in sync.
 * Every path is now the same length.
 */
export const ONBOARDING_TOTAL_STEPS = 5;

export interface OnboardingProgressDotsProps {
  /** Total number of steps in this branch of the flow (e.g. 3 for poster, 4 for hunter). */
  total: number;
  /** Zero-indexed index of the current step. */
  activeIndex: number;
  style?: object;
  /** Override for screens with a solid-color background (e.g. the green funding step) where theme.primary/border wouldn't contrast. */
  inactiveColor?: string;
  activeColor?: string;
}

export function OnboardingProgressDots({
  total,
  activeIndex,
  style,
  inactiveColor,
  activeColor,
}: OnboardingProgressDotsProps) {
  const { theme } = useAppThemeContext();
  const resolvedInactive = inactiveColor ?? theme.border;
  const resolvedActive = activeColor ?? theme.primary;
  const resolvedCompleted = activeColor ?? theme.primaryLight ?? theme.primary;
  const widths = useRef(
    Array.from({ length: total }, (_, i) => new Animated.Value(i === activeIndex ? 1 : 0))
  ).current;
  const reduceMotionRef = useRef(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled?.().then((enabled) => {
      reduceMotionRef.current = !!enabled;
    });
  }, []);

  useEffect(() => {
    widths.forEach((value, i) => {
      const toValue = i === activeIndex ? 1 : 0;
      if (reduceMotionRef.current) {
        value.setValue(toValue);
        return;
      }
      Animated.timing(value, {
        toValue,
        duration: 200,
        useNativeDriver: false, // animating width, not a transform/opacity
      }).start();
    });
    // widths is a stable ref array; only re-run when the active step changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex, total]);

  return (
    <View
      style={[styles.container, style]}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`Step ${activeIndex + 1} of ${total}`}
      accessibilityValue={{ min: 1, max: total, now: activeIndex + 1 }}
    >
      {widths.map((value, i) => (
        <Animated.View
          key={i}
          style={[
            styles.dot,
            {
              backgroundColor: resolvedInactive,
              width: value.interpolate({ inputRange: [0, 1], outputRange: [8, 20] }),
            },
            i < activeIndex && { backgroundColor: resolvedCompleted },
          ]}
        >
          {i === activeIndex && (
            <Animated.View
              style={[StyleSheet.absoluteFill, styles.dot, { backgroundColor: resolvedActive }]}
            />
          )}
        </Animated.View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  dot: {
    height: 8,
    borderRadius: 4,
  },
});
