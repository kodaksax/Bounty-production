import { useRef, useEffect, useState, useCallback } from 'react';
import { Animated, AccessibilityInfo, Easing } from 'react-native';
import { A11Y } from '../lib/constants/accessibility';

/**
 * Hook that provides animation utilities that respect reduced motion preferences.
 * All animations will be instant (duration: 0) if the user has reduced motion enabled.
 */
export function useAccessibleAnimation() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

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

    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      (reduceMotionEnabled) => {
        setPrefersReducedMotion(reduceMotionEnabled);
      }
    );

    return () => {
      subscription?.remove();
    };
  }, []);

  /**
   * Get animation duration that respects reduced motion preference
   */
  const getAnimationDuration = useCallback((duration: number): number => {
    return prefersReducedMotion ? 0 : duration;
  }, [prefersReducedMotion]);

  /**
   * Create a timing animation with reduced motion support
   */
  const createTiming = useCallback((
    value: Animated.Value,
    toValue: number,
    duration: number = A11Y.ANIMATION_NORMAL,
    easing: (value: number) => number = Easing.inOut(Easing.ease)
  ) => {
    return Animated.timing(value, {
      toValue,
      duration: getAnimationDuration(duration),
      easing,
      useNativeDriver: true,
    });
  }, [getAnimationDuration]);

  /**
   * Create a spring animation with reduced motion support
   */
  const createSpring = useCallback((
    value: Animated.Value,
    toValue: number,
    config?: Partial<Animated.SpringAnimationConfig>
  ) => {
    if (prefersReducedMotion) {
      return Animated.timing(value, {
        toValue,
        duration: 0,
        useNativeDriver: true,
      });
    }
    return Animated.spring(value, {
      toValue,
      useNativeDriver: true,
      tension: 300,
      friction: 20,
      ...config,
    });
  }, [prefersReducedMotion]);

  return {
    prefersReducedMotion,
    getAnimationDuration,
    createTiming,
    createSpring,
  };
}

/**
 * Hook for press animations (scale on press in/out)
 */
export function usePressAnimation(enabled: boolean = true) {
  const scaleValue = useRef(new Animated.Value(1)).current;
  const { createSpring, prefersReducedMotion } = useAccessibleAnimation();

  const animatePressIn = useCallback(() => {
    if (!enabled || prefersReducedMotion) return;
    createSpring(scaleValue, 0.96).start();
  }, [enabled, createSpring, scaleValue, prefersReducedMotion]);

  const animatePressOut = useCallback(() => {
    if (!enabled || prefersReducedMotion) return;
    createSpring(scaleValue, 1).start();
  }, [enabled, createSpring, scaleValue, prefersReducedMotion]);

  return {
    scaleValue,
    animatePressIn,
    animatePressOut,
    style: { transform: [{ scale: scaleValue }] },
  };
}

/**
 * Hook for fade animations
 */
export function useFadeAnimation(initialValue: number = 0) {
  const fadeValue = useRef(new Animated.Value(initialValue)).current;
  const { createTiming } = useAccessibleAnimation();

  const fadeIn = useCallback((duration: number = A11Y.ANIMATION_NORMAL) => {
    return new Promise<void>((resolve) => {
      createTiming(fadeValue, 1, duration).start(() => resolve());
    });
  }, [fadeValue, createTiming]);

  const fadeOut = useCallback((duration: number = A11Y.ANIMATION_NORMAL) => {
    return new Promise<void>((resolve) => {
      createTiming(fadeValue, 0, duration).start(() => resolve());
    });
  }, [fadeValue, createTiming]);

  return {
    fadeValue,
    fadeIn,
    fadeOut,
    style: { opacity: fadeValue },
  };
}

/**
 * Hook for slide animations
 */
export function useSlideAnimation(
  direction: 'up' | 'down' | 'left' | 'right' = 'up',
  distance: number = 20
) {
  const slideValue = useRef(new Animated.Value(distance)).current;
  const { createTiming, prefersReducedMotion } = useAccessibleAnimation();

  const slideIn = useCallback((duration: number = A11Y.ANIMATION_NORMAL) => {
    if (prefersReducedMotion) {
      slideValue.setValue(0);
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      createTiming(slideValue, 0, duration).start(() => resolve());
    });
  }, [slideValue, createTiming, prefersReducedMotion]);

  const slideOut = useCallback((duration: number = A11Y.ANIMATION_NORMAL) => {
    if (prefersReducedMotion) {
      slideValue.setValue(distance);
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      createTiming(slideValue, distance, duration).start(() => resolve());
    });
  }, [slideValue, createTiming, distance, direction, prefersReducedMotion]);

  const getTransformStyle = useCallback(() => {
    switch (direction) {
      case 'up':
        return { transform: [{ translateY: slideValue }] };
      case 'down':
        return { transform: [{ translateY: Animated.multiply(slideValue, -1) }] };
      case 'left':
        return { transform: [{ translateX: slideValue }] };
      case 'right':
        return { transform: [{ translateX: Animated.multiply(slideValue, -1) }] };
      default:
        return { transform: [{ translateY: slideValue }] };
    }
  }, [direction, slideValue]);

  return {
    slideValue,
    slideIn,
    slideOut,
    style: getTransformStyle(),
  };
}

/**
 * Hook for combined fade + slide animations (common for list items)
 */
export function useFadeSlideAnimation(
  direction: 'up' | 'down' = 'up',
  distance: number = 10
) {
  const fadeValue = useRef(new Animated.Value(0)).current;
  const slideValue = useRef(new Animated.Value(distance)).current;
  const { createTiming, prefersReducedMotion } = useAccessibleAnimation();

  const animateIn = useCallback((duration: number = A11Y.ANIMATION_NORMAL) => {
    if (prefersReducedMotion) {
      fadeValue.setValue(1);
      slideValue.setValue(0);
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      Animated.parallel([
        createTiming(fadeValue, 1, duration),
        createTiming(slideValue, 0, duration),
      ]).start(() => resolve());
    });
  }, [fadeValue, slideValue, createTiming, prefersReducedMotion]);

  const animateOut = useCallback((duration: number = A11Y.ANIMATION_FAST) => {
    if (prefersReducedMotion) {
      fadeValue.setValue(0);
      slideValue.setValue(distance);
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      Animated.parallel([
        createTiming(fadeValue, 0, duration),
        createTiming(slideValue, direction === 'up' ? -distance : distance, duration),
      ]).start(() => resolve());
    });
  }, [fadeValue, slideValue, createTiming, distance, direction, prefersReducedMotion]);

  return {
    fadeValue,
    slideValue,
    animateIn,
    animateOut,
    style: {
      opacity: fadeValue,
      transform: [{ translateY: slideValue }],
    },
  };
}

// Re-export constants for convenience
export { A11Y };
