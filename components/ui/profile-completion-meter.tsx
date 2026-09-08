import { useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../lib/themes/types';
import {
  PROFILE_COMPLETENESS_SUGGESTIONS,
  calculateProfileCompleteness,
  type ProfileCompletenessInput,
} from '../../lib/utils/profile-completeness';

interface ProfileCompletionMeterProps {
  input: ProfileCompletenessInput;
}

/**
 * Own-profile-only encouragement meter. Positive framing per the
 * profile-overhaul spec ("Add a little more about yourself to build trust",
 * not "Profile incomplete") — never renders an error/warning tone, and hides
 * itself entirely once complete rather than showing a "100%!" state that
 * would just be visual noise on every subsequent visit.
 */
export function ProfileCompletionMeter({ input }: ProfileCompletionMeterProps) {
  const { theme } = useAppThemeContext();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const router = useRouter();
  const { percent, missingItems, isComplete } = calculateProfileCompleteness(input);

  if (isComplete) return null;

  const nextSuggestion = missingItems[0] ? PROFILE_COMPLETENESS_SUGGESTIONS[missingItems[0]] : null;

  return (
    <TouchableOpacity
      style={styles.container}
      onPress={() => router.push('/profile/edit')}
      accessibilityRole="button"
      accessibilityLabel={`Your profile is ${percent}% complete. Tap to add more details.`}
    >
      <View style={styles.headerRow}>
        <Text style={styles.title}>Your profile is {percent}% complete</Text>
        <Text style={styles.percent}>{percent}%</Text>
      </View>
      <View
        style={styles.track}
        accessible
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: 100, now: percent }}
      >
        <View style={[styles.fill, { width: `${percent}%`, backgroundColor: theme.primary }]} />
      </View>
      {nextSuggestion && (
        <Text style={styles.suggestion}>
          {nextSuggestion} to build trust with the people you work with.
        </Text>
      )}
    </TouchableOpacity>
  );
}

function makeStyles(theme: AppTheme) {
  return StyleSheet.create({
    container: {
      borderRadius: 12,
      padding: 14,
      marginBottom: 16,
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderColor: theme.border,
    },
    headerRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 8,
    },
    title: {
      fontSize: 14,
      fontWeight: '600',
      color: theme.text,
    },
    percent: {
      fontSize: 13,
      fontWeight: '700',
      color: theme.primary,
    },
    track: {
      height: 8,
      borderRadius: 4,
      backgroundColor: theme.surfaceSecondary,
      overflow: 'hidden',
    },
    fill: {
      height: '100%',
      borderRadius: 4,
    },
    suggestion: {
      marginTop: 8,
      fontSize: 12,
      color: theme.textSecondary,
    },
  });
}
