import { MaterialIcons } from '@expo/vector-icons';
import { ValidationMessage } from 'app/components/ValidationMessage';
import type { BountyDraft } from 'app/hooks/useBountyDraft';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppThemeContext } from '../../../lib/themes/AppThemeContext';
import { AttachmentViewerModal } from '../../../components/attachment-viewer-modal';
import { useAttachmentUpload } from '../../../hooks/use-attachment-upload';
import { validateDescription } from '../../../lib/utils/bounty-validation';
import type { Attachment } from '../../../lib/types';

interface StepDetailsProps {
  draft: BountyDraft;
  onUpdate: (data: Partial<BountyDraft>) => void;
  onNext: () => void;
  onBack: () => void;
}

export function StepDetails({ draft, onUpdate, onNext, onBack }: StepDetailsProps) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [viewerVisible, setViewerVisible] = useState(false);
  const [selectedAttachment, setSelectedAttachment] = useState<Attachment | null>(null);
  const insets = useSafeAreaInsets();
  const BOTTOM_NAV_OFFSET = 60;
  const { theme } = useAppThemeContext();

  const {
    isUploading,
    isPicking,
    progress,
    pickAttachment,
    error: uploadError,
    clearError,
  } = useAttachmentUpload({
    bucket: 'bounty-attachments',
    folder: 'bounties',
    maxSizeMB: 10,
    allowsMultiple: true,
    onUploaded: (attachment) => {
      const currentAttachments = draft.attachments || [];
      onUpdate({ attachments: [...currentAttachments, attachment] });
    },
    onError: (error) => {
      Alert.alert('Upload Error', error.message);
    },
  });

  const handleRemoveAttachment = (attachmentId: string) => {
    const currentAttachments = draft.attachments || [];
    const updated = currentAttachments.filter((a) => a.id !== attachmentId);
    onUpdate({ attachments: updated });
  };

  const handleViewAttachment = (attachment: Attachment) => {
    setSelectedAttachment(attachment);
    setViewerVisible(true);
  };

  const handleCloseViewer = () => {
    setViewerVisible(false);
    setSelectedAttachment(null);
  };

  const handleDescriptionChange = (value: string) => {
    onUpdate({ description: value });
    if (touched.description) {
      const error = validateDescription(value);
      setErrors({ ...errors, description: error || '' });
    }
  };

  const handleDescriptionBlur = () => {
    setTouched({ ...touched, description: true });
    const error = validateDescription(draft.description);
    setErrors({ ...errors, description: error || '' });
  };

  const handleNext = () => {
    const descriptionError = validateDescription(draft.description);

    if (descriptionError) {
      setErrors({ description: descriptionError });
      setTouched({ description: true });
      return;
    }

    onNext();
  };

  const isValid = !validateDescription(draft.description);

  const scrollRef = useRef<any>(null)
  useEffect(() => {
    const t = setTimeout(() => scrollRef.current?.scrollTo?.({ y: 0, animated: false }), 50)
    return () => clearTimeout(t)
  }, [])

  return (
    <View className="flex-1" style={{ backgroundColor: theme.background }}>
      <ScrollView
        ref={scrollRef}
        className="flex-1 px-4 pt-2"
        keyboardShouldPersistTaps="handled"
        nestedScrollEnabled={true}
        removeClippedSubviews={false}
        scrollEnabled={true}
        bounces={true}
        showsVerticalScrollIndicator={true}
        contentContainerStyle={{ flexGrow: 1, paddingBottom: BOTTOM_NAV_OFFSET + Math.max(insets.bottom, 12) + 16 }}
      >
        {/* Description Input */}
        <View className="mb-6">
          <Text className="text-base font-semibold mb-2" style={{ color: theme.text }}>
            Describe what you need done *
          </Text>
          <TextInput
            value={draft.description}
            onChangeText={handleDescriptionChange}
            onBlur={handleDescriptionBlur}
            placeholder="Provide details about the task, requirements, expectations, etc."
            placeholderTextColor={theme.textDisabled}
            className="px-4 py-3 rounded-lg text-base"
            style={{ backgroundColor: theme.surfaceSecondary, color: theme.text, minHeight: 120 }}
            multiline
            numberOfLines={6}
            textAlignVertical="top"
            accessibilityLabel="Bounty description input"
          />
          <Text className="text-xs mt-1" style={{ color: theme.textSecondary }}>
            {draft.description.length} characters (min 20)
          </Text>
          {touched.description && errors.description && (
            <ValidationMessage message={errors.description} />
          )}
        </View>

        {/* Timeline Input (Optional) */}
        <View className="mb-6">
          <Text className="text-base font-semibold mb-2" style={{ color: theme.text }}>
            Timeline (optional)
          </Text>
          <TextInput
            value={draft.timeline || ''}
            onChangeText={(value) => onUpdate({ timeline: value })}
            placeholder="e.g., Within 2 days, This weekend, ASAP..."
            placeholderTextColor={theme.textDisabled}
            className="px-4 py-3 rounded-lg text-base"
            style={{ backgroundColor: theme.surfaceSecondary, color: theme.text }}
            accessibilityLabel="Timeline input"
          />
        </View>

        {/* Skills Input (Optional) */}
        <View className="mb-6">
          <Text className="text-base font-semibold mb-2" style={{ color: theme.text }}>
            Required skills (optional)
          </Text>
          <TextInput
            value={draft.skills || ''}
            onChangeText={(value) => onUpdate({ skills: value })}
            placeholder="e.g., Moving truck, Design tools, Programming..."
            placeholderTextColor={theme.textDisabled}
            className="px-4 py-3 rounded-lg text-base"
            style={{ backgroundColor: theme.surfaceSecondary, color: theme.text }}
            accessibilityLabel="Required skills input"
          />
        </View>

        {/* Attachments */}
        <View className="mb-6">
          <Text className="text-base font-semibold mb-2" style={{ color: theme.text }}>
            Attachments (optional)
          </Text>

          {/* Upload Button */}
          <TouchableOpacity
            className="border-2 border-dashed rounded-lg py-6 flex items-center justify-center mb-3"
            style={{ backgroundColor: theme.surfaceSecondary, borderColor: theme.border }}
            onPress={() => pickAttachment()}
            disabled={isUploading || isPicking}
            accessibilityLabel="Add attachments"
            accessibilityRole="button"
          >
            {isUploading ? (
              <>
                <ActivityIndicator size="large" color={theme.primaryLight} />
                <Text className="mt-2 text-sm" style={{ color: theme.textSecondary }}>
                  Uploading... {Math.round(progress * 100)}%
                </Text>
              </>
            ) : isPicking ? (
              <>
                <ActivityIndicator size="large" color={theme.primaryLight} />
                <Text className="mt-2 text-sm" style={{ color: theme.textSecondary }}>
                  Selecting...
                </Text>
              </>
            ) : (
              <>
                <MaterialIcons name="cloud-upload" size={32} color={theme.primaryLight} />
                <Text className="mt-2 text-sm" style={{ color: theme.textSecondary }}>
                  Add photos, documents, or take a photo
                </Text>
              </>
            )}
          </TouchableOpacity>

          {/* Error Message */}
          {uploadError && (
            <View className="bg-red-500/20 border border-red-500/50 rounded-lg p-3 mb-3 flex-row items-center justify-between">
              <Text className="text-red-200 flex-1 text-sm">{uploadError}</Text>
              <TouchableOpacity onPress={clearError}>
                <MaterialIcons name="close" size={20} color="#fca5a5" />
              </TouchableOpacity>
            </View>
          )}

          {/* Attachment List with increased spacing */}
          {draft.attachments && draft.attachments.length > 0 && (
            <View style={{ gap: 12 }}>
              {draft.attachments.map((attachment) => (
                <TouchableOpacity
                  key={attachment.id}
                  onPress={() => handleViewAttachment(attachment)}
                  className="rounded-lg p-3 flex-row items-center"
                  style={{ backgroundColor: theme.surfaceSecondary }}
                  accessibilityLabel={`View ${attachment.name}`}
                  accessibilityRole="button"
                  accessibilityHint="Tap to view attachment"
                >
                  <View className="flex-1 flex-row items-center">
                    <MaterialIcons
                      name={
                        attachment.mimeType?.startsWith('image/')
                          ? 'image'
                          : attachment.mimeType?.startsWith('video/')
                            ? 'videocam'
                            : attachment.mimeType?.includes('pdf')
                              ? 'picture-as-pdf'
                              : 'insert-drive-file'
                      }
                      size={24}
                      color={theme.primaryLight}
                    />
                    <View className="ml-3 flex-1">
                      <Text className="text-sm" numberOfLines={1} style={{ color: theme.text }}>
                        {attachment.name}
                      </Text>
                      {attachment.size && (
                        <Text className="text-xs" style={{ color: theme.textSecondary }}>
                          {(attachment.size / 1024).toFixed(1)} KB
                        </Text>
                      )}
                      <Text className="text-xs mt-0.5" style={{ color: theme.textSecondary }}>
                        Tap to preview
                      </Text>
                    </View>
                  </View>
                  <TouchableOpacity
                    onPress={(e) => {
                      e.stopPropagation();
                      handleRemoveAttachment(attachment.id);
                    }}
                    className="p-2"
                    accessibilityLabel="Remove attachment"
                    accessibilityRole="button"
                  >
                    <MaterialIcons name="close" size={20} color="#fca5a5" />
                  </TouchableOpacity>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
      </ScrollView>

      {/* Navigation Buttons */}
      <View
        className="px-4 pb-4 pt-3 border-t"
        style={{ backgroundColor: theme.background, borderColor: theme.border, marginBottom: BOTTOM_NAV_OFFSET + Math.max(insets.bottom, 8) }}
      >
        <View className="flex-row gap-3">
          <TouchableOpacity
            onPress={onBack}
            className="flex-1 py-3 rounded-lg flex-row items-center justify-center"
            style={{ backgroundColor: theme.surfaceSecondary }}
            accessibilityLabel="Go back"
            accessibilityRole="button"
          >
            <MaterialIcons name="arrow-back" size={20} color={theme.text} />
            <Text className="font-semibold ml-2" style={{ color: theme.text }}>Back</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleNext}
            disabled={!isValid}
            className="flex-1 py-3 rounded-lg flex-row items-center justify-center"
            style={{ backgroundColor: isValid ? theme.primary : theme.surface }}
            accessibilityLabel="Continue to next step"
            accessibilityRole="button"
            accessibilityState={{ disabled: !isValid }}
          >
            <Text
              className="font-semibold mr-2"
              style={{ color: isValid ? '#fff' : theme.textDisabled }}
            >
              Next
            </Text>
            <MaterialIcons
              name="arrow-forward"
              size={20}
              color={isValid ? '#fff' : theme.textDisabled}
            />
          </TouchableOpacity>
        </View>
      </View>

      {/* Attachment Viewer Modal */}
      <AttachmentViewerModal
        visible={viewerVisible}
        attachment={selectedAttachment}
        onClose={handleCloseViewer}
      />
    </View>
  );
}

export default StepDetails;
