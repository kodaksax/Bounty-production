import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors } from '../../lib/theme';
export interface StepperStage {
  id: string;
  label: string;
  icon?: string;
}

interface StepperProps {
  stages: StepperStage[];
  activeIndex: number;
  variant?: 'compact' | 'full';
}

/**
 * Reusable stepper component for displaying progress through stages.
 * @param stages - Array of stages to display
 * @param activeIndex - Index of the currently active stage (0-based)
 * @param variant - Display style: 'compact' (bubbles only) or 'full' (bubbles with labels)
 */
export function Stepper({ stages, activeIndex, variant = 'compact' }: StepperProps) {
  return (
    <View style={styles.timelineRow}>
      {stages.map((stage, idx) => {
        const isActive = idx === activeIndex;
        const isCompleted = idx < activeIndex;
        
        return (
          <View key={stage.id} style={styles.timelineItem}>
            <View
              style={[
                styles.bubble,
                isCompleted ? styles.bubbleCompleted : isActive ? styles.bubbleActive : styles.bubbleIdle,
              ]}
              accessibilityLabel={`${stage.label} - ${isCompleted ? 'completed' : isActive ? 'in progress' : 'pending'}`}
              accessibilityRole="progressbar"
            >
              {stage.icon && (
                <MaterialIcons
                  name={stage.icon as any}
                  size={variant === 'full' ? 16 : 8}
                  color={isCompleted || isActive ? '#fff' : 'rgba(110,231,183,0.5)'}
                />
              )}
            </View>
            {idx < stages.length - 1 && <View style={styles.connector} />}
            {variant === 'full' && (
              <Text style={[styles.label, (isActive || isCompleted) && styles.labelActive]}>
                {stage.label}
              </Text>
            )}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  timelineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 8,
  },
  timelineItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  bubble: {
    width: 16,
    height: 16,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  bubbleIdle: {
    backgroundColor: 'rgba(110,231,183,0.3)',
  },
  bubbleActive: {
    backgroundColor: colors.primary[500],
  },
  bubbleCompleted: {
    backgroundColor: colors.primary[600],
  },
  connector: {
    width: 18,
    height: 2,
    backgroundColor: 'rgba(110,231,183,0.35)',
    marginHorizontal: 6,
  },
  label: {
    color: '#a7f3d0',
    fontSize: 10,
    marginLeft: 4,
  },
  labelActive: {
    color: '#6ee7b7',
    fontWeight: '600',
  },
});
