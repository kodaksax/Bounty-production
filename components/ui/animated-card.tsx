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
    backgroundColor: theme.colors.background.elevated,
    borderColor: theme.colors.border.primary,
    ...theme.shadows.xl,
    // Add emerald glow
    shadowColor: theme.colors.primary[500],
    shadowOpacity: 0.2,
  },
});
