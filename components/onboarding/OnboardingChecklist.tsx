// components/onboarding/OnboardingChecklist.tsx
// Displays an interactive checklist of onboarding steps at the top of the bounty dashboard.
// Automatically hides once all steps are completed.

import { MaterialIcons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useState } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import {
  ORDERED_STEPS,
  OnboardingState,
  OnboardingStep,
  onboardingManager,
} from './OnboardingManager';

const STEP_LABELS: Record<OnboardingStep, string> = {
  expand_bounty: 'Expand a bounty card',
  view_requests: 'Review hunter requests',
  accept_hunter: 'Accept a hunter',
  review_submission: 'Review submission',
  release_payment: 'Release payment',
};

interface OnboardingChecklistProps {
  /** Called when the checklist is dismissed by the user (before full completion). */
  onDismiss?: () => void;
}

export function OnboardingChecklist({ onDismiss }: OnboardingChecklistProps) {
  const [state, setState] = useState<OnboardingState>(onboardingManager.getState());
  const [collapsed, setCollapsed] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const fadeAnim = React.useRef(new Animated.Value(1)).current;

  // Load persisted state on mount and subscribe to future changes.
  useEffect(() => {
    let mounted = true;
    onboardingManager.load().then((s) => {
      if (mounted) setState(s);
    });
    const unsub = onboardingManager.subscribe((s) => {
      if (mounted) setState(s);
    });
    return () => {
      mounted = false;
      unsub();
    };
  }, []);

  // Fade out and hide once all steps are complete.
  useEffect(() => {
    if (onboardingManager.isComplete()) {
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 600,
        useNativeDriver: true,
      }).start(() => setDismissed(true));
    }
  }, [state, fadeAnim]);

  const handleDismiss = useCallback(() => {
    setDismissed(true);
    onDismiss?.();
  }, [onDismiss]);

  if (dismissed) return null;

  const completedCount = ORDERED_STEPS.filter((s) => state[s]).length;
  const totalCount = ORDERED_STEPS.length;

  return (
    <Animated.View style={[styles.container, { opacity: fadeAnim }]}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.headerTitle}>🎯 Complete your first bounty</Text>
          <Text style={styles.progressText}>
            {completedCount}/{totalCount}
          </Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity
            onPress={() => setCollapsed((c) => !c)}
            style={styles.iconButton}
            accessibilityRole="button"
            accessibilityLabel={collapsed ? 'Expand checklist' : 'Collapse checklist'}
          >
            <MaterialIcons
              name={collapsed ? 'expand-more' : 'expand-less'}
              size={20}
              color="#6ee7b7"
            />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleDismiss}
            style={styles.iconButton}
            accessibilityRole="button"
            accessibilityLabel="Dismiss onboarding checklist"
          >
            <MaterialIcons name="close" size={18} color="rgba(110, 231, 183, 0.6)" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Progress bar */}
      <View style={styles.progressBarTrack}>
        <View
          style={[
            styles.progressBarFill,
            { width: `${(completedCount / totalCount) * 100}%` },
          ]}
        />
      </View>

      {/* Step list */}
      {!collapsed && (
        <View style={styles.steps}>
          {ORDERED_STEPS.map((step) => {
            const done = state[step];
            return (
              <View key={step} style={styles.stepRow}>
                <MaterialIcons
                  name={done ? 'check-box' : 'check-box-outline-blank'}
                  size={18}
                  color={done ? '#10b981' : 'rgba(110, 231, 183, 0.5)'}
                />
                <Text style={[styles.stepText, done && styles.stepTextDone]}>
                  {STEP_LABELS[step]}
                </Text>
              </View>
            );
          })}
        </View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: 'rgba(5, 150, 105, 0.15)',
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  headerTitle: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
    flex: 1,
  },
  progressText: {
    color: '#6ee7b7',
    fontSize: 12,
    fontWeight: '600',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  iconButton: {
    padding: 4,
  },
  progressBarTrack: {
    height: 4,
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    borderRadius: 2,
    marginBottom: 10,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#10b981',
    borderRadius: 2,
  },
  steps: {
    gap: 8,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  stepText: {
    color: '#d1fae5',
    fontSize: 13,
    lineHeight: 18,
  },
  stepTextDone: {
    color: 'rgba(167, 243, 208, 0.5)',
    textDecorationLine: 'line-through',
  },
});
