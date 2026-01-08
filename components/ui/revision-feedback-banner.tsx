// components/ui/revision-feedback-banner.tsx - Banner to display revision feedback from poster
import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

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
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <MaterialIcons name="feedback" size={20} color="#fbbf24" />
          <Text style={styles.headerTitle}>Revision Requested</Text>
        </View>
        {showDismiss && onDismiss && (
          <TouchableOpacity accessibilityRole="button" onPress={onDismiss} style={styles.dismissButton}>
            <MaterialIcons name="close" size={18} color="rgba(255,254,245,0.7)" />
          </TouchableOpacity>
        )}
      </View>
      
      <Text style={styles.feedbackLabel}>Poster Feedback:</Text>
      <View style={styles.feedbackBox}>
        <Text style={styles.feedbackText}>{feedback}</Text>
      </View>
      
      <View style={styles.actionHint}>
        <MaterialIcons name="info-outline" size={16} color="#6ee7b7" />
        <Text style={styles.actionHintText}>
          Address the feedback and resubmit your work when ready.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: 'rgba(251, 191, 36, 0.15)',
    borderRadius: 12,
    padding: 16,
    gap: 12,
    borderWidth: 2,
    borderColor: '#fbbf24',
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
    color: '#fbbf24',
    fontSize: 16,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  dismissButton: {
    padding: 4,
  },
  feedbackLabel: {
    color: '#6ee7b7',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  feedbackBox: {
    backgroundColor: 'rgba(5, 150, 105, 0.2)',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(110, 231, 183, 0.2)',
  },
  feedbackText: {
    color: '#fff',
    fontSize: 14,
    lineHeight: 20,
  },
  actionHint: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: 'rgba(5, 150, 105, 0.15)',
    padding: 10,
    borderRadius: 8,
  },
  actionHintText: {
    flex: 1,
    color: '#d1fae5',
    fontSize: 12,
    lineHeight: 18,
  },
});
