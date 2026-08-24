import { MaterialIcons } from '@expo/vector-icons';
import type { BountyDraft } from 'app/hooks/useBountyDraft';
import React, { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useAttachmentUpload } from '../../../../hooks/use-attachment-upload';
import { useAppThemeContext } from '../../../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../../../lib/themes/types';
import { QuickStepLayout } from './QuickStepLayout';

interface StepPhotosProps {
  draft: BountyDraft;
  onUpdate: (data: Partial<BountyDraft>) => void;
  onNext: () => void;
  onBack: () => void;
  /** True while the parent persists this step onto a live bounty. */
  isSaving?: boolean;
  step: number;
  totalSteps: number;
}

/**
 * Step 2 — optional context: extra written detail plus attachments.
 *
 * Uses the same upload pipeline as the previous flow (bounty-attachments bucket
 * via useAttachmentUpload), so uploaded files land on the draft in the shape
 * bountyService.createBounty already expects. The details field is the bounty's
 * description; it is optional because nothing on the create path validates it,
 * and step 1's title already carries the essential ask.
 */
export function StepPhotos({ draft, onUpdate, onNext, onBack, isSaving = false, step, totalSteps }: StepPhotosProps) {
  const { theme } = useAppThemeContext();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const [detailsFocused, setDetailsFocused] = useState(false);

  const attachments = draft.attachments || [];
  // Drives "Skip for now" vs "Continue" — either kind of context counts.
  const hasContext = attachments.length > 0 || (draft.description || '').trim().length > 0;

  // onUploaded fires once per file, in a synchronous loop, from a callback
  // captured on an earlier render — so appending to the `attachments` prop
  // would build every new list from the same pre-upload snapshot and keep
  // only the last photo of a multi-select. Track the running list here
  // instead, seeded from the prop on every render so removals stay in sync.
  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;

  const { isUploading, isPicking, progress, pickAttachment, error: uploadError, clearError } =
    useAttachmentUpload({
      bucket: 'bounty-attachments',
      folder: 'bounties',
      allowedTypes: 'images',
      maxSizeMB: 10,
      allowsMultiple: true,
      onUploaded: (attachment) => {
        const next = [...attachmentsRef.current, attachment];
        attachmentsRef.current = next;
        onUpdate({ attachments: next });
      },
      onError: (error) => {
        Alert.alert('Upload Error', error.message);
      },
    });

  const busy = isUploading || isPicking || isSaving;

  const handleRemove = (attachmentId: string) => {
    onUpdate({ attachments: attachments.filter((a) => a.id !== attachmentId) });
  };

  return (
    <QuickStepLayout
      step={step}
      totalSteps={totalSteps}
      onBack={onBack}
      title="Add photos or details"
      subtitle="Optional — photos and extra context help people understand the task."
      ctaLabel={hasContext ? 'Continue' : 'Skip for now'}
      ctaBusy={busy}
      onCta={onNext}
    >
      {/* Extra written detail — becomes the bounty description */}
      <TextInput
        value={draft.description}
        onChangeText={(value) => onUpdate({ description: value })}
        onFocus={() => setDetailsFocused(true)}
        onBlur={() => setDetailsFocused(false)}
        placeholder="Anything else they should know?"
        placeholderTextColor={theme.textSecondary}
        multiline
        textAlignVertical="top"
        style={[
          styles.details,
          { borderColor: detailsFocused ? theme.primary : theme.border },
        ]}
        accessibilityLabel="Additional details about the task"
      />

      {/* Gallery drop zone */}
      <TouchableOpacity
        onPress={() => pickAttachment('photos')}
        disabled={busy}
        activeOpacity={0.8}
        style={styles.dropZone}
        accessibilityRole="button"
        accessibilityLabel="Choose photos from gallery"
      >
        {isUploading ? (
          <>
            <ActivityIndicator size="large" color={theme.primary} />
            <Text style={styles.dropZoneLabel}>Uploading… {Math.round(progress * 100)}%</Text>
          </>
        ) : isPicking ? (
          <>
            <ActivityIndicator size="large" color={theme.primary} />
            <Text style={styles.dropZoneLabel}>Selecting…</Text>
          </>
        ) : (
          <>
            <View style={styles.iconCircle}>
              <MaterialIcons name="image" size={26} color={theme.text} />
            </View>
            <Text style={styles.dropZoneLabel}>Choose from gallery</Text>
          </>
        )}
      </TouchableOpacity>

      {/* Camera */}
      <TouchableOpacity
        onPress={() => pickAttachment('camera')}
        disabled={busy}
        activeOpacity={0.8}
        style={styles.cameraButton}
        accessibilityRole="button"
        accessibilityLabel="Take a photo"
      >
        <MaterialIcons name="photo-camera" size={22} color={theme.text} />
        <Text style={styles.cameraLabel}>Take a photo</Text>
      </TouchableOpacity>

      {uploadError ? (
        <TouchableOpacity onPress={clearError} style={styles.errorBox} accessibilityRole="button">
          <Text style={styles.errorText}>{uploadError}</Text>
          <MaterialIcons name="close" size={18} color={theme.error} />
        </TouchableOpacity>
      ) : null}

      {/* Uploaded thumbnails */}
      {attachments.length > 0 ? (
        <View style={styles.thumbRow}>
          {attachments.map((attachment) => (
            <View key={attachment.id} style={styles.thumbWrapper}>
              <Image
                source={{ uri: attachment.remoteUri || attachment.uri }}
                style={styles.thumb}
                accessibilityLabel={attachment.name}
              />
              <TouchableOpacity
                onPress={() => handleRemove(attachment.id)}
                style={styles.thumbRemove}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${attachment.name}`}
              >
                <MaterialIcons name="close" size={14} color="#ffffff" />
              </TouchableOpacity>
            </View>
          ))}
        </View>
      ) : null}
    </QuickStepLayout>
  );
}

export default StepPhotos;

function makeStyles(theme: AppTheme) {
  return StyleSheet.create({
    details: {
      minHeight: 96,
      borderRadius: 24,
      borderWidth: 2,
      backgroundColor: theme.surface,
      color: theme.text,
      paddingHorizontal: 20,
      paddingTop: 16,
      paddingBottom: 16,
      fontSize: 17,
      lineHeight: 23,
      marginBottom: 16,
    },
    dropZone: {
      height: 180,
      borderRadius: 24,
      borderWidth: 2,
      borderStyle: 'dashed',
      borderColor: theme.border,
      backgroundColor: theme.surfaceSecondary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    iconCircle: {
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: theme.isDark ? 'rgba(5,150,105,0.22)' : 'rgba(5,150,105,0.12)',
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 14,
    },
    dropZoneLabel: { fontSize: 18, fontWeight: '600', color: theme.text },
    cameraButton: {
      marginTop: 16,
      height: 64,
      borderRadius: 24,
      backgroundColor: theme.surfaceSecondary,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
    },
    cameraLabel: { marginLeft: 10, fontSize: 18, fontWeight: '600', color: theme.text },
    errorBox: {
      marginTop: 16,
      padding: 12,
      borderRadius: 16,
      backgroundColor: 'rgba(239,68,68,0.12)',
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    errorText: { flex: 1, marginRight: 8, fontSize: 14, color: theme.error },
    thumbRow: { marginTop: 20, flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
    thumbWrapper: { width: 84, height: 84 },
    thumb: { width: 84, height: 84, borderRadius: 16, backgroundColor: theme.surfaceSecondary },
    thumbRemove: {
      position: 'absolute',
      top: -6,
      right: -6,
      width: 24,
      height: 24,
      borderRadius: 12,
      backgroundColor: 'rgba(17,24,39,0.85)',
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
}
