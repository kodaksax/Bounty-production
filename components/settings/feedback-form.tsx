import { MaterialIcons } from '@expo/vector-icons';
import { ThemedButton } from 'components/themed/ThemedButton';
import React, { useMemo, useRef, useState } from 'react';
import {
  Alert,
  Image,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../lib/themes/types';
import { KeyboardAwareScrollView } from '../ui/keyboard-avoiding';
import { withAlpha } from '../../lib/utils';

export interface FeedbackFormValues {
  subject: string;
  description: string;
  screenshotUri?: string | null;
}

export interface FeedbackFormProps {
  /** Label for the first (single-line) field, e.g. "Subject" or "Feature Title". */
  subjectLabel: string;
  subjectPlaceholder?: string;
  /** Label for the multi-line field. Defaults to "Description". */
  descriptionLabel?: string;
  descriptionPlaceholder?: string;
  /** Allow attaching an optional screenshot (bug reports only). */
  allowScreenshot?: boolean;
  submitLabel?: string;
  /** Pre-fills the first field, e.g. naming the job a support message is about. */
  initialSubject?: string;
  /** Pre-fills the details box, e.g. a ready-written request for help. */
  initialDescription?: string;
  /**
   * Submit handler. Should resolve to a result describing success/failure so the
   * form can surface confirmation or an inline error with a retry option.
   */
  onSubmit: (values: FeedbackFormValues) => Promise<{ success: boolean; error?: string }>;
  onCancel?: () => void;
  /** Called after a successful submission (e.g. to navigate back). */
  onSuccess?: () => void;
}

/**
 * Reusable feedback form used by both the "Report a Bug" and "Suggest a Feature"
 * flows. Handles validation, loading state, success confirmation, inline errors
 * with retry, and disables the submit button while a request is in flight.
 */
export const FeedbackForm: React.FC<FeedbackFormProps> = ({
  subjectLabel,
  subjectPlaceholder,
  descriptionLabel = 'Description',
  descriptionPlaceholder,
  allowScreenshot = false,
  submitLabel = 'Submit',
  initialSubject,
  initialDescription,
  onSubmit,
  onCancel,
  onSuccess,
}) => {
  const { theme } = useAppThemeContext();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const [subject, setSubject] = useState(initialSubject ?? '');
  const [description, setDescription] = useState(initialDescription ?? '');
  const [screenshotUri, setScreenshotUri] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // `submitting` is state, so a fast double tap could pass it twice. The
  // second call then hit feedbackService's duplicate check and showed
  // "Duplicate submission ignored" as an error while the first was still
  // sending (and re-enabled the button).
  const submittingRef = useRef(false);

  const canSubmit = subject.trim().length > 0 && description.trim().length > 0 && !submitting;

  const handlePickScreenshot = async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permission Required', 'Please allow access to your photo library.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 0.8,
      });
      if (!result.canceled && result.assets?.[0]) {
        setScreenshotUri(result.assets[0].uri);
      }
    } catch (e) {
      console.error('[FeedbackForm] Failed to pick screenshot:', e);
      Alert.alert("Couldn't attach screenshot", "Please try again.");
    }
  };

  const handleSubmit = async () => {
    if (!canSubmit || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const result = await onSubmit({
        subject: subject.trim(),
        description: description.trim(),
        screenshotUri: allowScreenshot ? screenshotUri : null,
      });

      if (result.success) {
        Alert.alert('Thank you!', 'Your submission has been received.', [
          { text: 'OK', onPress: onSuccess },
        ]);
        setSubject('');
        setDescription('');
        setScreenshotUri(null);
      } else {
        setError(result.error || 'Something went wrong. Please try again.');
      }
    } catch (e) {
      console.error('[FeedbackForm] Submission error:', e);
      setError('Something went wrong. Please try again.');
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAwareScrollView className="px-4" contentContainerStyle={{ paddingTop: 16, paddingBottom: 96 }}>
      <Text style={s.label}>{subjectLabel}</Text>
      <TextInput
        value={subject}
        onChangeText={setSubject}
        editable={!submitting}
        placeholder={subjectPlaceholder || subjectLabel}
        placeholderTextColor={theme.textDisabled}
        accessibilityLabel={subjectLabel}
        style={s.input}
      />

      <Text style={s.label}>{descriptionLabel}</Text>
      <TextInput
        value={description}
        onChangeText={setDescription}
        editable={!submitting}
        placeholder={descriptionPlaceholder || 'Tell us more...'}
        placeholderTextColor={theme.textDisabled}
        multiline
        numberOfLines={6}
        textAlignVertical="top"
        accessibilityLabel={descriptionLabel}
        style={[s.input, s.textArea]}
      />

      {allowScreenshot && (
        <View style={s.screenshotBlock}>
          <Text style={s.label}>Screenshot (optional)</Text>
          {screenshotUri ? (
            <View style={s.screenshotPreviewCard}>
              <Image
                source={{ uri: screenshotUri }}
                style={s.screenshotImage}
                resizeMode="cover"
              />
              <TouchableOpacity
                onPress={() => setScreenshotUri(null)}
                disabled={submitting}
                accessibilityRole="button"
                accessibilityLabel="Remove screenshot"
                style={s.removeButton}
              >
                <Text style={s.removeButtonText}>Remove</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <ThemedButton
              variant="secondary"
              label="Attach Screenshot"
              onPress={handlePickScreenshot}
              disabled={submitting}
              leftIcon={<MaterialIcons name="image" size={18} color={theme.text} />}
              style={s.attachButton}
              accessibilityLabel="Attach screenshot"
            />
          )}
        </View>
      )}

      {error && (
        // Announced when it appears: a failed send must not look like silence.
        <View
          style={s.errorCard}
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          testID="feedback-form-error"
        >
          <Text style={s.errorText}>{error}</Text>
          <TouchableOpacity
            onPress={handleSubmit}
            disabled={submitting}
            accessibilityRole="button"
            accessibilityLabel="Retry submission"
            accessibilityState={{ disabled: submitting, busy: submitting }}
            style={s.retryButton}
          >
            <Text style={s.retryButtonText}>Try again</Text>
          </TouchableOpacity>
        </View>
      )}

      <View className="flex-row gap-3">
        <ThemedButton
          variant="primary"
          label={submitLabel}
          loading={submitting}
          onPress={handleSubmit}
          disabled={!canSubmit}
          accessibilityRole="button"
          accessibilityLabel={submitting ? 'Sending' : submitLabel}
          accessibilityState={{ disabled: !canSubmit, busy: submitting }}
        />
        {onCancel && (
          <ThemedButton
            variant="secondary"
            label="Cancel"
            onPress={onCancel}
            disabled={submitting}
            accessibilityLabel="Cancel"
          />
        )}
      </View>
    </KeyboardAwareScrollView>
  );
};

function makeStyles(t: AppTheme) {
  return StyleSheet.create({
    // Readability floor for the support / bug / feature forms: 14px labels,
    // 16px input text, 44px+ inputs.
    label: {
      fontSize: 14,
      fontWeight: '600',
      color: t.textSecondary,
      marginBottom: 6,
    },
    input: {
      backgroundColor: t.surfaceSecondary,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: t.border,
      paddingHorizontal: 12,
      paddingVertical: 10,
      minHeight: 48,
      color: t.text,
      fontSize: 16,
      marginBottom: 16,
    },
    textArea: {
      minHeight: 120,
    },
    screenshotBlock: {
      marginBottom: 16,
    },
    screenshotPreviewCard: {
      backgroundColor: t.surfaceSecondary,
      borderRadius: 12,
      borderWidth: 1,
      ...t.insetBorder, // pressed-in edge: dark top → light bottom
      padding: 12,
    },
    screenshotImage: {
      width: '100%',
      height: 160,
      borderRadius: 8,
    },
    removeButton: {
      alignSelf: 'flex-start',
      marginTop: 10,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 8,
      backgroundColor: t.surface,
      borderWidth: 1,
      borderColor: t.border,
    },
    removeButtonText: {
      color: t.text,
      fontSize: 12,
      fontWeight: '600',
    },
    attachButton: {
      alignSelf: 'flex-start',
    },
    errorCard: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: t.isDark ? withAlpha(t.error, 0.16) : withAlpha(t.error, 0.1),
      borderWidth: 1,
      borderColor: t.error,
      borderRadius: 12,
      padding: 12,
      marginBottom: 16,
    },
    // Full-contrast text: t.error on its own tint measured 3.6:1 (light) and
    // 4.0:1 (dark), under the 4.5:1 body-text minimum. The red border and
    // tint still mark it as an error, and it is announced as an alert.
    errorText: {
      color: t.text,
      fontSize: 14,
      lineHeight: 20,
      flex: 1,
      marginRight: 12,
    },
    retryButton: {
      paddingHorizontal: 14,
      paddingVertical: 10,
      minHeight: 44,
      justifyContent: 'center',
      borderRadius: 8,
      backgroundColor: t.error,
    },
    retryButtonText: {
      color: '#ffffff',
      fontSize: 14,
      fontWeight: '600',
    },
  });
}
