/**
 * Entrance motion for the root navigator's routes on web.
 *
 * The root navigator is a native stack (app/_layout.tsx). On iOS and Android
 * it animates pushes and pops itself; on web the stack swaps screens without
 * motion, so each route gets an entrance here when it mounts:
 *
 * - push (the route lands above the previous one): slides in from the right
 * - replace (same position, new route — sign-in, redirects): crossfade
 * - the first screen after load: no motion
 *
 * Going back on web reveals the screen below, which never unmounted, so it
 * returns instantly with its scroll position intact — like a browser back.
 *
 * Reduce Motion keeps the crossfade and drops the slide.
 *
 * Wired in through React Navigation's `screenLayout`, which wraps every
 * route's element and mounts with it, so the entrance plays exactly once per
 * arrival without touching the navigator itself.
 */
import type { Route } from '@react-navigation/native';
import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Reanimated, {
  ReduceMotion,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { distance, duration, easeOut } from '../../lib/motion';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';

export type RouteDirection = 'forward' | 'back' | 'replace' | 'none';

type Shown = { key: string; index: number };

/** The route most recently on screen, and where it sat in the stack. */
let lastShown: Shown | null = null;

/**
 * How a route arriving at `next` relates to the one that was on screen.
 * Exported for tests.
 */
export function routeDirection(prev: Shown | null, next: Shown): RouteDirection {
  if (!prev || prev.key === next.key) return 'none';
  if (next.index > prev.index) return 'forward';
  if (next.index < prev.index) return 'back';
  return 'replace';
}

type FocusEvents = {
  addListener: (event: 'focus', callback: () => void) => () => void;
};

type RouteTransitionProps = {
  routeKey: string;
  index: number;
  navigation: FocusEvents;
  children: React.ReactNode;
};

function RouteTransition({ routeKey, index, navigation, children }: RouteTransitionProps) {
  const { theme } = useAppThemeContext();
  const reduceMotion = useReducedMotion();
  // Decided once, on arrival. A later re-render of the same route must not
  // replay or retarget its entrance.
  const [direction] = useState(() => routeDirection(lastShown, { key: routeKey, index }));
  const [settled, setSettled] = useState(direction === 'none');

  // Keep the record current. A stack keeps every route mounted, so the one
  // on screen is the one most recently focused — not the most recently
  // mounted — and its index can move under it (routes below reset or
  // dismissed) without a remount.
  const indexRef = React.useRef(index);
  indexRef.current = index;
  useEffect(() => {
    lastShown = { key: routeKey, index };
  }, [routeKey, index]);
  useEffect(
    () =>
      navigation.addListener('focus', () => {
        lastShown = { key: routeKey, index: indexRef.current };
      }),
    [navigation, routeKey]
  );

  // A shared value + animated style rather than a layout `entering`
  // animation: Reanimated's web build only plays named presets, so a custom
  // entrance silently did nothing there. useAnimatedStyle computes the first
  // frame from the initial value, so the screen's first paint is already at
  // the start of the entrance — no flash of the settled screen.
  const [dx] = useState(() =>
    reduceMotion || (direction !== 'forward' && direction !== 'back')
      ? 0
      : direction === 'forward'
        ? distance.route
        : -distance.route
  );
  const progress = useSharedValue(direction === 'none' ? 1 : 0);

  useEffect(() => {
    if (direction === 'none') return;
    progress.value = withTiming(
      1,
      {
        duration: direction === 'replace' ? duration.base : duration.screen,
        easing: easeOut,
        // The crossfade is the Reduce Motion alternative to the slide, so it
        // still plays when Reduce Motion is on; dx is already 0 in that case.
        reduceMotion: ReduceMotion.Never,
      },
      finished => {
        if (finished) runOnJS(setSettled)(true);
      }
    );
    // The entrance is fixed at mount, like `direction`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const entranceStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateX: (1 - progress.value) * dx }],
  }));

  // Fallback in case the completion callback is dropped — the backdrop and
  // hardware layer must never outlive the entrance.
  useEffect(() => {
    if (settled) return;
    const t = setTimeout(() => setSettled(true), duration.screen + 120);
    return () => clearTimeout(t);
  }, [settled]);

  return (
    <View style={styles.fill}>
      {/* While the new screen fades up, show the theme's page color behind
          it rather than the root frame's (dark by default), which would
          read as a flash under a light-theme screen. */}
      {!settled && (
        <View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: theme.background }]}
        />
      )}
      <Reanimated.View
        style={[styles.fill, entranceStyle]}
        // Composite the fading screen as one layer on Android, so overlapping
        // children don't show through each other mid-fade.
        renderToHardwareTextureAndroid={!settled}
      >
        {children}
      </Reanimated.View>
    </View>
  );
}

type ScreenLayoutArgs = {
  route: Route<string>;
  navigation: FocusEvents & { getState: () => { routes: readonly { key: string }[] } };
  children: React.ReactElement;
};

/** Web `screenLayout` for the root stack (see app/_layout.tsx). */
export function routeTransitionLayout({ route, navigation, children }: ScreenLayoutArgs) {
  const index = navigation.getState().routes.findIndex(r => r.key === route.key);
  return (
    <RouteTransition routeKey={route.key} index={index} navigation={navigation}>
      {children}
    </RouteTransition>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
