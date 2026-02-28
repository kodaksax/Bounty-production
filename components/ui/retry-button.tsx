import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SIZING, SPACING, TYPOGRAPHY } from '../../lib/constants/accessibility';
import { useHapticFeedback } from '../../lib/haptic-feedback';
import { theme } from '../../lib/theme';


interface RetryButtonProps {
  onRetry: () => void | Promise<void>;
  /**
   * Button label
   * @default "Retry"
   */
  label?: string;
  /**
   * Show loading state
   */
  isLoading?: boolean;
  /**
   * Style variant
   * @default "default"
   */
  variant?: 'default' | 'compact' | 'inline';
  /**
   * Disable the button
   */
  disabled?: boolean;
  /**
   * Additional message shown below button
   */
  errorMessage?: string;
}

/**
 * Reusable retry button with loading state, haptic feedback,
 * and animated press effect for failed operations.
 */
export function RetryButton({
  onRetry,
  label = 'Retry',
  isLoading = false,
  variant = 'default',
  disabled = false,
  errorMessage,
}: RetryButtonProps) {
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

  const handlePress = async () => {
    if (disabled || isLoading) return;
    triggerHaptic('medium');
    try {
      await onRetry();
    } catch {
      triggerHaptic('error');
    }
  };

  const handlePressIn = () => {
    if (disabled || isLoading || prefersReducedMotion) return;
    Animated.spring(scaleAnim, {
      toValue: 0.95,
      useNativeDriver: true,
      tension: 300,
      friction: 10,
    }).start();
  };

  const handlePressOut = () => {
    if (disabled || isLoading || prefersReducedMotion) return;
    Animated.spring(scaleAnim, {
      toValue: 1,
      useNativeDriver: true,
      tension: 300,
      friction: 10,
    }).start();
  };

  const isCompact = variant === 'compact';
  const isInline = variant === 'inline';

  return (
    <View style={[styles.container, isInline && styles.inlineContainer]}>
      <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
        <TouchableOpacity
          onPress={handlePress}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
          disabled={disabled || isLoading}
          style={[
            styles.button,
            isCompact && styles.compactButton,
            isInline && styles.inlineButton,
            disabled && styles.disabledButton,
          ]}
          accessibilityRole="button"
          accessibilityLabel={isLoading ? 'Retrying...' : label}
          accessibilityState={{ disabled: disabled || isLoading }}
          accessibilityHint="Tap to retry the failed operation"
        >
          {isLoading ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <>
              <MaterialIcons
                name="refresh"
                size={isCompact ? 16 : 18}
                color="#fff"
                accessibilityElementsHidden={true}
              />
              <Text style={[styles.label, isCompact && styles.compactLabel]}>
                {label}
              </Text>
            </>
          )}
        </TouchableOpacity>
      </Animated.View>

      {errorMessage && (
        <Text
          style={styles.errorMessage}
          accessibilityRole="alert"
        >
          {errorMessage}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: SPACING.COMPACT_GAP,
  },
  inlineContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.ELEMENT_GAP,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#059669', // emerald-600
    paddingHorizontal: SPACING.SECTION_GAP,
    paddingVertical: SPACING.ELEMENT_GAP,
    borderRadius: 12,
    gap: SPACING.COMPACT_GAP,
    minHeight: SIZING.BUTTON_HEIGHT_DEFAULT,
    minWidth: 120,
    ...theme.shadows.sm,
  },

  compactButton: {
    paddingHorizontal: SPACING.SCREEN_HORIZONTAL,
    paddingVertical: SPACING.COMPACT_GAP,
    minHeight: SIZING.BUTTON_HEIGHT_COMPACT,
    minWidth: 80,
    borderRadius: 8,
  },
  inlineButton: {
    minWidth: 0,
    paddingHorizontal: SPACING.ELEMENT_GAP,
  },
  disabledButton: {
    opacity: 0.5,
  },
  label: {
    color: '#fff',
    fontSize: TYPOGRAPHY.SIZE_BODY,
    fontWeight: '600',
  },
  compactLabel: {
    fontSize: TYPOGRAPHY.SIZE_SMALL,
  },
  errorMessage: {
    color: '#fca5a5', // red-300
    fontSize: TYPOGRAPHY.SIZE_SMALL,
    textAlign: 'center',
    marginTop: SPACING.COMPACT_GAP,
  },
});

export default RetryButton;
