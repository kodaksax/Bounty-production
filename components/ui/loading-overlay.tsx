import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, ActivityIndicator, Modal, Dimensions } from 'react-native';
import { BlurView } from 'expo-blur';
import { COLORS, SPACING, TYPOGRAPHY, A11Y } from '../../lib/constants/accessibility';
import { useReducedMotion } from '../../lib/accessibility-utils';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface LoadingOverlayProps {
  /** Whether the overlay is visible */
  visible: boolean;
  /** Loading message to display */
  message?: string;
  /** Optional progress value (0-100) */
  progress?: number;
  /** Use a transparent overlay instead of blur (better performance) */
  transparent?: boolean;
}

/**
 * Full-screen loading overlay with optional message and progress
 * Features:
 * - Animated fade in/out
 * - Blur background for context awareness
 * - Respects reduced motion preferences
 * - Screen reader support
 */
export function LoadingOverlay({
  visible,
  message = 'Loading...',
  progress,
  transparent = false,
}: LoadingOverlayProps) {
  const { prefersReducedMotion, getAnimationConfig } = useReducedMotion();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const spinAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.timing(fadeAnim, {
        toValue: 1,
        ...getAnimationConfig(A11Y.ANIMATION_NORMAL),
      }).start();

      // Only spin if not preferring reduced motion
      if (!prefersReducedMotion) {
        Animated.loop(
          Animated.timing(spinAnim, {
            toValue: 1,
            duration: 1500,
            useNativeDriver: true,
          })
        ).start();
      }
    } else {
      Animated.timing(fadeAnim, {
        toValue: 0,
        ...getAnimationConfig(A11Y.ANIMATION_FAST),
      }).start();
    }
  }, [visible, fadeAnim, spinAnim, getAnimationConfig, prefersReducedMotion]);

  if (!visible) return null;

  const spin = spinAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const content = (
    <Animated.View
      style={[styles.container, { opacity: fadeAnim }]}
      accessibilityRole="progressbar"
      accessibilityLabel={message}
      accessibilityLiveRegion="polite"
    >
      <View style={styles.card}>
        <Animated.View style={[!prefersReducedMotion && { transform: [{ rotate: spin }] }]}>
          <ActivityIndicator 
            size="large" 
            color={COLORS.EMERALD_400}
          />
        </Animated.View>
        
        <Text style={styles.message}>{message}</Text>
        
        {progress !== undefined && (
          <View style={styles.progressContainer}>
            <View style={styles.progressBackground}>
              <Animated.View 
                style={[styles.progressFill, { width: `${Math.min(100, progress)}%` }]}
              />
            </View>
            <Text style={styles.progressText}>{Math.round(progress)}%</Text>
          </View>
        )}
      </View>
    </Animated.View>
  );

  return (
    <Modal
      transparent
      visible={visible}
      animationType="none"
      statusBarTranslucent
    >
      {transparent ? (
        <View style={styles.transparentBackground}>{content}</View>
      ) : (
        <BlurView intensity={20} tint="dark" style={styles.blurBackground}>
          {content}
        </BlurView>
      )}
    </Modal>
  );
}

/**
 * Inline loading indicator with optional message
 * For use within screens/components rather than as an overlay
 */
interface InlineLoadingProps {
  message?: string;
  size?: 'small' | 'large';
}

export function InlineLoading({ message, size = 'small' }: InlineLoadingProps) {
  return (
    <View 
      style={styles.inlineContainer}
      accessibilityRole="progressbar"
      accessibilityLabel={message || 'Loading'}
      accessibilityLiveRegion="polite"
    >
      <ActivityIndicator size={size} color={COLORS.EMERALD_400} />
      {message && <Text style={styles.inlineMessage}>{message}</Text>}
    </View>
  );
}

/**
 * Skeleton loading placeholder for specific content areas
 * Shows a subtle pulsing animation to indicate loading
 */
interface ContentPlaceholderProps {
  width?: number | `${number}%` | 'auto';
  height?: number;
  borderRadius?: number;
}

export function ContentPlaceholder({
  width = '100%',
  height = 16,
  borderRadius = 4,
}: ContentPlaceholderProps) {
  const pulseAnim = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 0.8,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0.4,
          duration: 800,
          useNativeDriver: true,
        }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [pulseAnim]);

  return (
    <Animated.View
      style={[
        styles.placeholder,
        {
          width,
          height,
          borderRadius,
          opacity: pulseAnim,
        },
      ]}
      accessibilityElementsHidden={true}
    />
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  blurBackground: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  transparentBackground: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  card: {
    backgroundColor: COLORS.BG_DARK_SECONDARY,
    borderRadius: 16,
    padding: SPACING.SECTION_GAP,
    alignItems: 'center',
    minWidth: 150,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  message: {
    color: COLORS.TEXT_PRIMARY,
    fontSize: TYPOGRAPHY.SIZE_BODY,
    fontWeight: '500',
    marginTop: SPACING.ELEMENT_GAP,
    textAlign: 'center',
  },
  progressContainer: {
    width: '100%',
    marginTop: SPACING.ELEMENT_GAP,
    alignItems: 'center',
  },
  progressBackground: {
    width: '100%',
    height: 6,
    backgroundColor: COLORS.BORDER_DEFAULT,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: COLORS.EMERALD_400,
    borderRadius: 3,
  },
  progressText: {
    color: COLORS.TEXT_MUTED,
    fontSize: TYPOGRAPHY.SIZE_SMALL,
    marginTop: SPACING.COMPACT_GAP,
  },
  // Inline loading styles
  inlineContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.ELEMENT_GAP,
  },
  inlineMessage: {
    color: COLORS.TEXT_SECONDARY,
    fontSize: TYPOGRAPHY.SIZE_SMALL,
    marginLeft: SPACING.COMPACT_GAP,
  },
  // Placeholder styles
  placeholder: {
    backgroundColor: 'rgba(110, 231, 183, 0.2)',
  },
});
