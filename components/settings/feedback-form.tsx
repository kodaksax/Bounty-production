import { MaterialIcons } from '@expo/vector-icons';
import { ThemedButton } from 'components/themed/ThemedButton';
import React, { useMemo, useState } from 'react';
import {
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../lib/themes/types';

export interface FeedbackFormValues {
  subject: string;
  description: string;
  screenshotUri?: string | null;
}

export interface FeedbackFormProps {
  /** Label for the first (single-line) field, e.g. "Subject" or "Feature Title". */
  subjectLabel: string;
  subjectPlaceholder?: string;
  descriptionPlaceholder?: string;
  /** Allow attaching an optional screenshot (bug reports only). */
  allowScreenshot?: boolean;
  submitLabel?: string;
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
  descriptionPlaceholder,
  allowScreenshot = false,
  submitLabel = 'Submit',
  onSubmit,
  onCancel,
  onSuccess,
}) => {
  const { theme } = useAppThemeContext();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [screenshotUri, setScreenshotUri] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      Alert.alert('Error', 'Failed to attach screenshot.');
    }
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
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
      setSubmitting(false);
    }
  };

  return (
    <ScrollView className="px-4" contentContainerStyle={{ paddingTop: 16, paddingBottom: 96 }}>
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

      <Text style={s.label}>Description</Text>
      <TextInput
        value={description}
        onChangeText={setDescription}
        editable={!submitting}
        placeholder={descriptionPlaceholder || 'Tell us more...'}
        placeholderTextColor={theme.textDisabled}
        multiline
        numberOfLines={6}
        textAlignVertical="top"
        accessibilityLabel="Description"
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
        <View style={s.errorCard}>
          <Text style={s.errorText}>{error}</Text>
          <TouchableOpacity
            onPress={handleSubmit}
            accessibilityRole="button"
            accessibilityLabel="Retry submission"
            style={s.retryButton}
          >
            <Text style={s.retryButtonText}>Retry</Text>
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
          accessibilityLabel={submitLabel}
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
    </ScrollView>
  );
};

function makeStyles(t: AppTheme) {
  return StyleSheet.create({
    label: {
      fontSize: 12,
      color: t.textSecondary,
      marginBottom: 6,
    },
    input: {
      backgroundColor: t.surfaceSecondary,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: t.border,
      paddingHorizontal: 12,
      paddingVertical: 10,
      color: t.text,
      fontSize: 14,
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
      borderRadius: 10,
      borderWidth: 1,
      borderColor: t.border,
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
      backgroundColor: t.isDark ? 'rgba(239,68,68,0.16)' : 'rgba(239,68,68,0.1)',
      borderWidth: 1,
      borderColor: t.error,
      borderRadius: 10,
      padding: 12,
      marginBottom: 16,
    },
    errorText: {
      color: t.error,
      fontSize: 12,
      flex: 1,
      marginRight: 12,
    },
    retryButton: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 8,
      backgroundColor: t.error,
    },
    retryButtonText: {
      color: '#ffffff',
      fontSize: 12,
      fontWeight: '600',
    },
  });
}
