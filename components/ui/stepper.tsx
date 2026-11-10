import { MaterialIcons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../lib/themes/types';
import { withAlpha } from '../../lib/utils';

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

export function Stepper({ stages, activeIndex }: StepperProps) {
  const { theme } = useAppThemeContext();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  return (
    <View style={styles.wrapper}>
      <View style={styles.row}>
        {stages.map((stage, idx) => {
          const isActive = idx === activeIndex;
          const isCompleted = idx < activeIndex;
          const isPending = idx > activeIndex;

          return (
            <View key={stage.id} style={styles.stageCol}>
              {/* Connector line (left side, skip for first) */}
              <View style={styles.connectorRow}>
                {idx > 0 ? (
                  <View
                    style={[
                      styles.connector,
                      isCompleted || isActive ? styles.connectorDone : styles.connectorPending,
                    ]}
                  />
                ) : (
                  <View style={styles.connectorSpacer} />
                )}

                {/* Bubble */}
                <View
                  style={[
                    styles.bubble,
                    isCompleted && styles.bubbleCompleted,
                    isActive && styles.bubbleActive,
                    isPending && styles.bubblePending,
                  ]}
                  accessibilityLabel={`${stage.label} — ${isCompleted ? 'completed' : isActive ? 'in progress' : 'pending'}`}
                  accessibilityRole="progressbar"
                >
                  {isCompleted ? (
                    <MaterialIcons name="check" size={14} color="#fff" />
                  ) : stage.icon ? (
                    <MaterialIcons
                      name={stage.icon as any}
                      size={14}
                      color={isActive ? '#fff' : theme.isDark ? withAlpha(theme.primary, 0.45) : withAlpha(theme.primary, 0.4)}
                    />
                  ) : null}
                </View>

                {/* Connector line (right side, skip for last) */}
                {idx < stages.length - 1 ? (
                  <View
                    style={[
                      styles.connector,
                      isCompleted ? styles.connectorDone : styles.connectorPending,
                    ]}
                  />
                ) : (
                  <View style={styles.connectorSpacer} />
                )}
              </View>

              {/* Label */}
              <Text
                style={[
                  styles.label,
                  isActive && styles.labelActive,
                  isCompleted && styles.labelCompleted,
                  isPending && styles.labelPending,
                ]}
                numberOfLines={2}
              >
                {stage.label}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function makeStyles(theme: AppTheme) {
  return StyleSheet.create({
    wrapper: {
      marginVertical: 10,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'flex-start',
    },
    stageCol: {
      flex: 1,
      alignItems: 'center',
    },
    connectorRow: {
      flexDirection: 'row',
      alignItems: 'center',
      width: '100%',
    },
    connector: {
      flex: 1,
      height: 2,
    },
    connectorSpacer: {
      flex: 1,
    },
    connectorDone: {
      backgroundColor: theme.primary,
    },
    connectorPending: {
      backgroundColor: withAlpha(theme.primary, 0.2),
    },
    bubble: {
      width: 32,
      height: 32,
      borderRadius: 16,
      justifyContent: 'center',
      alignItems: 'center',
      flexShrink: 0,
    },
    bubbleActive: {
      backgroundColor: theme.primary,
      shadowColor: '#008E2A',
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.5,
      shadowRadius: 6,
      elevation: 4,
    },
    bubbleCompleted: {
      backgroundColor: theme.primary,
      opacity: 0.85,
    },
    bubblePending: {
      backgroundColor: 'transparent',
      borderWidth: 1.5,
      borderColor: withAlpha(theme.primary, 0.25),
    },
    label: {
      marginTop: 6,
      fontSize: 11,
      textAlign: 'center',
      lineHeight: 13,
      paddingHorizontal: 2,
    },
    labelActive: {
      color: theme.primaryLight,
      fontWeight: '700',
      fontSize: 12,
    },
    labelCompleted: {
      color: withAlpha(theme.primary, 0.7),
      fontWeight: '500',
    },
    labelPending: {
      color: theme.textSecondary,
      fontWeight: '400',
    },
  });
}
