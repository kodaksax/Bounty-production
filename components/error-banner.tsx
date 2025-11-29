import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated, ActivityIndicator } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import type { UserFriendlyError } from '../lib/utils/error-messages';
import { useHapticFeedback } from '../lib/haptic-feedback';
import { SIZING, SPACING, A11Y } from '../lib/constants/accessibility';

interface ErrorBannerProps {
  error: UserFriendlyError;
  onDismiss?: () => void;
  onAction?: () => void;
  /** Show loading indicator when retrying */
  isRetrying?: boolean;
  /** Auto-dismiss after specified duration in ms (0 = no auto-dismiss) */
  autoDismissMs?: number;
  /** Make the banner more compact */
  compact?: boolean;
}

/**
 * Reusable error banner component with user-friendly messages
 * Shows at the top of screens with dismiss and action buttons
 * Features:
 * - Haptic feedback on appearance
 * - Slide-in animation
 * - Auto-dismiss option
 * - Retry loading state
 * - Full accessibility support
 */
export function ErrorBanner({ 
  error, 
  onDismiss, 
  onAction, 
  isRetrying = false,
  autoDismissMs = 0,
  compact = false,
}: ErrorBannerProps) {
  const { triggerHaptic } = useHapticFeedback();
  const slideAnim = useRef(new Animated.Value(-100)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const [isVisible, setIsVisible] = useState(true);

  // Animate in on mount
  useEffect(() => {
    // Trigger haptic feedback for error appearance
    if (error.type === 'validation') {
      triggerHaptic('warning');
    } else {
      triggerHaptic('error');
    }

    // Slide in animation
    Animated.parallel([
      Animated.spring(slideAnim, {
        toValue: 0,
        tension: 80,
        friction: 12,
        useNativeDriver: true,
      }),
      Animated.timing(opacityAnim, {
        toValue: 1,
        duration: A11Y.ANIMATION_NORMAL,
        useNativeDriver: true,
      }),
    ]).start();
  }, [slideAnim, opacityAnim, triggerHaptic, error.type]);

  // Auto-dismiss handling
  useEffect(() => {
    if (autoDismissMs > 0 && onDismiss) {
      const timer = setTimeout(() => {
        handleDismiss();
      }, autoDismissMs);
      return () => clearTimeout(timer);
    }
  }, [autoDismissMs, onDismiss]);

  const handleDismiss = () => {
    // Animate out
    Animated.parallel([
      Animated.timing(slideAnim, {
        toValue: -100,
        duration: A11Y.ANIMATION_FAST,
        useNativeDriver: true,
      }),
      Animated.timing(opacityAnim, {
        toValue: 0,
        duration: A11Y.ANIMATION_FAST,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setIsVisible(false);
      onDismiss?.();
    });
  };

  const handleAction = () => {
    triggerHaptic('light');
    onAction?.();
  };

  if (!isVisible) return null;

  const backgroundColor = error.type === 'validation' ? '#f59e0b' : '#dc2626';
  const iconName = error.type === 'validation' ? 'warning' : 
                   error.type === 'network' ? 'wifi-off' :
                   error.type === 'authentication' ? 'lock' : 'error-outline';
  
  return (
    <Animated.View 
      style={[
        styles.container, 
        { backgroundColor },
        compact && styles.containerCompact,
        {
          transform: [{ translateY: slideAnim }],
          opacity: opacityAnim,
        },
      ]}
      accessible={true}
      accessibilityRole="alert"
      accessibilityLiveRegion="assertive"
      accessibilityLabel={`${error.title}. ${error.message}`}
    >
      <View style={[styles.content, compact && styles.contentCompact]}>
        <MaterialIcons 
          name={iconName} 
          size={compact ? 18 : 20} 
          color="#fff"
          accessibilityElementsHidden={true}
        />
        <View style={styles.textContainer}>
          <Text 
            style={[styles.title, compact && styles.titleCompact]}
            accessibilityRole="header"
          >
            {error.title}
          </Text>
          <Text style={[styles.message, compact && styles.messageCompact]}>
            {error.message}
          </Text>
        </View>
      </View>
      
      <View style={styles.actions}>
        {error.retryable && onAction && error.action && (
          <TouchableOpacity 
            onPress={handleAction}
            style={[styles.actionButton, isRetrying && styles.actionButtonDisabled]}
            activeOpacity={0.7}
            disabled={isRetrying}
            accessibilityRole="button"
            accessibilityLabel={error.action}
            accessibilityState={{ disabled: isRetrying }}
            accessibilityHint="Attempt to retry the failed operation"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            {isRetrying ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.actionText}>{error.action}</Text>
            )}
          </TouchableOpacity>
        )}
        
        {onDismiss && (
          <TouchableOpacity 
            onPress={handleDismiss}
            style={styles.dismissButton}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Dismiss error"
            accessibilityHint="Close this error message"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <MaterialIcons name="close" size={20} color="#fff" accessibilityElementsHidden={true} />
          </TouchableOpacity>
        )}
      </View>
    </Animated.View>
  );
}

/**
 * Inline error message for form fields
 * Smaller, less intrusive than the full banner
 */
interface InlineErrorProps {
  message: string;
  visible?: boolean;
}

export function InlineError({ message, visible = true }: InlineErrorProps) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const [shouldRender, setShouldRender] = useState(visible);

  useEffect(() => {
    if (visible) {
      setShouldRender(true);
    }
    Animated.timing(fadeAnim, {
      toValue: visible ? 1 : 0,
      duration: A11Y.ANIMATION_FAST,
      useNativeDriver: true,
    }).start(() => {
      if (!visible) {
        setShouldRender(false);
      }
    });
  }, [visible, fadeAnim]);

  if (!shouldRender) return null;

  return (
    <Animated.View 
      style={[styles.inlineContainer, { opacity: fadeAnim }]}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
    >
      <MaterialIcons 
        name="error" 
        size={14} 
        color="#ef4444"
        accessibilityElementsHidden={true}
      />
      <Text style={styles.inlineMessage}>{message}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    borderRadius: 8,
    marginBottom: 12,
  },
  containerCompact: {
    paddingVertical: 8,
    marginBottom: 8,
  },
  content: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  contentCompact: {
    gap: 8,
  },
  textContainer: {
    flex: 1,
  },
  title: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 2,
  },
  titleCompact: {
    fontSize: 13,
  },
  message: {
    color: '#fff',
    fontSize: 13,
    opacity: 0.95,
    lineHeight: 18,
  },
  messageCompact: {
    fontSize: 12,
    lineHeight: 16,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginLeft: 8,
  },
  actionButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 4,
    minWidth: SIZING.MIN_TOUCH_TARGET,
    minHeight: SIZING.MIN_TOUCH_TARGET - 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionButtonDisabled: {
    opacity: 0.7,
  },
  actionText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  dismissButton: {
    padding: 4,
    minWidth: SIZING.MIN_TOUCH_TARGET,
    minHeight: SIZING.MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Inline error styles
  inlineContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: SPACING.COMPACT_GAP,
    paddingHorizontal: 2,
  },
  inlineMessage: {
    color: '#ef4444',
    fontSize: 12,
    flex: 1,
  },
});
