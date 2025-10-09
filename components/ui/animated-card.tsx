import React, { useCallback, useRef, useState } from 'react';
import { Animated, LayoutAnimation, Platform, Pressable, StyleSheet, UIManager, View, ViewStyle } from 'react-native';
import { theme } from '../../lib/theme';

// Enable LayoutAnimation for Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface AnimatedCardProps {
  children: React.ReactNode;
  style?: ViewStyle;
  expandable?: boolean;
  expanded?: boolean;
  onToggle?: (expanded: boolean) => void;
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
        },
      });

      if (controlledExpanded === undefined) {
        setInternalExpanded(newExpanded);
      }
      onToggle?.(newExpanded);

      // Animate elevation on expansion
      Animated.timing(elevationAnim, {
        toValue: newExpanded ? 12 : (variant === 'elevated' ? 8 : 2),
        duration: 300,
        useNativeDriver: false,
      }).start();
    }
  }, [expandable, isExpanded, controlledExpanded, onToggle, elevationAnim, variant]);

  const handlePressIn = useCallback(() => {
    if (pressable || expandable) {
      Animated.spring(scaleAnim, {
        toValue: 0.98,
        useNativeDriver: true,
        tension: 300,
        friction: 10,
      }).start();
    }
  }, [pressable, expandable, scaleAnim]);

  const handlePressOut = useCallback(() => {
    if (pressable || expandable) {
      Animated.spring(scaleAnim, {
        toValue: 1,
        useNativeDriver: true,
        tension: 300,
        friction: 10,
      }).start();
    }
  }, [pressable, expandable, scaleAnim]);

  const handlePress = useCallback(() => {
    if (expandable) {
      handleToggle();
    }
    onPress?.();
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
    borderRadius: theme.borderRadius.xl,
    padding: theme.spacing.lg,
    borderWidth: 1,
  },
  default: {
    backgroundColor: theme.colors.background.surface,
    borderColor: theme.colors.border.muted,
    ...theme.shadows.md,
  },
  elevated: {
    backgroundColor: theme.colors.background.surface,
    borderColor: theme.colors.border.default,
    ...theme.shadows.xl,
    shadowColor: theme.colors.primary[600], // emerald glow
    shadowOpacity: 0.15,
  },
});
