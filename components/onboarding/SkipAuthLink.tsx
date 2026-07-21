/**
 * Skip-auth link for the onboarding sign-in screen (app/onboarding/username.tsx).
 * Isolated behind ONBOARDING_SKIP_AUTH_ENABLED in lib/feature-flags.ts — kept
 * as its own component rather than deleted so the bypass can be restored
 * later without re-deriving the styling/behavior from scratch.
 */

import { StyleSheet, Text, TouchableOpacity } from 'react-native';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../lib/themes/types';

type SkipAuthLinkProps = {
  onPress: () => void;
};

export function SkipAuthLink({ onPress }: SkipAuthLinkProps) {
  const { theme } = useAppThemeContext();
  const styles = makeStyles(theme);

  return (
    <TouchableOpacity
      style={styles.skipLink}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Skip for now"
    >
      <Text style={styles.skipLinkText}>Skip for now</Text>
    </TouchableOpacity>
  );
}

function makeStyles(theme: AppTheme) {
  return StyleSheet.create({
    skipLink: {
      alignItems: 'center',
      paddingVertical: 12,
    },
    skipLinkText: {
      fontSize: 15,
      color: theme.textDisabled,
      textDecorationLine: 'underline',
    },
  });
}
