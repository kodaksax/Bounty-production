import React, { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAppThemeContext } from '../../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../../lib/themes/types';

interface ResumeDraftNoteProps {
  /** Asks to discard the draft and go back to step 1. */
  onStartOver: () => void;
}

/**
 * "Picking up where you left off · Start over" — one line above the step the
 * composer reopened a saved draft on. The composer remembers the step with the
 * draft, so the poster is already back where they were; this only says so,
 * and offers the way out.
 */
export function ResumeDraftNote({ onStartOver }: ResumeDraftNoteProps) {
  const { theme } = useAppThemeContext();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  return (
    <View style={styles.row} testID="resume-draft-note">
      <Text style={styles.text} numberOfLines={1}>
        Picking up where you left off
      </Text>
      <Text style={styles.separator} accessibilityElementsHidden importantForAccessibility="no">
        ·
      </Text>
      <TouchableOpacity
        onPress={onStartOver}
        hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
        accessibilityRole="button"
        accessibilityLabel="Start over"
        accessibilityHint="Clears this draft and goes back to the first step."
        testID="resume-draft-start-over"
      >
        <Text style={styles.link}>Start over</Text>
      </TouchableOpacity>
    </View>
  );
}

export default ResumeDraftNote;

function makeStyles(theme: AppTheme) {
  return StyleSheet.create({
    // Same side gutter as QuickStepLayout's progress row, which sits just below.
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 20,
      paddingTop: 6,
    },
    text: { flexShrink: 1, fontSize: 13, color: theme.textSecondary },
    separator: { marginHorizontal: 6, fontSize: 13, color: theme.textSecondary },
    link: { fontSize: 13, fontWeight: '600', color: theme.primary },
  });
}
