/**
 * The stack's `slide_from_right` push, for full-screen steps that have no route
 * of their own (one person's offer, Fund and hire, reviewing the work).
 *
 *   SlideInScreen   slides its children in; for a step with nothing kept under it
 *   PushTransition  slides `top` in over `base`, which drifts left as it does in
 *                   a native push
 *
 * iOS uses the spring React Navigation uses to match UIKit's push; Android uses
 * the native stack's 400ms slide. Reanimated skips both under Reduce Motion.
 */
import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { easeOut } from '../../lib/motion';

const IOS_PUSH = { stiffness: 1000, damping: 500, mass: 3, overshootClamping: true } as const;
const ANDROID_PUSH = { duration: 400, easing: easeOut } as const;
/** How far the screen underneath drifts, as a share of the width (UIKit's 30%). */
const PARALLAX = Platform.OS === 'ios' ? 0.3 : 0;

const push = (to: number, done?: (finished?: boolean) => void) =>
  Platform.OS === 'ios' ? withSpring(to, IOS_PUSH, done) : withTiming(to, ANDROID_PUSH, done);

export function SlideInScreen({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const { width } = useWindowDimensions();
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = push(1);
  }, [progress]);
  const slide = useAnimatedStyle(() => ({ transform: [{ translateX: width * (1 - progress.value) }] }), [width]);
  return <Animated.View style={[styles.fill, style, slide]}>{children}</Animated.View>;
}

export function PushTransition({
  base,
  top,
  startOpen = false,
  slideOut = false,
}: {
  base: React.ReactNode;
  /** The step on top, or null when there is none. */
  top: React.ReactNode | null;
  /** The first `top` is already in place (the route itself just slid in). */
  startOpen?: boolean;
  /**
   * Keep the last `top` on screen while it slides away. Only for presentational
   * steps: one that runs timers or payments must unmount the moment it closes.
   */
  slideOut?: boolean;
}) {
  const { width } = useWindowDimensions();
  const open = top != null;
  const progress = useSharedValue(open && startOpen ? 1 : 0);
  const lastTop = useRef<React.ReactNode>(null);
  // True once a closed `top` has finished sliding away.
  const [gone, setGone] = useState(!open);
  const wasOpen = useRef(open && startOpen);
  const everOpened = useRef(open && startOpen);
  if (open) lastTop.current = top;

  // Before paint, so a closing step never blinks out before it slides away.
  React.useLayoutEffect(() => {
    if (open) {
      setGone(false);
      if (!wasOpen.current) progress.value = startOpen && !everOpened.current ? 1 : push(1);
      everOpened.current = true;
      wasOpen.current = true;
      return;
    }
    if (!wasOpen.current) return;
    wasOpen.current = false;
    if (!slideOut) {
      progress.value = push(0);
      setGone(true);
      return;
    }
    progress.value = push(0, (finished) => {
      'worklet';
      if (finished) runOnJS(setGone)(true);
    });
  }, [open, slideOut, startOpen, progress]);

  const topStyle = useAnimatedStyle(() => ({ transform: [{ translateX: width * (1 - progress.value) }] }), [width]);
  const baseStyle = useAnimatedStyle(() => ({ transform: [{ translateX: -width * PARALLAX * progress.value }] }), [width]);
  const shown = open ? top : slideOut && !gone ? lastTop.current : null;

  return (
    <View style={styles.clip}>
      <Animated.View
        style={[styles.fill, baseStyle]}
        pointerEvents={open ? 'none' : 'auto'}
        accessibilityElementsHidden={open}
        importantForAccessibility={open ? 'no-hide-descendants' : 'auto'}
      >
        {base}
      </Animated.View>
      {shown != null ? (
        <Animated.View style={[StyleSheet.absoluteFill, topStyle]} pointerEvents={open ? 'auto' : 'none'}>
          {shown}
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  clip: { flex: 1, overflow: 'hidden' },
});
