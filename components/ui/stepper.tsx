import { MaterialIcons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../lib/themes/types';

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
                      color={isActive ? '#fff' : theme.isDark ? 'rgba(110,231,183,0.45)' : 'rgba(5,150,105,0.4)'}
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
      backgroundColor: '#059669',
    },
    connectorPending: {
      backgroundColor: theme.isDark ? 'rgba(110,231,183,0.2)' : 'rgba(5,150,105,0.2)',
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
      backgroundColor: '#059669',
      shadowColor: '#059669',
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.5,
      shadowRadius: 6,
      elevation: 4,
    },
    bubbleCompleted: {
      backgroundColor: '#059669',
      opacity: 0.85,
    },
    bubblePending: {
      backgroundColor: 'transparent',
      borderWidth: 1.5,
      borderColor: theme.isDark ? 'rgba(110,231,183,0.25)' : 'rgba(5,150,105,0.25)',
    },
    label: {
      marginTop: 6,
      fontSize: 10,
      textAlign: 'center',
      lineHeight: 13,
      paddingHorizontal: 2,
    },
    labelActive: {
      color: theme.isDark ? '#6ee7b7' : '#059669',
      fontWeight: '700',
      fontSize: 11,
    },
    labelCompleted: {
      color: theme.isDark ? 'rgba(110,231,183,0.7)' : 'rgba(5,150,105,0.7)',
      fontWeight: '500',
    },
    labelPending: {
      color: theme.textSecondary,
      fontWeight: '400',
    },
  });
}
