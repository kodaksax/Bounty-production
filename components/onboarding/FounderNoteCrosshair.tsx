/**
 * The founder note's one piece of imagery (app/onboarding/founder-note.tsx):
 * the bounty crosshair — the mark from the wordmark logo
 * (assets/images/bounty-logo-green.png): a heavy ring crossed by four square
 * arms that start outside it, cut through it, and stop short of the centre,
 * leaving it open — locking on once the quote has landed.
 * It comes in oversized and settles straight down onto its target, no spin —
 * the quote names the gap, and the crosshair picks out the reader as the one
 * who closes it.
 *
 * Plays exactly once, driven by `active`. Under Reduce Motion the parent
 * passes `still` and the mark renders locked.
 */

import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

export const CROSSHAIR_LOCK_MS = 750;
const ICON = 72;

// Proportions measured off the logo, as fractions of the mark's full span
// (arm tip to arm tip). Drawn from Views rather than an icon font: no icon
// has arms that run inside the ring and leave the centre open.
const RING_OUTER = ICON * 0.72;
const RING_STROKE = ICON * 0.092;
const ARM_THICK = ICON * 0.088;
// Each arm runs from the outer tip to this far short of the centre.
const ARM_GAP = ICON * 0.132;
const ARM_LEN = ICON / 2 - ARM_GAP;

interface FounderNoteCrosshairProps {
  active: boolean;
  still: boolean;
  color: string;
  /** Fired once, the moment the crosshair locks on. */
  onLock?: () => void;
}

export function FounderNoteCrosshair({ active, still, color, onLock }: FounderNoteCrosshairProps) {
  const lock = useRef(new Animated.Value(still ? 1 : 0)).current;
  const onLockRef = useRef(onLock);
  onLockRef.current = onLock;

  useEffect(() => {
    if (still) {
      lock.setValue(1);
      return;
    }
    if (!active) return;
    const run = Animated.timing(lock, {
      toValue: 1,
      duration: CROSSHAIR_LOCK_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    const locked = setTimeout(() => onLockRef.current?.(), CROSSHAIR_LOCK_MS);
    run.start();
    return () => {
      clearTimeout(locked);
      run.stop();
    };
  }, [active, still, lock]);

  const scale = lock.interpolate({ inputRange: [0, 1], outputRange: [1.9, 1] });
  const opacity = lock.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 0.8, 1] });

  return (
    <View
      style={styles.wrap}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Animated.View style={[styles.mark, { opacity, transform: [{ scale }] }]}>
        <View style={[styles.ring, { borderColor: color }]} />
        <View style={[styles.arm, styles.armTop, { backgroundColor: color }]} />
        <View style={[styles.arm, styles.armBottom, { backgroundColor: color }]} />
        <View style={[styles.arm, styles.armLeft, { backgroundColor: color }]} />
        <View style={[styles.arm, styles.armRight, { backgroundColor: color }]} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: ICON * 1.5,
    height: ICON * 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mark: {
    width: ICON,
    height: ICON,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    width: RING_OUTER,
    height: RING_OUTER,
    borderRadius: RING_OUTER / 2,
    borderWidth: RING_STROKE,
  },
  arm: { position: 'absolute' },
  armTop: {
    top: 0,
    left: (ICON - ARM_THICK) / 2,
    width: ARM_THICK,
    height: ARM_LEN,
  },
  armBottom: {
    bottom: 0,
    left: (ICON - ARM_THICK) / 2,
    width: ARM_THICK,
    height: ARM_LEN,
  },
  armLeft: {
    left: 0,
    top: (ICON - ARM_THICK) / 2,
    width: ARM_LEN,
    height: ARM_THICK,
  },
  armRight: {
    right: 0,
    top: (ICON - ARM_THICK) / 2,
    width: ARM_LEN,
    height: ARM_THICK,
  },
});
