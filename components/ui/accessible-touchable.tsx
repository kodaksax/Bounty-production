import React from 'react';
import { 
  TouchableOpacity, 
  TouchableOpacityProps, 
  StyleSheet, 
  View,
  Animated,
  AccessibilityInfo,
} from 'react-native';
import { useHapticFeedback, HapticType } from '../../lib/haptic-feedback';
import { SIZING } from '../../lib/constants/accessibility';

interface AccessibleTouchableProps extends TouchableOpacityProps {
  /**
   * Minimum touch target size (defaults to 44x44 per WCAG 2.5.5)
   * @default true
   */
  enforceMinSize?: boolean;
  /**
   * Type of haptic feedback to trigger on press
   */
  haptic?: HapticType | false;
  /**
   * Enable press animation
   * @default true
   */
  animate?: boolean;
  /**
   * Scale factor for press animation
   * @default 0.95
   */
  scaleOnPress?: number;
  /**
   * Children elements
   */
  children: React.ReactNode;
}

/**
 * Accessible touchable component with built-in:
 * - Minimum touch target enforcement (44x44)
 * - Haptic feedback
 * - Press animation with reduced motion support
 * - Proper accessibility attributes
 */
export function AccessibleTouchable({
  enforceMinSize = true,
  haptic = 'light',
  animate = true,
  scaleOnPress = 0.95,
  children,
  onPress,
  onPressIn,
  onPressOut,
  disabled,
  style,
  accessibilityLabel,
  accessibilityHint,
  ...props
}: AccessibleTouchableProps) {
  const { triggerHaptic } = useHapticFeedback();
  const scaleAnim = React.useRef(new Animated.Value(1)).current;
  const [prefersReducedMotion, setPrefersReducedMotion] = React.useState(false);

  // Check for reduced motion preference
  React.useEffect(() => {
    const checkMotionPreference = async () => {
      try {
        const isReduceMotionEnabled = await AccessibilityInfo.isReduceMotionEnabled();
        setPrefersReducedMotion(isReduceMotionEnabled);
      } catch {
        setPrefersReducedMotion(false);
      }
    };
    checkMotionPreference();
  }, []);

  const handlePressIn = React.useCallback((e: any) => {
    if (disabled) return;
    
    if (animate && !prefersReducedMotion) {
      Animated.spring(scaleAnim, {
        toValue: scaleOnPress,
        useNativeDriver: true,
        tension: 300,
        friction: 10,
      }).start();
    }
    
    onPressIn?.(e);
  }, [disabled, animate, prefersReducedMotion, scaleAnim, scaleOnPress, onPressIn]);

  const handlePressOut = React.useCallback((e: any) => {
    if (disabled) return;
    
    if (animate && !prefersReducedMotion) {
      Animated.spring(scaleAnim, {
        toValue: 1,
        useNativeDriver: true,
        tension: 300,
        friction: 10,
      }).start();
    }
    
    onPressOut?.(e);
  }, [disabled, animate, prefersReducedMotion, scaleAnim, onPressOut]);

  const handlePress = React.useCallback((e: any) => {
    if (disabled) return;
    
    if (haptic) {
      triggerHaptic(haptic);
    }
    
    onPress?.(e);
  }, [disabled, haptic, triggerHaptic, onPress]);

  const AnimatedTouchable = Animated.createAnimatedComponent(TouchableOpacity);

  return (
    <AnimatedTouchable
      onPress={handlePress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={disabled}
      style={[
        enforceMinSize && styles.minTouchTarget,
        animate && { transform: [{ scale: scaleAnim }] },
        style,
      ]}
      accessible={true}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!disabled }}
      {...props}
    >
      {children}
    </AnimatedTouchable>
  );
}

/**
 * Icon button variant with proper sizing for icons
 */
interface AccessibleIconButtonProps extends Omit<AccessibleTouchableProps, 'children'> {
  children: React.ReactNode;
  /**
   * Size of the icon button
   * @default "md"
   */
  size?: 'sm' | 'md' | 'lg';
}

export function AccessibleIconButton({
  size = 'md',
  children,
  style,
  ...props
}: AccessibleIconButtonProps) {
  const sizeStyle = {
    sm: styles.iconButtonSm,
    md: styles.iconButtonMd,
    lg: styles.iconButtonLg,
  }[size];

  return (
    <AccessibleTouchable
      style={[styles.iconButton, sizeStyle, style]}
      {...props}
    >
      <View style={styles.iconContainer}>
        {children}
      </View>
    </AccessibleTouchable>
  );
}

const styles = StyleSheet.create({
  minTouchTarget: {
    minWidth: SIZING.MIN_TOUCH_TARGET,
    minHeight: SIZING.MIN_TOUCH_TARGET,
  },
  iconButton: {
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 12,
  },
  iconButtonSm: {
    width: SIZING.MIN_TOUCH_TARGET,
    height: SIZING.MIN_TOUCH_TARGET,
  },
  iconButtonMd: {
    width: SIZING.COMFORTABLE_TOUCH_TARGET,
    height: SIZING.COMFORTABLE_TOUCH_TARGET,
  },
  iconButtonLg: {
    width: SIZING.BUTTON_HEIGHT_LARGE,
    height: SIZING.BUTTON_HEIGHT_LARGE,
  },
  iconContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default AccessibleTouchable;
