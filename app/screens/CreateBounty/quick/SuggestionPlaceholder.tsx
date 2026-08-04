import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, type TextStyle } from 'react-native';

interface SuggestionPlaceholderProps {
  /** Suggestions cycled through, in order. */
  suggestions: string[];
  /** Text styling, so the placeholder lines up with the real input text. */
  style?: TextStyle | TextStyle[];
}

const HOLD_MS = 2000;
const FADE_MS = 550;
const RISE_DISTANCE = 14;

/**
 * A decorative, non-interactive placeholder that cycles example answers: the
 * current line fades while rising, then the next one fades in.
 *
 * Purely visual — it never touches the field's value. It is hidden from
 * assistive tech (the input carries its own label and hint) and holds on the
 * first suggestion when the OS reduce-motion setting is on, since this is an
 * indefinite loop.
 */
export function SuggestionPlaceholder({ suggestions, style }: SuggestionPlaceholderProps) {
  const [index, setIndex] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);

  const opacity = useRef(new Animated.Value(1)).current;
  const translateY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (!cancelled) setReduceMotion(enabled);
      })
      .catch(() => {
        // Non-fatal: default to animating.
      });

    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, []);

  useEffect(() => {
    if (reduceMotion || suggestions.length < 2) return;

    const timer = setInterval(() => {
      // Out: fade while drifting up.
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 0,
          duration: FADE_MS,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          toValue: -RISE_DISTANCE,
          duration: FADE_MS,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        if (!finished) return;
        setIndex((current) => (current + 1) % suggestions.length);
        // In: the next line simply fades up in place.
        translateY.setValue(0);
        Animated.timing(opacity, {
          toValue: 1,
          duration: FADE_MS,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }).start();
      });
    }, HOLD_MS + FADE_MS * 2);

    return () => clearInterval(timer);
  }, [reduceMotion, suggestions.length, opacity, translateY]);

  return (
    <Animated.Text
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      numberOfLines={1}
      style={[styles.text, style, { opacity, transform: [{ translateY }] }]}
    >
      {suggestions[index]}
    </Animated.Text>
  );
}

export default SuggestionPlaceholder;

const styles = StyleSheet.create({
  text: {
    position: 'absolute',
    left: 0,
    right: 0,
  },
});
