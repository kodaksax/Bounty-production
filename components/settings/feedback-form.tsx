import { MaterialIcons } from '@expo/vector-icons';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';

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
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [screenshotUri, setScreenshotUri] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = subject.trim().length > 0 && description.trim().length > 0 && !submitting;

  const inputClassName = 'bg-black/30 rounded-md px-3 py-2 text-white mb-4';

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
    <ScrollView className="px-4" contentContainerStyle={{ paddingBottom: 96 }}>
      <Text className="text-xs text-emerald-100 mb-1">{subjectLabel}</Text>
      <TextInput
        value={subject}
        onChangeText={setSubject}
        editable={!submitting}
        placeholder={subjectPlaceholder || subjectLabel}
        placeholderTextColor="#a7f3d0"
        accessibilityLabel={subjectLabel}
        className={inputClassName}
      />

      <Text className="text-xs text-emerald-100 mb-1">Description</Text>
      <TextInput
        value={description}
        onChangeText={setDescription}
        editable={!submitting}
        placeholder={descriptionPlaceholder || 'Tell us more...'}
        placeholderTextColor="#a7f3d0"
        multiline
        numberOfLines={6}
        textAlignVertical="top"
        accessibilityLabel="Description"
        className={inputClassName}
      />

      {allowScreenshot && (
        <View className="mb-4">
          <Text className="text-xs text-emerald-100 mb-1">Screenshot (optional)</Text>
          {screenshotUri ? (
            <View className="bg-black/30 rounded-md p-3">
              <Image
                source={{ uri: screenshotUri }}
                style={{ width: '100%', height: 160, borderRadius: 8 }}
                resizeMode="cover"
              />
              <TouchableOpacity
                onPress={() => setScreenshotUri(null)}
                disabled={submitting}
                accessibilityRole="button"
                accessibilityLabel="Remove screenshot"
                className="self-start mt-2 px-3 py-1 rounded-md bg-black/40"
              >
                <Text className="text-white text-xs font-medium">Remove</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              onPress={handlePickScreenshot}
              disabled={submitting}
              accessibilityRole="button"
              accessibilityLabel="Attach screenshot"
              className="flex-row items-center self-start px-3 py-2 rounded-md bg-emerald-700"
            >
              <MaterialIcons name="image" size={18} color="#fff" />
              <Text className="text-white text-sm font-medium ml-2">Attach Screenshot</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {error && (
        <View className="bg-red-900/50 border border-red-500 rounded-md p-3 mb-4 flex-row items-center justify-between">
          <Text className="text-red-100 text-xs flex-1 mr-2">{error}</Text>
          <TouchableOpacity
            onPress={handleSubmit}
            accessibilityRole="button"
            accessibilityLabel="Retry submission"
            className="px-3 py-1 rounded-md bg-red-700"
          >
            <Text className="text-white text-xs font-medium">Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      <View className="flex-row gap-3">
        <TouchableOpacity
          onPress={handleSubmit}
          disabled={!canSubmit}
          accessibilityRole="button"
          accessibilityLabel={submitLabel}
          accessibilityState={{ disabled: !canSubmit }}
          className={`flex-row items-center px-4 py-2 rounded-md ${
            canSubmit ? 'bg-emerald-700' : 'bg-emerald-900 opacity-60'
          }`}
        >
          {submitting && <ActivityIndicator size="small" color="#fff" style={{ marginRight: 8 }} />}
          <Text className="text-white text-sm font-medium">
            {submitting ? 'Submitting...' : submitLabel}
          </Text>
        </TouchableOpacity>
        {onCancel && (
          <TouchableOpacity
            onPress={onCancel}
            disabled={submitting}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
            className="px-4 py-2 rounded-md bg-black/30"
          >
            <Text className="text-white text-sm font-medium">Cancel</Text>
          </TouchableOpacity>
        )}
      </View>
    </ScrollView>
  );
};
