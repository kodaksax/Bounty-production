/**
 * Ambient radial glow behind the welcome carousel (WelcomeCarousel.tsx).
 * A single persistent layer shared across all slides — not re-mounted per
 * slide — so it doesn't flash or reset as the user swipes.
 *
 * Opacity breathes 0.12 -> 0.16 -> 0.12 on a 20s cycle. Implemented as an
 * animated opacity on an SVG radial gradient (react-native-svg), never a
 * shadowRadius blur — shadows don't render a soft radial falloff on Android.
 */

import { useEffect, useState } from 'react';
import { AccessibilityInfo, StyleSheet } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import type { AppTheme } from '../../lib/themes/types';

const GLOW_SIZE = 560;
const BREATHE_MS = 20000;
const MIN_OPACITY = 0.12;
const MAX_OPACITY = 0.16;

interface CarouselGlowProps {
  theme: AppTheme;
  /** Vertical center of the glow, in px from the top of its container. */
  top?: number;
}

export function CarouselGlow({ theme, top = -80 }: CarouselGlowProps) {
  const [reduceMotion, setReduceMotion] = useState(false);
  const opacity = useSharedValue(MIN_OPACITY);

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .then(enabled => {
        if (!cancelled) setReduceMotion(enabled);
      })
      .catch(() => {});
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', enabled => {
      setReduceMotion(enabled);
    });
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      opacity.value = (MIN_OPACITY + MAX_OPACITY) / 2;
      return;
    }
    opacity.value = withRepeat(
      withTiming(MAX_OPACITY, { duration: BREATHE_MS, easing: Easing.inOut(Easing.sin) }),
      -1,
      true
    );
  }, [opacity, reduceMotion]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.wrap, { top }, animatedStyle]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Svg width={GLOW_SIZE} height={GLOW_SIZE}>
        <Defs>
          <RadialGradient id="carouselGlow" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor={theme.primary} stopOpacity={1} />
            <Stop offset="55%" stopColor={theme.primary} stopOpacity={0.5} />
            <Stop offset="100%" stopColor={theme.primary} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x={0} y={0} width={GLOW_SIZE} height={GLOW_SIZE} fill="url(#carouselGlow)" />
      </Svg>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    alignSelf: 'center',
    width: GLOW_SIZE,
    height: GLOW_SIZE,
  },
});
