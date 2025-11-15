import React, { useCallback, useRef, useState } from 'react';
import { Animated, LayoutAnimation, Platform, Pressable, StyleSheet, UIManager, View, ViewStyle } from 'react-native';
import { COLORS, RADIUS, SPACING, SHADOWS } from '../../lib/constants/accessibility';

// Enable LayoutAnimation for Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface AnimatedCardProps {
  children: React.ReactNode;
  style?: ViewStyle;
  expandable?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
  variant?: 'default' | 'elevated';
  pressable?: boolean;
  onPress?: () => void;
}

/**
 * AnimatedCard provides a themeable card with optional expansion animation
 * Uses emerald color palette and supports elevation variants
 */
export function AnimatedCard({
  children,
  style,
  expandable = false,
  expanded: controlledExpanded,
  onToggle,
  variant = 'default',
  pressable = false,
  onPress,
}: AnimatedCardProps) {
  const [internalExpanded, setInternalExpanded] = useState(false);
  const isExpanded = controlledExpanded !== undefined ? controlledExpanded : internalExpanded;
  
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const elevationAnim = useRef(new Animated.Value(variant === 'elevated' ? 8 : 2)).current;

  const handleToggle = useCallback(() => {
    if (expandable) {
      const newExpanded = !isExpanded;
      
      // Configure LayoutAnimation for smooth expansion
      LayoutAnimation.configureNext({
        duration: 300,
        create: {
          type: LayoutAnimation.Types.easeInEaseOut,
          property: LayoutAnimation.Properties.opacity,
        },
        update: {
          type: LayoutAnimation.Types.easeInEaseOut,
          property: LayoutAnimation.Properties.scaleXY,
        },
      });
      
      if (onToggle) {
        onToggle();
      } else {
        setInternalExpanded(newExpanded);
      }
    }
  }, [expandable, isExpanded, onToggle]);

  const handlePressIn = useCallback(() => {
    if (pressable || expandable) {
      Animated.parallel([
        Animated.spring(scaleAnim, {
          toValue: 0.97,
          useNativeDriver: true,
          tension: 300,
          friction: 20,
        }),
        Animated.spring(elevationAnim, {
          toValue: variant === 'elevated' ? 12 : 4,
          useNativeDriver: false,
        }),
      ]).start();
    }
  }, [pressable, expandable, scaleAnim, elevationAnim, variant]);

  const handlePressOut = useCallback(() => {
    if (pressable || expandable) {
      Animated.parallel([
        Animated.spring(scaleAnim, {
          toValue: 1,
          useNativeDriver: true,
          tension: 300,
          friction: 20,
        }),
        Animated.spring(elevationAnim, {
          toValue: variant === 'elevated' ? 8 : 2,
          useNativeDriver: false,
        }),
      ]).start();
    }
  }, [pressable, expandable, scaleAnim, elevationAnim, variant]);

  const handlePress = useCallback(() => {
    if (expandable) {
      handleToggle();
    } else if (onPress) {
      onPress();
    }
  }, [expandable, handleToggle, onPress]);

  const cardStyle = variant === 'elevated' ? styles.elevated : styles.default;

  if (pressable || expandable) {
    return (
      <Pressable
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        onPress={handlePress}
      >
        <Animated.View
          style={[
            styles.base,
            cardStyle,
            {
              transform: [{ scale: scaleAnim }],
              elevation: elevationAnim,
            },
            style,
          ]}
        >
          {children}
        </Animated.View>
      </Pressable>
    );
  }

  return (
    <View style={[styles.base, cardStyle, style]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: RADIUS.XL,
    padding: SPACING.CARD_PADDING,
    borderWidth: 1,
  },
  default: {
    backgroundColor: COLORS.BG_SECONDARY, // emerald-700
    borderColor: COLORS.BORDER_SUBTLE, // emerald-300 with opacity
    ...SHADOWS.MD,
  },
  elevated: {
    backgroundColor: COLORS.BG_SECONDARY, // emerald-700
    borderColor: COLORS.BORDER_DEFAULT, // emerald-700
    ...SHADOWS.XL,
    // Add emerald glow
    shadowColor: COLORS.INTERACTIVE_DEFAULT, // emerald-500
    shadowOpacity: 0.2,
  },
});
