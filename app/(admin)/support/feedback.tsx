// app/(admin)/support/feedback.tsx - Operator feedback
//
// The submit handler was `await new Promise(r => setTimeout(r, 1000))` followed
// by "Thank you for your feedback! Our team will review it shortly." Nothing
// was ever sent anywhere; every report an operator filed was discarded.
//
// It now goes through the app's existing feedbackService, which writes to
// `feedback_reports` (bug reports) or `feature_requests` (feature ideas) --
// the same tables the in-app feedback flow already uses, so admin reports land
// in the same queue instead of a second, invented one.
// Original header: - Admin Feedback Form
import { MaterialIcons } from '@expo/vector-icons';
import { feedbackService } from '../../../lib/services/feedback-service';
import { useAppTheme } from '../../../hooks/use-app-theme';
import type { AppTheme } from '../../../lib/themes/types';
import { useRouter } from 'expo-router';
import React, { useState, useMemo } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { AdminHeader } from '../../../components/admin/AdminHeader';

type FeedbackType = 'bug' | 'feature' | 'improvement' | 'other';
type Priority = 'low' | 'medium' | 'high' | 'critical';

interface FeedbackOption {
  id: FeedbackType | Priority;
  label: string;
  icon: keyof typeof MaterialIcons.glyphMap;
  color?: string;
}

// Built from the theme rather than hardcoded hex, so the option chips follow
// light/dark like the rest of the console.
const buildFeedbackTypes = (theme: AppTheme): FeedbackOption[] => [
  { id: 'bug', label: 'Bug Report', icon: 'bug-report', color: theme.error },
  { id: 'feature', label: 'Feature Request', icon: 'lightbulb', color: theme.info },
  { id: 'improvement', label: 'Improvement', icon: 'trending-up', color: theme.success },
  { id: 'other', label: 'Other', icon: 'help', color: theme.textDisabled },
];

const buildPriorities = (theme: AppTheme): FeedbackOption[] => [
  { id: 'low', label: 'Low', icon: 'arrow-downward', color: theme.textDisabled },
  { id: 'medium', label: 'Medium', icon: 'remove', color: theme.warning },
  { id: 'high', label: 'High', icon: 'arrow-upward', color: theme.warning },
  { id: 'critical', label: 'Critical', icon: 'priority-high', color: theme.error },
];

export default function AdminFeedbackScreen() {
  const { theme } = useAppTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const feedbackTypes = useMemo(() => buildFeedbackTypes(theme), [theme]);
  const priorities = useMemo(() => buildPriorities(theme), [theme]);
  const router = useRouter();
  const [type, setType] = useState<FeedbackType>('bug');
  const [priority, setPriority] = useState<Priority>('medium');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [stepsToReproduce, setStepsToReproduce] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!title.trim()) {
      Alert.alert('Title required', 'Please enter a short title for your feedback.');
      return;
    }
    if (!description.trim()) {
      Alert.alert('Description required', 'Please describe what happened or what you need.');
      return;
    }

    setIsSubmitting(true);
    try {
      // Priority and the steps-to-reproduce field are not columns on
      // feedback_reports, so they are folded into the description rather than
      // silently dropped.
      const body = [
        description.trim(),
        stepsToReproduce.trim() ? `\n\nSteps to reproduce:\n${stepsToReproduce.trim()}` : '',
        `\n\n— Submitted from the admin console (type: ${type}, priority: ${priority})`,
      ].join('');

      const result =
        type === 'feature'
          ? await feedbackService.submitFeatureRequest({
              title: title.trim(),
              description: body,
            })
          : await feedbackService.submitBugReport({
              subject: `[${type}] ${title.trim()}`,
              description: body,
            });

      if (!result.success) {
        Alert.alert(
          'Not submitted',
          result.error ?? 'Your feedback could not be sent. Please try again.'
        );
        return;
      }

      Alert.alert(
        'Feedback submitted',
        type === 'feature'
          ? 'Your feature request has been recorded.'
          : 'Your report has been recorded and will appear in the feedback queue.',
        [{ text: 'OK', onPress: () => router.back() }]
      );
    } catch (err) {
      Alert.alert(
        'Not submitted',
        err instanceof Error ? err.message : 'Your feedback could not be sent.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <View style={styles.container}>
      <AdminHeader title="Send Feedback" onBack={() => router.back()} />
      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <ScrollView 
          style={styles.scrollView} 
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          {/* Feedback Type */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Type of Feedback</Text>
            <View style={styles.typeGrid}>
              {feedbackTypes.map((item) => (
                <TouchableOpacity
                  key={item.id}
                  style={[
                    styles.typeCard,
                    type === item.id && styles.typeCardActive,
                    type === item.id && { borderColor: item.color },
                  ]}
                  onPress={() => setType(item.id as FeedbackType)}
                >
                  <MaterialIcons 
                    name={item.icon} 
                    size={24} 
                    color={type === item.id ? item.color : theme.textSecondary} 
                  />
                  <Text 
                    style={[
                      styles.typeLabel,
                      type === item.id && { color: item.color },
                    ]}
                  >
                    {item.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Priority */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Priority</Text>
            <View style={styles.priorityRow}>
              {priorities.map((item) => (
                <TouchableOpacity
                  key={item.id}
                  style={[
                    styles.priorityChip,
                    priority === item.id && styles.priorityChipActive,
                    priority === item.id && { backgroundColor: item.color + '30', borderColor: item.color },
                  ]}
                  onPress={() => setPriority(item.id as Priority)}
                >
                  <MaterialIcons 
                    name={item.icon} 
                    size={16} 
                    color={priority === item.id ? item.color : theme.textDisabled} 
                  />
                  <Text 
                    style={[
                      styles.priorityLabel,
                      priority === item.id && { color: item.color },
                    ]}
                  >
                    {item.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Title */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Title *</Text>
            <TextInput
              style={styles.textInput}
              placeholder="Brief summary of your feedback"
              placeholderTextColor={theme.textDisabled}
              value={title}
              onChangeText={setTitle}
              maxLength={100}
            />
            <Text style={styles.charCount}>{title.length}/100</Text>
          </View>

          {/* Description */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Description *</Text>
            <TextInput
              style={[styles.textInput, styles.textArea]}
              placeholder="Provide detailed information about your feedback..."
              placeholderTextColor={theme.textDisabled}
              value={description}
              onChangeText={setDescription}
              multiline
              numberOfLines={5}
              textAlignVertical="top"
            />
          </View>

          {/* Steps to Reproduce (for bugs) */}
          {type === 'bug' && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Steps to Reproduce</Text>
              <TextInput
                style={[styles.textInput, styles.textArea]}
                placeholder="1. Go to...&#10;2. Click on...&#10;3. Observe that..."
                placeholderTextColor={theme.textDisabled}
                value={stepsToReproduce}
                onChangeText={setStepsToReproduce}
                multiline
                numberOfLines={4}
                textAlignVertical="top"
              />
            </View>
          )}

          {/* Info Box */}
          <View style={styles.infoBox}>
            <MaterialIcons name="info-outline" size={20} color={theme.primary} />
            <Text style={styles.infoText}>
              Your feedback will be reviewed by the development team. You may be contacted 
              for additional information if needed.
            </Text>
          </View>

          {/* Submit Button */}
          <TouchableOpacity 
            style={[styles.submitButton, isSubmitting && styles.submitButtonDisabled]}
            onPress={handleSubmit}
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <Text style={styles.submitButtonText}>Submitting...</Text>
            ) : (
              <>
                <MaterialIcons name="send" size={20} color={theme.text} />
                <Text style={styles.submitButtonText}>Submit Feedback</Text>
              </>
            )}
          </TouchableOpacity>

          {/* Bottom padding */}
          <View style={{ height: 40 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const makeStyles = (theme: AppTheme) =>
  StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.background,
  },
  keyboardView: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 16,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  typeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  typeCard: {
    width: '48%',
    backgroundColor: theme.surface,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    gap: 8,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  typeCardActive: {
    backgroundColor: 'rgba(45,82,64,0.8)',
  },
  typeLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: theme.textSecondary,
  },
  priorityRow: {
    flexDirection: 'row',
    gap: 8,
  },
  priorityChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.surface,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 6,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  priorityChipActive: {
    borderWidth: 1,
  },
  priorityLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.textSecondary,
  },
  textInput: {
    backgroundColor: theme.surface,
    borderRadius: 12,
    padding: 16,
    fontSize: 15,
    color: theme.text,
    borderWidth: 1,
    borderColor: theme.border,
  },
  textArea: {
    minHeight: 120,
    paddingTop: 16,
  },
  charCount: {
    fontSize: 12,
    color: theme.textDisabled,
    textAlign: 'right',
    marginTop: 4,
  },
  infoBox: {
    flexDirection: 'row',
    backgroundColor: 'rgba(0,220,80,0.1)',
    borderRadius: 12,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: 'rgba(0,220,80,0.2)',
    marginBottom: 24,
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    color: theme.textSecondary,
    lineHeight: 18,
  },
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.primary,
    paddingVertical: 16,
    borderRadius: 12,
    gap: 8,
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: theme.text,
  },
});
