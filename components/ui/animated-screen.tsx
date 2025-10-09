import React, { useEffect, useRef } from 'react';
import { Animated, ViewStyle } from 'react-native';

interface AnimatedScreenProps {
  children: React.ReactNode;
  style?: ViewStyle;
  animationType?: 'fade' | 'slide' | 'scale';
  duration?: number;
}

/**
 * AnimatedScreen provides smooth enter/exit animations for screen transitions
 * Supports fade, slide, and scale animations with customizable duration
 */
export function AnimatedScreen({ 
  children, 
  style, 
  animationType = 'fade',
  duration = 300 
}: AnimatedScreenProps) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(50)).current;
  const scaleAnim = useRef(new Animated.Value(0.95)).current;

  useEffect(() => {
    const animations: Animated.CompositeAnimation[] = [];

    if (animationType === 'fade' || animationType === 'slide') {
      animations.push(
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration,
          useNativeDriver: true,
        })
      );
    }

    if (animationType === 'slide') {
      animations.push(
        Animated.timing(slideAnim, {
          toValue: 0,
          duration,
          useNativeDriver: true,
        })
      );
    }

    if (animationType === 'scale') {
      animations.push(
        Animated.parallel([
          Animated.timing(fadeAnim, {
            toValue: 1,
            duration,
            useNativeDriver: true,
          }),
          Animated.spring(scaleAnim, {
            toValue: 1,
            tension: 100,
            friction: 10,
            useNativeDriver: true,
          }),
        ])
      );
    }

    if (animations.length > 0) {
      Animated.parallel(animations).start();
    }
  }, [animationType, duration, fadeAnim, slideAnim, scaleAnim]);

  const getAnimatedStyle = (): ViewStyle => {
    const baseStyle: ViewStyle = { flex: 1 };

    switch (animationType) {
      case 'fade':
        return {
          ...baseStyle,
          opacity: fadeAnim,
        };
      case 'slide':
        return {
          ...baseStyle,
          opacity: fadeAnim,
          transform: [{ translateY: slideAnim }],
        };
      case 'scale':
        return {
          ...baseStyle,
          opacity: fadeAnim,
          transform: [{ scale: scaleAnim }],
        };
      default:
        return baseStyle;
    }
  };

  return (
    <Animated.View style={[getAnimatedStyle(), style]}>
      {children}
    </Animated.View>
  );
}
