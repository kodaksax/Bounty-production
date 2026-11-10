/**
 * Where the hunter is in a bounty: applied, working, in review, paid.
 * All four steps fit on screen so nothing hides behind a sideways scroll.
 */
import { MaterialIcons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useAppThemeContext } from '../lib/themes/AppThemeContext';
import type { AppTheme } from '../lib/themes/types';

export type HunterStage = 'apply' | 'work_in_progress' | 'review_verify' | 'payout';

const STAGES: { id: HunterStage; label: string; icon: keyof typeof MaterialIcons.glyphMap }[] = [
  { id: 'apply', label: 'Applied', icon: 'work' },
  { id: 'work_in_progress', label: 'In progress', icon: 'trending-up' },
  { id: 'review_verify', label: 'Review', icon: 'rate-review' },
  { id: 'payout', label: 'Payment', icon: 'account-balance-wallet' },
];

export function HunterStageTimeline({ currentStage }: { currentStage: HunterStage }) {
  const { theme } = useAppThemeContext();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const currentIndex = STAGES.findIndex(s => s.id === currentStage);

  return (
    <View
      style={styles.row}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`Step ${currentIndex + 1} of ${STAGES.length}: ${STAGES[currentIndex]?.label}`}
    >
      {STAGES.map((stage, index) => {
        const done = index < currentIndex;
        const active = index === currentIndex;
        return (
          <View key={stage.id} style={styles.step}>
            {index < STAGES.length - 1 && <View style={[styles.line, done && styles.lineDone]} />}
            <View style={[styles.dot, done && styles.dotDone, active && styles.dotActive]}>
              <MaterialIcons
                name={done ? 'check' : stage.icon}
                size={16}
                color={done || active ? theme.onPrimary : theme.textSecondary}
              />
            </View>
            <Text style={[styles.label, active && styles.labelActive]} numberOfLines={1}>
              {stage.label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

function makeStyles(theme: AppTheme) {
  const DOT = 32;
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      paddingVertical: theme.spacing.lg,
      marginBottom: theme.spacing.sm,
    },
    step: {
      flex: 1,
      alignItems: 'center',
      gap: 6,
    },
    line: {
      position: 'absolute',
      top: DOT / 2 - 1,
      // Runs from the edge of this step's dot to the edge of the next one.
      left: '50%',
      marginLeft: DOT / 2,
      right: '-50%',
      marginRight: DOT / 2,
      height: 2,
      backgroundColor: theme.border,
    },
    lineDone: {
      backgroundColor: theme.primary,
    },
    dot: {
      width: DOT,
      height: DOT,
      borderRadius: DOT / 2,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.surfaceSecondary,
    },
    dotDone: {
      backgroundColor: theme.primary,
    },
    dotActive: {
      backgroundColor: theme.primary,
    },
    label: {
      ...theme.textStyles.micro,
      color: theme.textSecondary,
    },
    labelActive: {
      color: theme.text,
      fontWeight: '600',
    },
  });
}
