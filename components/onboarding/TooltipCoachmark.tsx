// components/onboarding/TooltipCoachmark.tsx
// Contextual tooltip (coachmark) that anchors near a target element and guides
// the user through the next onboarding step with Next / Skip controls.

import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { OnboardingStep } from './OnboardingManager';

export interface TooltipLayout {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface TooltipCoachmarkProps {
  /** Whether the tooltip is currently visible. */
  visible: boolean;
  /** The onboarding step this tooltip corresponds to. */
  step: OnboardingStep;
  /** Short title for the tooltip. */
  title: string;
  /** Longer description shown below the title. */
  description: string;
  /**
   * Layout of the target element in screen coordinates.
   * Used to position the tooltip bubble near the relevant UI.
   */
  targetLayout?: TooltipLayout;
  /** Called when the user taps "Next". */
  onNext: () => void;
  /** Called when the user taps "Skip". */
  onSkip: () => void;
}

/**
 * TooltipCoachmark renders a floating tooltip modal that highlights a specific
 * step in the onboarding flow. It animates in/out with a fade + scale effect.
 */
export function TooltipCoachmark({
  visible,
  title,
  description,
  targetLayout,
  onNext,
  onSkip,
}: TooltipCoachmarkProps) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: visible ? 1 : 0,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }, [visible, anim]);

  if (!visible) return null;

  // Position the tooltip below the target element when layout is provided,
  // otherwise center it near the top of the screen.
  const tooltipTop = targetLayout
    ? targetLayout.y + targetLayout.height + 10
    : 120;
  const tooltipLeft = targetLayout ? Math.max(16, targetLayout.x) : 16;

  return (
    <Modal
      transparent
      visible={visible}
      animationType="none"
      statusBarTranslucent
      accessibilityViewIsModal
      accessibilityRole="none"
    >
      {/* Dark overlay — tapping it skips the tooltip */}
      <TouchableWithoutFeedback onPress={onSkip} accessibilityLabel="Skip onboarding tooltip">
        <View style={styles.overlay} />
      </TouchableWithoutFeedback>

      {/* Tooltip bubble */}
      <Animated.View
        style={[
          styles.tooltip,
          {
            top: tooltipTop,
            left: tooltipLeft,
            opacity: anim,
            transform: [
              {
                scale: anim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.85, 1],
                }),
              },
            ],
          },
        ]}
        accessibilityRole="none"
        accessible
        accessibilityLabel={`Onboarding tip: ${title}. ${description}`}
      >
        {/* Arrow pointing upward toward target */}
        <View style={styles.arrow} />

        <Text style={styles.title}>{title}</Text>
        <Text style={styles.description}>{description}</Text>

        <View style={styles.actions}>
          <TouchableOpacity
            onPress={onSkip}
            style={styles.skipButton}
            accessibilityRole="button"
            accessibilityLabel="Skip onboarding"
          >
            <Text style={styles.skipText}>Skip</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={onNext}
            style={styles.nextButton}
            accessibilityRole="button"
            accessibilityLabel="Next onboarding step"
          >
            <Text style={styles.nextText}>Next</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  tooltip: {
    position: 'absolute',
    right: 16,
    maxWidth: 320,
    backgroundColor: '#064e3b',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.4)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 8,
  },
  arrow: {
    position: 'absolute',
    top: -8,
    left: 20,
    width: 0,
    height: 0,
    borderLeftWidth: 8,
    borderRightWidth: 8,
    borderBottomWidth: 8,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: '#064e3b',
  },
  title: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 6,
  },
  description: {
    color: '#a7f3d0',
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 14,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  skipButton: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(110, 231, 183, 0.4)',
  },
  skipText: {
    color: '#6ee7b7',
    fontSize: 13,
    fontWeight: '600',
  },
  nextButton: {
    paddingVertical: 6,
    paddingHorizontal: 18,
    borderRadius: 20,
    backgroundColor: '#10b981',
  },
  nextText: {
    color: '#052e1b',
    fontSize: 13,
    fontWeight: '700',
  },
});
