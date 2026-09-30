import * as Haptics from 'expo-haptics';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useAppThemeContext } from '../../../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../../../lib/themes/types';

interface PostCelebrationProps {
  /** Called once the overlay has fully faded out (or was tapped away). */
  onDone: () => void;
}

// Timeline, in ms from mount.
const ARMS_AT = 220; // crosshair arms slide in and "lock on"
const LOCK_AT = 560; // centre dot pops, confetti bursts
const TEXT_AT = 700;
const HOLD_UNTIL = 3000; // then fade out into the confirmation step
const FADE_MS = 420;
const REDUCED_HOLD_UNTIL = 2200;

const CROSSHAIR = 196;
const RING = 136;
// Long enough to cross the ring and poke into it, like the brand mark's arms.
const ARM_LENGTH = 44;
const ARM_THICKNESS = 7;
const CONFETTI_COUNT = 36;

type Piece = {
  dx: number;
  dy: number;
  fall: number;
  spin: number;
  color: string;
  w: number;
  h: number;
  round: boolean;
  delay: number;
};

function makeConfetti(theme: AppTheme): Piece[] {
  // Brand greens plus a few warm colors so it reads as a celebration rather
  // than a status indicator.
  const colors = [theme.primary, theme.primaryLight, '#FBBF24', '#F472B6', '#60A5FA', '#F97316'];
  return Array.from({ length: CONFETTI_COUNT }, (_, i) => {
    // Spread evenly around the circle with a little jitter, biased upward so
    // the burst clears the heading below the crosshair.
    const angle = (i / CONFETTI_COUNT) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
    const distance = 150 + Math.random() * 120;
    return {
      dx: Math.cos(angle) * distance,
      dy: Math.sin(angle) * distance * 0.8 - 50,
      fall: 90 + Math.random() * 90,
      spin: (Math.random() > 0.5 ? 1 : -1) * (180 + Math.random() * 360),
      color: colors[i % colors.length],
      w: 10 + Math.random() * 6,
      h: 15 + Math.random() * 8,
      round: i % 4 === 0,
      delay: Math.random() * 90,
    };
  });
}

/**
 * The moment right after a bounty goes live: the bounty crosshair locks on,
 * confetti bursts out of it, and a short congratulations sits beneath. Then
 * the whole thing fades away, revealing the confirmation step (rendered
 * underneath this overlay the entire time).
 *
 * Tap anywhere to skip. With Reduce Motion on, there's no motion or confetti:
 * the same message fades in, holds briefly, and fades out.
 */
export function PostCelebration({ onDone }: PostCelebrationProps) {
  const { theme } = useAppThemeContext();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const confetti = useMemo(() => makeConfetti(theme), [theme]);

  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);

  const overlay = useRef(new Animated.Value(1)).current;
  const plate = useRef(new Animated.Value(0)).current;
  const arms = useRef(new Animated.Value(0)).current;
  const dot = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const burst = useRef(new Animated.Value(0)).current;
  const title = useRef(new Animated.Value(0)).current;
  const subtitle = useRef(new Animated.Value(0)).current;

  const doneRef = useRef(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const finish = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    Animated.timing(overlay, {
      toValue: 0,
      duration: FADE_MS,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start(() => onDoneRef.current());
  };

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .then(v => !cancelled && setReduceMotion(v))
      .catch(() => !cancelled && setReduceMotion(false));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (reduceMotion === null) return;
    AccessibilityInfo.announceForAccessibility?.('Your bounty is posted! Hunters can see it now.');

    if (reduceMotion) {
      [plate, arms, dot, title, subtitle].forEach(v => v.setValue(1));
      const t = setTimeout(finish, REDUCED_HOLD_UNTIL);
      return () => clearTimeout(t);
    }

    const spring = (v: Animated.Value, delay: number, bounciness = 8) =>
      Animated.spring(v, { toValue: 1, delay, bounciness, speed: 10, useNativeDriver: true });
    const timing = (v: Animated.Value, delay: number, duration: number) =>
      Animated.timing(v, {
        toValue: 1,
        delay,
        duration,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      });

    Animated.parallel([
      spring(plate, 0, 6),
      spring(arms, ARMS_AT, 4),
      spring(dot, LOCK_AT, 14),
      timing(pulse, LOCK_AT, 900),
      timing(burst, LOCK_AT, 1500),
      timing(title, TEXT_AT, 420),
      timing(subtitle, TEXT_AT + 160, 420),
    ]).start();

    const haptic = setTimeout(() => {
      // Best-effort: unsupported devices reject, and nothing here depends on it.
      Promise.resolve(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)).catch(
        () => {}
      );
    }, LOCK_AT);
    const hold = setTimeout(finish, HOLD_UNTIL);
    return () => {
      clearTimeout(haptic);
      clearTimeout(hold);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduceMotion]);

  // Arms start pushed outward and slide in to meet the ring.
  const armIn = arms.interpolate({ inputRange: [0, 1], outputRange: [36, 0] });
  const armInReverse = arms.interpolate({ inputRange: [0, 1], outputRange: [-36, 0] });
  const rise = (v: Animated.Value) => ({
    opacity: v,
    transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
  });

  return (
    <Animated.View style={[styles.overlay, { opacity: overlay }]}>
      <Pressable
        style={styles.fill}
        onPress={finish}
        accessibilityRole="button"
        accessibilityLabel="Your bounty is posted! Hunters can see it now. When someone steps up to help, we'll let you know."
        accessibilityHint="Continues to your bounty"
        testID="post-celebration"
      >
        <View style={styles.center}>
          <View style={styles.crosshair}>
            {/* Confetti bursts from the centre of the crosshair. */}
            {!reduceMotion &&
              confetti.map((p, i) => {
                // Each piece's own start delay is folded into its input
                // ranges: it holds at the origin until t0, then plays out.
                const t0 = p.delay / 1500;
                const span = 1 - t0;
                const at = (fraction: number) => t0 + span * fraction;
                return (
                  <Animated.View
                    key={i}
                    pointerEvents="none"
                    style={[
                      styles.piece,
                      {
                        width: p.w,
                        height: p.round ? p.w : p.h,
                        borderRadius: p.round ? p.w / 2 : 2.5,
                        backgroundColor: p.color,
                        opacity: burst.interpolate({
                          inputRange: [0, t0, at(0.05), at(0.7), 1],
                          outputRange: [0, 0, 1, 1, 0],
                        }),
                        transform: [
                          {
                            translateX: burst.interpolate({
                              inputRange: [0, t0, 1],
                              outputRange: [0, 0, p.dx],
                            }),
                          },
                          {
                            // Shoots out fast, then drifts down as it fades.
                            translateY: burst.interpolate({
                              inputRange: [0, t0, at(0.35), 1],
                              outputRange: [0, 0, p.dy, p.dy + p.fall],
                            }),
                          },
                          {
                            rotate: burst.interpolate({
                              inputRange: [0, t0, 1],
                              outputRange: ['0deg', '0deg', `${p.spin}deg`],
                            }),
                          },
                        ],
                      },
                    ]}
                  />
                );
              })}

            {/* Soft glow plate behind the mark. */}
            <Animated.View
              style={[
                styles.halo,
                {
                  opacity: plate.interpolate({ inputRange: [0, 1], outputRange: [0, 0.14] }),
                  transform: [
                    { scale: plate.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) },
                  ],
                },
              ]}
            />

            {/* One ripple outward at the moment of lock-on. */}
            {!reduceMotion && (
              <Animated.View
                style={[
                  styles.pulse,
                  {
                    opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] }),
                    transform: [
                      { scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.7] }) },
                    ],
                  },
                ]}
              />
            )}

            <Animated.View
              style={[
                styles.ring,
                {
                  opacity: plate,
                  transform: [
                    { scale: plate.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }) },
                  ],
                },
              ]}
            />

            {/* Arms: top, bottom, left, right. */}
            <Animated.View
              style={[
                styles.arm,
                styles.armVertical,
                {
                  top: 0,
                  opacity: arms,
                  transform: [{ translateY: armInReverse }],
                },
              ]}
            />
            <Animated.View
              style={[
                styles.arm,
                styles.armVertical,
                { bottom: 0, opacity: arms, transform: [{ translateY: armIn }] },
              ]}
            />
            <Animated.View
              style={[
                styles.arm,
                styles.armHorizontal,
                {
                  left: 0,
                  opacity: arms,
                  transform: [{ translateX: armInReverse }],
                },
              ]}
            />
            <Animated.View
              style={[
                styles.arm,
                styles.armHorizontal,
                { right: 0, opacity: arms, transform: [{ translateX: armIn }] },
              ]}
            />

            <Animated.View
              style={[
                styles.dot,
                {
                  opacity: dot,
                  transform: [
                    { scale: dot.interpolate({ inputRange: [0, 1], outputRange: [0.2, 1] }) },
                  ],
                },
              ]}
            />
          </View>

          <Animated.Text style={[styles.title, rise(title)]} maxFontSizeMultiplier={1.6}>
            Your bounty is posted!
          </Animated.Text>
          <Animated.Text style={[styles.subtitle, rise(subtitle)]} maxFontSizeMultiplier={1.6}>
            Hunters can see it now. When someone steps up to help, we&apos;ll let you know.
          </Animated.Text>
        </View>

        <Animated.View style={[styles.skipWrap, { opacity: subtitle }]}>
          <Text style={styles.skip}>Tap to continue</Text>
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}

function makeStyles(t: AppTheme) {
  return StyleSheet.create({
    overlay: {
      ...StyleSheet.absoluteFillObject,
      zIndex: 100,
      elevation: 100,
      backgroundColor: t.background,
    },
    fill: {
      flex: 1,
      justifyContent: 'center',
    },
    center: {
      alignItems: 'center',
      paddingHorizontal: 32,
    },
    crosshair: {
      width: CROSSHAIR,
      height: CROSSHAIR,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 44,
    },
    piece: {
      position: 'absolute',
    },
    halo: {
      position: 'absolute',
      width: CROSSHAIR + 40,
      height: CROSSHAIR + 40,
      borderRadius: (CROSSHAIR + 40) / 2,
      backgroundColor: t.primary,
    },
    pulse: {
      position: 'absolute',
      width: RING,
      height: RING,
      borderRadius: RING / 2,
      borderWidth: 4,
      borderColor: t.primary,
    },
    ring: {
      position: 'absolute',
      width: RING,
      height: RING,
      borderRadius: RING / 2,
      borderWidth: ARM_THICKNESS,
      borderColor: t.primary,
    },
    arm: {
      position: 'absolute',
      backgroundColor: t.primary,
      borderRadius: ARM_THICKNESS / 2,
    },
    armVertical: {
      width: ARM_THICKNESS,
      height: ARM_LENGTH,
      left: (CROSSHAIR - ARM_THICKNESS) / 2,
    },
    armHorizontal: {
      width: ARM_LENGTH,
      height: ARM_THICKNESS,
      top: (CROSSHAIR - ARM_THICKNESS) / 2,
    },
    dot: {
      position: 'absolute',
      width: 24,
      height: 24,
      borderRadius: 12,
      backgroundColor: t.primary,
    },
    title: {
      color: t.text,
      fontSize: 28,
      fontWeight: '800',
      letterSpacing: -0.3,
      textAlign: 'center',
    },
    subtitle: {
      color: t.textSecondary,
      fontSize: 16,
      lineHeight: 23,
      textAlign: 'center',
      marginTop: 10,
      maxWidth: 320,
    },
    skipWrap: {
      position: 'absolute',
      bottom: 48,
      left: 0,
      right: 0,
      alignItems: 'center',
    },
    skip: {
      color: t.textDisabled,
      fontSize: 13,
      fontWeight: '500',
    },
  });
}
