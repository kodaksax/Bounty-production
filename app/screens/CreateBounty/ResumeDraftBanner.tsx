import { MaterialIcons } from '@expo/vector-icons';
import React, { useEffect, useMemo } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFadeSlideAnimation } from '../../../hooks/use-accessible-animation';
import { useAppThemeContext } from '../../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../../lib/themes/types';

interface ResumeDraftBannerProps {
  /** The saved draft's title, quoted so the poster recognises their post. */
  draftTitle: string;
  /** Name of the step Continue jumps to ("Location", "Compensation"). */
  nextStepName: string;
  onContinue: () => void;
  onDismiss: () => void;
}

// What the poster sees for each step name — "Compensation" is the flow's
// internal step title; the screen itself talks about the reward.
const STEP_LABELS: Record<string, string> = {
  Location: 'Add the location next',
  Compensation: 'Set the reward next',
};

/**
 * "Continue your post" — shown at the foot of step 1 when a poster comes back
 * to the composer with a saved draft that already got past the Task step.
 * Leaving the Post tab resets the flow to step 1 (see NeedHelpScreen's
 * flowKey), so without this the poster lands on a pre-filled title with no
 * sign of how far they had got. Continue jumps to the first unfinished step;
 * the close button leaves them on step 1 with the draft intact.
 */
export function ResumeDraftBanner({ draftTitle, nextStepName, onContinue, onDismiss }: ResumeDraftBannerProps) {
  const { theme } = useAppThemeContext();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const { style: entrance, animateIn } = useFadeSlideAnimation('up', 16);

  useEffect(() => {
    void animateIn();
  }, [animateIn]);

  const title = draftTitle.trim();
  const hint = STEP_LABELS[nextStepName] ?? `${nextStepName} next`;

  return (
    <Animated.View style={[styles.card, entrance]} testID="resume-draft-banner">
      <View style={styles.icon}>
        <MaterialIcons name="edit-note" size={22} color={theme.primaryLight} />
      </View>
      <View style={styles.body}>
        <Text style={styles.heading} accessibilityRole="header">
          Continue your post
        </Text>
        <Text style={styles.detail} numberOfLines={1}>
          {`“${title}” · ${hint}`}
        </Text>
      </View>
      <TouchableOpacity
        onPress={onContinue}
        activeOpacity={0.85}
        style={styles.continueButton}
        accessibilityRole="button"
        accessibilityLabel="Continue your post"
        accessibilityHint={`Picks up “${title}” where you left off. ${hint}.`}
        testID="resume-draft-continue"
      >
        <Text style={styles.continueLabel}>Continue</Text>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={onDismiss}
        hitSlop={{ top: 12, bottom: 12, left: 8, right: 12 }}
        style={styles.close}
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
        accessibilityHint="Stays on the first step. Your draft is kept."
        testID="resume-draft-dismiss"
      >
        <MaterialIcons name="close" size={18} color={theme.textSecondary} />
      </TouchableOpacity>
    </Animated.View>
  );
}

export default ResumeDraftBanner;

function makeStyles(theme: AppTheme) {
  return StyleSheet.create({
    card: {
      marginHorizontal: 16,
      marginBottom: 12,
      paddingVertical: 12,
      paddingLeft: 12,
      paddingRight: 8,
      flexDirection: 'row',
      alignItems: 'center',
      borderRadius: 20,
      backgroundColor: theme.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border,
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: theme.isDark ? 0.35 : 0.08,
      shadowRadius: 16,
      elevation: 4,
    },
    // Same tint as StepTask's template-row icons.
    icon: {
      width: 40,
      height: 40,
      borderRadius: 12,
      backgroundColor: theme.isDark ? 'rgba(31,174,73,0.14)' : 'rgba(0,142,42,0.10)',
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 12,
    },
    body: { flex: 1, marginRight: 10 },
    heading: { fontSize: 15, fontWeight: '700', color: theme.text },
    detail: { marginTop: 2, fontSize: 13, color: theme.textSecondary },
    continueButton: {
      height: 36,
      paddingHorizontal: 16,
      borderRadius: 18,
      backgroundColor: theme.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    continueLabel: { fontSize: 14, fontWeight: '700', color: '#ffffff' },
    close: { marginLeft: 4, padding: 6 },
  });
}
