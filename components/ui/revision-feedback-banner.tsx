// components/ui/revision-feedback-banner.tsx - Banner to display revision feedback from poster
import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../lib/themes/types';
import { withAlpha } from '../../lib/utils';

interface RevisionFeedbackBannerProps {
  feedback: string;
  onDismiss?: () => void;
  showDismiss?: boolean;
}

/**
 * Banner component to display revision feedback prominently
 * Shows poster's feedback when work needs revisions
 */
export function RevisionFeedbackBanner({ 
  feedback, 
  onDismiss,
  showDismiss = false 
}: RevisionFeedbackBannerProps) {
  const { theme } = useAppThemeContext();
  const styles = React.useMemo(() => makeStyles(theme), [theme]);
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <MaterialIcons name="feedback" size={20} color={theme.warningText} />
          <Text style={styles.headerTitle}>Revision Requested</Text>
        </View>
        {showDismiss && onDismiss && (
          <TouchableOpacity accessibilityLabel="Close" accessibilityRole="button" onPress={onDismiss} style={styles.dismissButton}>
            <MaterialIcons name="close" size={18} color={withAlpha(theme.text, 0.7)} />
          </TouchableOpacity>
        )}
      </View>
      
      <Text style={styles.feedbackLabel}>Poster Feedback:</Text>
      <View style={styles.feedbackBox}>
        <Text style={styles.feedbackText}>{feedback}</Text>
      </View>
      
      <View style={styles.actionHint}>
        <MaterialIcons name="info-outline" size={16} color={theme.primaryLight} />
        <Text style={styles.actionHintText}>
          Address the feedback and resubmit your work when ready.
        </Text>
      </View>
    </View>
  );
}

function makeStyles(theme: AppTheme) {
  return StyleSheet.create({
  container: {
    backgroundColor: withAlpha(theme.warning, 0.15),
    borderRadius: 12,
    padding: 16,
    gap: 12,
    borderWidth: 2,
    borderColor: theme.warning,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  headerTitle: {
    color: theme.warningText,
    fontSize: 16,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  dismissButton: {
    padding: 4,
  },
  feedbackLabel: {
    color: theme.primaryLight,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  feedbackBox: {
    backgroundColor: withAlpha(theme.primary, 0.2),
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: withAlpha(theme.primary, 0.2),
  },
  feedbackText: {
    color: theme.text,
    fontSize: 14,
    lineHeight: 20,
  },
  actionHint: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: withAlpha(theme.primary, 0.15),
    padding: 10,
    borderRadius: 8,
  },
  actionHintText: {
    flex: 1,
    color: theme.textSecondary,
    fontSize: 12,
    lineHeight: 18,
  },
});
}
