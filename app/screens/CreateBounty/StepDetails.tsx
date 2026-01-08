import { MaterialIcons } from '@expo/vector-icons';
import { ValidationMessage } from 'app/components/ValidationMessage';
import type { BountyDraft } from 'app/hooks/useBountyDraft';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAttachmentUpload } from '../../../hooks/use-attachment-upload';
import { AttachmentViewerModal } from '../../../components/attachment-viewer-modal';
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

  const validateDescription = (value: string): string | null => {
    if (!value || value.trim().length === 0) {
      return 'Description is required';
    }
    if (value.length < 20) {
      return 'Description must be at least 20 characters';
    }
    return null;
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
    <View className="flex-1 bg-emerald-600">
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
          <Text className="text-emerald-100 text-base font-semibold mb-2">
            Describe what you need done *
          </Text>
          <TextInput
            value={draft.description}
            onChangeText={handleDescriptionChange}
            onBlur={handleDescriptionBlur}
            placeholder="Provide details about the task, requirements, expectations, etc."
            placeholderTextColor="rgba(110, 231, 183, 0.4)"
            className="bg-emerald-700/50 text-white px-4 py-3 rounded-lg text-base"
            multiline
            numberOfLines={6}
            textAlignVertical="top"
            style={{ minHeight: 120 }}
            accessibilityLabel="Bounty description input"
          />
          <Text className="text-emerald-200/60 text-xs mt-1">
            {draft.description.length} characters (min 20)
          </Text>
          {touched.description && errors.description && (
            <ValidationMessage message={errors.description} />
          )}
        </View>

        {/* Timeline Input (Optional) */}
        <View className="mb-6">
          <Text className="text-emerald-100 text-base font-semibold mb-2">
            Timeline (optional)
          </Text>
          <TextInput
            value={draft.timeline || ''}
            onChangeText={(value) => onUpdate({ timeline: value })}
            placeholder="e.g., Within 2 days, This weekend, ASAP..."
            placeholderTextColor="rgba(110, 231, 183, 0.4)"
            className="bg-emerald-700/50 text-white px-4 py-3 rounded-lg text-base"
            accessibilityLabel="Timeline input"
          />
        </View>

        {/* Skills Input (Optional) */}
        <View className="mb-6">
          <Text className="text-emerald-100 text-base font-semibold mb-2">
            Required skills (optional)
          </Text>
          <TextInput
            value={draft.skills || ''}
            onChangeText={(value) => onUpdate({ skills: value })}
            placeholder="e.g., Moving truck, Design tools, Programming..."
            placeholderTextColor="rgba(110, 231, 183, 0.4)"
            className="bg-emerald-700/50 text-white px-4 py-3 rounded-lg text-base"
            accessibilityLabel="Required skills input"
          />
        </View>

        {/* Attachments */}
        <View className="mb-6">
          <Text className="text-emerald-100 text-base font-semibold mb-2">
            Attachments (optional)
          </Text>
          
          {/* Upload Button */}
          <TouchableOpacity
            className="bg-emerald-700/50 border-2 border-dashed border-emerald-500/50 rounded-lg py-6 flex items-center justify-center mb-3"
            onPress={() => pickAttachment()}
            disabled={isUploading || isPicking}
            accessibilityLabel="Add attachments"
            accessibilityRole="button"
          >
            {isUploading ? (
              <>
                <ActivityIndicator size="large" color="rgba(110, 231, 183, 0.6)" />
                <Text className="text-emerald-300/60 mt-2 text-sm">
                  Uploading... {Math.round(progress * 100)}%
                </Text>
              </>
            ) : isPicking ? (
              <>
                <ActivityIndicator size="large" color="rgba(110, 231, 183, 0.6)" />
                <Text className="text-emerald-300/60 mt-2 text-sm">
                  Selecting...
                </Text>
              </>
            ) : (
              <>
                <MaterialIcons name="cloud-upload" size={32} color="rgba(110, 231, 183, 0.6)" />
                <Text className="text-emerald-300/60 mt-2 text-sm">
                  Add photos, documents, or take a photo
                </Text>
              </>
            )}
          </TouchableOpacity>

          {/* Error Message */}
          {uploadError && (
            <View className="bg-red-500/20 border border-red-500/50 rounded-lg p-3 mb-3 flex-row items-center justify-between">
              <Text className="text-red-200 flex-1 text-sm">{uploadError}</Text>
              <TouchableOpacity accessibilityRole="button" onPress={clearError}>
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
                  className="bg-emerald-700/30 rounded-lg p-3 flex-row items-center"
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
                      color="#6ee7b7"
                    />
                    <View className="ml-3 flex-1">
                      <Text className="text-white text-sm" numberOfLines={1}>
                        {attachment.name}
                      </Text>
                      {attachment.size && (
                        <Text className="text-emerald-300/60 text-xs">
                          {(attachment.size / 1024).toFixed(1)} KB
                        </Text>
                      )}
                      <Text className="text-emerald-400/60 text-xs mt-0.5">
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
        className="px-4 pb-4 pt-3 bg-emerald-600 border-t border-emerald-700/50"
        style={{ marginBottom: BOTTOM_NAV_OFFSET + Math.max(insets.bottom, 8) }}
      >
        <View className="flex-row gap-3">
          <TouchableOpacity
            onPress={onBack}
            className="flex-1 bg-emerald-700/50 py-3 rounded-lg flex-row items-center justify-center"
            accessibilityLabel="Go back"
            accessibilityRole="button"
          >
            <MaterialIcons name="arrow-back" size={20} color="#fff" />
            <Text className="text-white font-semibold ml-2">Back</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleNext}
            disabled={!isValid}
            className={`flex-1 py-3 rounded-lg flex-row items-center justify-center ${
              isValid ? 'bg-emerald-500' : 'bg-emerald-700/30'
            }`}
            accessibilityLabel="Continue to next step"
            accessibilityRole="button"
            accessibilityState={{ disabled: !isValid }}
          >
            <Text
              className={`font-semibold mr-2 ${
                isValid ? 'text-white' : 'text-emerald-400/40'
              }`}
            >
              Next
            </Text>
            <MaterialIcons
              name="arrow-forward"
              size={20}
              color={isValid ? '#fff' : 'rgba(110, 231, 183, 0.4)'}
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
