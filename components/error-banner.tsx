import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import { AccessibilityInfo, Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SIZING, SPACING, TYPOGRAPHY } from '../lib/constants/accessibility';
import { useHapticFeedback } from '../lib/haptic-feedback';
import { theme } from '../lib/theme';
import type { UserFriendlyError } from '../lib/utils/error-messages';


interface ErrorBannerProps {
  error: UserFriendlyError;
  onDismiss?: () => void;
  onAction?: () => void;
  /**
   * Auto-dismiss after specified milliseconds (0 = no auto-dismiss)
   */
  autoDismissMs?: number;
}

/**
 * Reusable error banner component with user-friendly messages
 * Shows at the top of screens with dismiss and action buttons
 * Includes entrance animation and haptic feedback
 */
export function ErrorBanner({
  error,
  onDismiss,
  onAction,
  autoDismissMs = 0,
}: ErrorBannerProps) {
  const { triggerHaptic } = useHapticFeedback();
  const slideAnim = React.useRef(new Animated.Value(-100)).current;
  const opacityAnim = React.useRef(new Animated.Value(0)).current;
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

  // Entrance animation and haptic feedback on mount
  React.useEffect(() => {
    // Trigger error haptic feedback
    triggerHaptic('error');

    const animDuration = prefersReducedMotion ? 0 : 300;

    Animated.parallel([
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: animDuration,
        useNativeDriver: true,
      }),
      Animated.timing(opacityAnim, {
        toValue: 1,
        duration: animDuration,
        useNativeDriver: true,
      }),
    ]).start();
  }, [triggerHaptic, slideAnim, opacityAnim, prefersReducedMotion]);

  // Auto-dismiss functionality
  React.useEffect(() => {
    if (autoDismissMs > 0 && onDismiss) {
      const timer = setTimeout(() => {
        onDismiss();
      }, autoDismissMs);
      return () => clearTimeout(timer);
    }
  }, [autoDismissMs, onDismiss]);

  const handleDismiss = React.useCallback(() => {
    const animDuration = prefersReducedMotion ? 0 : 200;

    Animated.parallel([
      Animated.timing(slideAnim, {
        toValue: -100,
        duration: animDuration,
        useNativeDriver: true,
      }),
      Animated.timing(opacityAnim, {
        toValue: 0,
        duration: animDuration,
        useNativeDriver: true,
      }),
    ]).start(() => {
      onDismiss?.();
    });
  }, [slideAnim, opacityAnim, onDismiss, prefersReducedMotion]);

  const handleAction = React.useCallback(() => {
    triggerHaptic('medium');
    onAction?.();
  }, [triggerHaptic, onAction]);

  const backgroundColor = error.type === 'validation' ? '#f59e0b' : '#dc2626';
  const iconName = getIconForErrorType(error.type);

  return (
    <Animated.View
      style={[
        styles.container,
        {
          backgroundColor,
          transform: [{ translateY: slideAnim }],
          opacity: opacityAnim,
        }
      ]}
      accessibilityRole="alert"
      accessibilityLiveRegion="assertive"
    >
      <View style={styles.content}>
        <MaterialIcons
          name={iconName}
          size={22}
          color="#fff"
          accessibilityElementsHidden={true}
        />
        <View style={styles.textContainer}>
          <Text
            style={styles.title}
            accessibilityRole="text"
          >
            {error.title}
          </Text>
          <Text
            style={styles.message}
            accessibilityRole="text"
          >
            {error.message}
          </Text>
        </View>
      </View>

      <View style={styles.actions}>
        {error.retryable && onAction && error.action && (
          <TouchableOpacity
            onPress={handleAction}
            style={styles.actionButton}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={error.action}
            accessibilityHint="Retry the failed operation"
          >
            <Text style={styles.actionText}>{error.action}</Text>
          </TouchableOpacity>
        )}

        {onDismiss && (
          <TouchableOpacity
            onPress={handleDismiss}
            style={styles.dismissButton}
            activeOpacity={0.7}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityRole="button"
            accessibilityLabel="Dismiss error"
          >
            <MaterialIcons name="close" size={20} color="#fff" />
          </TouchableOpacity>
        )}
      </View>
    </Animated.View>
  );
}

/**
 * Get appropriate icon for error type
 */
function getIconForErrorType(type: UserFriendlyError['type']): keyof typeof MaterialIcons.glyphMap {
  switch (type) {
    case 'network':
      return 'wifi-off';
    case 'authentication':
      return 'lock-outline';
    case 'authorization':
      return 'block';
    case 'payment':
      return 'payment';
    case 'rate_limit':
      return 'access-time';
    case 'not_found':
      return 'search-off';
    case 'validation':
      return 'warning';
    case 'server':
      return 'cloud-off';
    default:
      return 'error-outline';
  }
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: SPACING.SCREEN_HORIZONTAL,
    paddingVertical: SPACING.ELEMENT_GAP,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    borderRadius: 12,
    marginBottom: SPACING.ELEMENT_GAP,
    ...theme.shadows.lg,
  },

  content: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACING.ELEMENT_GAP,
  },
  textContainer: {
    flex: 1,
  },
  title: {
    color: '#fff',
    fontSize: TYPOGRAPHY.SIZE_BODY,
    fontWeight: '700',
    marginBottom: 2,
  },
  message: {
    color: '#fff',
    fontSize: TYPOGRAPHY.SIZE_SMALL,
    opacity: 0.95,
    lineHeight: TYPOGRAPHY.SIZE_SMALL * TYPOGRAPHY.LINE_HEIGHT_RELAXED,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.COMPACT_GAP,
    marginLeft: SPACING.COMPACT_GAP,
  },
  actionButton: {
    paddingHorizontal: SPACING.ELEMENT_GAP,
    paddingVertical: SPACING.COMPACT_GAP,
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    borderRadius: 8,
    minHeight: SIZING.MIN_TOUCH_TARGET,
    justifyContent: 'center',
  },
  actionText: {
    color: '#fff',
    fontSize: TYPOGRAPHY.SIZE_SMALL,
    fontWeight: '700',
  },
  dismissButton: {
    padding: SPACING.COMPACT_GAP,
    minWidth: SIZING.MIN_TOUCH_TARGET,
    minHeight: SIZING.MIN_TOUCH_TARGET,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
