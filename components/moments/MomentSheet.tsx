/**
 * Moments Queue — presentation.
 *
 * Renders whatever MomentsProvider decides is the single, currently-active
 * moment as a bottom sheet. Purely presentational: all decisions about
 * *which* moment and *when* live in lib/moments/engine.ts + the provider —
 * this component just shows content.spec and calls accept()/dismiss().
 */
import { MaterialIcons } from '@expo/vector-icons';
import { useEffect, useRef, useMemo } from 'react';
import { AccessibilityInfo, Animated, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMoments } from '../../providers/moments-provider';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../lib/themes/types';

export function MomentSheet() {
  const { activeMoment, activeContent, accept, dismiss } = useMoments();
  const { theme } = useAppThemeContext();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const translateY = useRef(new Animated.Value(300)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!activeMoment) return;
    let reduceMotion = false;
    AccessibilityInfo.isReduceMotionEnabled?.().then((v) => {
      reduceMotion = !!v;
      Animated.parallel([
        Animated.timing(translateY, { toValue: 0, duration: reduceMotion ? 0 : 260, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: reduceMotion ? 0 : 260, useNativeDriver: true }),
      ]).start();
    });
    return () => {
      translateY.setValue(300);
      opacity.setValue(0);
    };
  }, [activeMoment, translateY, opacity]);

  if (!activeMoment || !activeContent) return null;
  const content = activeContent;

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={dismiss}>
      <View style={styles.overlay}>
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          onPress={dismiss}
          accessibilityLabel="Dismiss"
          accessibilityRole="button"
        />
        <Animated.View
          style={[
            styles.sheet,
            { paddingBottom: insets.bottom + 20, opacity, transform: [{ translateY }] },
          ]}
          accessibilityViewIsModal
        >
          {content.icon && (
            <View style={styles.iconCircle}>
              <MaterialIcons name={content.icon as any} size={32} color={theme.primary} />
            </View>
          )}

          <Text style={styles.title} accessibilityRole="header">{content.title}</Text>
          <Text style={styles.body}>{content.body}</Text>

          {content.estimatedMinutes ? (
            <View style={styles.metaRow}>
              <MaterialIcons name="schedule" size={14} color={theme.textSecondary} />
              <Text style={styles.metaText}>About {content.estimatedMinutes} min</Text>
            </View>
          ) : null}

          {content.benefits && content.benefits.length > 0 && (
            <View style={styles.benefitsList}>
              {content.benefits.map((b, i) => (
                <View key={i} style={styles.benefitRow}>
                  <MaterialIcons name="check" size={16} color={theme.primary} />
                  <Text style={styles.benefitText}>{b}</Text>
                </View>
              ))}
            </View>
          )}

          <TouchableOpacity
            style={styles.primaryButton}
            onPress={accept}
            accessibilityRole="button"
            accessibilityLabel={content.primaryLabel}
          >
            <Text style={styles.primaryButtonText}>{content.primaryLabel}</Text>
          </TouchableOpacity>

          {content.secondaryLabel && (
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={dismiss}
              accessibilityRole="button"
              accessibilityLabel={content.secondaryLabel}
            >
              <Text style={styles.secondaryButtonText}>{content.secondaryLabel}</Text>
            </TouchableOpacity>
          )}
        </Animated.View>
      </View>
    </Modal>
  );
}

function makeStyles(theme: AppTheme) {
  return StyleSheet.create({
    overlay: {
      flex: 1,
      justifyContent: 'flex-end',
      backgroundColor: 'rgba(0,0,0,0.55)',
    },
    sheet: {
      backgroundColor: theme.surface,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      paddingHorizontal: 24,
      paddingTop: 24,
      borderWidth: 1,
      borderColor: theme.border,
      borderBottomWidth: 0,
    },
    iconCircle: {
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: theme.background,
      justifyContent: 'center',
      alignItems: 'center',
      marginBottom: 16,
      borderWidth: 1,
      borderColor: theme.border,
    },
    title: {
      fontSize: 20,
      fontWeight: '700',
      color: theme.text,
      marginBottom: 8,
    },
    body: {
      fontSize: 14,
      color: theme.textSecondary,
      lineHeight: 20,
      marginBottom: 12,
    },
    metaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginBottom: 12,
    },
    metaText: {
      fontSize: 12,
      color: theme.textSecondary,
    },
    benefitsList: {
      marginBottom: 20,
      gap: 8,
    },
    benefitRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    benefitText: {
      fontSize: 13,
      color: theme.text,
      flex: 1,
    },
    primaryButton: {
      backgroundColor: theme.primary,
      borderRadius: 999,
      paddingVertical: 16,
      alignItems: 'center',
      marginBottom: 8,
    },
    primaryButtonText: {
      color: '#052e1b',
      fontSize: 16,
      fontWeight: '700',
    },
    secondaryButton: {
      alignItems: 'center',
      paddingVertical: 12,
    },
    secondaryButtonText: {
      color: theme.textSecondary,
      fontSize: 14,
      fontWeight: '500',
    },
  });
}
