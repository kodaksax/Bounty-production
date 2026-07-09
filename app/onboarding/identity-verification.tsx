/**
 * Identity Verification Onboarding Screen
 *
 * Lightweight launch-focused KYC step that runs near the end of onboarding.
 * Collects a government-issued ID (front) and a selfie, uploads both to the
 * existing `verification-docs` Supabase Storage bucket under the user's
 * folder, then calls the existing `review-id` edge function which transitions
 * the user's `id_verification_status` from "unverified" → "pending".
 *
 * Reuses existing utilities only:
 *   - storageService (lib/services/storage-service)
 *   - compressImage (lib/utils/image-utils)
 *   - review-id Supabase Edge Function
 *
 * Users can skip this step and complete it later from their profile.
 */

import { MaterialIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BrandingLogo } from '../../components/ui/branding-logo';
import { useAuthContext } from '../../hooks/use-auth-context';
import { SPACING } from '../../lib/constants/accessibility';
import { storageService } from '../../lib/services/storage-service';
import { supabase } from '../../lib/supabase';
import { compressImage } from '../../lib/utils/image-utils';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../lib/themes/types';

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/heic'];
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB — matches bucket limit

// Cache key prefix used by storageService when it falls back to AsyncStorage.
// Kept in sync with lib/services/storage-service.ts (STORAGE_PREFIX).
const STORAGE_FALLBACK_PREFIX = 'attachment-cache-';

type UploadStep = 'idle' | 'uploading-id' | 'uploading-selfie' | 'submitting' | 'submitted';

/**
 * Remove a compressed-image cache file produced by `compressImage`. Sensitive
 * identity documents should not linger on-device after upload. Best-effort
 * only — failure to delete is logged but not surfaced to the user.
 */
async function deleteCachedImage(uri: string | null, originalUri: string | null): Promise<void> {
  if (!uri || uri === originalUri) return;
  try {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  } catch (e) {
    console.warn('[IdentityVerification] Failed to delete cached image:', e);
  }
}

/**
 * Defensively remove any local AsyncStorage fallback artifact for an
 * uploaded verification document. `storageService.deleteFile` only clears
 * the AsyncStorage key when Supabase is unconfigured, so when an upload
 * silently fell back to local storage we need to clear the key directly.
 */
async function purgeFallbackArtifact(path: string): Promise<void> {
  try {
    if (AsyncStorage && typeof AsyncStorage.removeItem === 'function') {
      await AsyncStorage.removeItem(STORAGE_FALLBACK_PREFIX + path);
    }
  } catch (e) {
    console.warn('[IdentityVerification] Failed to clear fallback artifact:', e);
  }
}

function uriToMime(uri: string): string {
  const ext = uri.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    heic: 'image/heic',
  };
  // Camera captures often omit an extension; default to jpeg.
  return map[ext] ?? 'image/jpeg';
}

export default function IdentityVerificationScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useAuthContext();

  const { theme } = useAppThemeContext();
  const styles = makeStyles(theme);
  const [idImage, setIdImage] = useState<string | null>(null);
  const [selfieImage, setSelfieImage] = useState<string | null>(null);
  const [step, setStep] = useState<UploadStep>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isSubmitting = step !== 'idle' && step !== 'submitted';

  const validateAsset = (asset: ImagePicker.ImagePickerAsset): string | null => {
    if (asset.fileSize && asset.fileSize > MAX_FILE_SIZE_BYTES) {
      return 'Please choose an image under 10 MB.';
    }
    const mime = asset.mimeType ?? uriToMime(asset.uri);
    if (!ALLOWED_MIME_TYPES.includes(mime)) {
      return 'Image must be a JPEG, PNG, or HEIC file.';
    }
    return null;
  };

  const pickIdImage = () => {
    Alert.alert(
      'Upload Government ID',
      'How would you like to provide your ID?',
      [
        {
          text: 'Take Photo',
          onPress: async () => {
            const perm = await ImagePicker.requestCameraPermissionsAsync();
            if (!perm.granted) {
              Alert.alert('Permission Required', 'Camera permission is required to capture your ID.');
              return;
            }
            const result = await ImagePicker.launchCameraAsync({
              mediaTypes: ['images'],
              allowsEditing: true,
              aspect: [16, 10],
              quality: 0.9,
            });
            if (!result.canceled && result.assets[0]) {
              const err = validateAsset(result.assets[0]);
              if (err) {
                Alert.alert('Invalid Image', err);
                return;
              }
              setIdImage(result.assets[0].uri);
            }
          },
        },
        {
          text: 'Choose from Library',
          onPress: async () => {
            const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (!perm.granted) {
              Alert.alert('Permission Required', 'Photo library permission is required.');
              return;
            }
            const result = await ImagePicker.launchImageLibraryAsync({
              mediaTypes: ['images'],
              allowsEditing: true,
              aspect: [16, 10],
              quality: 0.9,
            });
            if (!result.canceled && result.assets[0]) {
              const err = validateAsset(result.assets[0]);
              if (err) {
                Alert.alert('Invalid Image', err);
                return;
              }
              setIdImage(result.assets[0].uri);
            }
          },
        },
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  };

  const takeSelfie = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission Required', 'Camera permission is required to take a selfie.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      cameraType: ImagePicker.CameraType.front,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
    });
    if (!result.canceled && result.assets[0]) {
      const err = validateAsset(result.assets[0]);
      if (err) {
        Alert.alert('Invalid Image', err);
        return;
      }
      setSelfieImage(result.assets[0].uri);
    }
  };

  const handleSkip = () => {
    if (isSubmitting) return;
    router.replace('/onboarding/done');
  };

  const handleSubmit = async () => {
    setErrorMessage(null);

    if (!idImage || !selfieImage) {
      Alert.alert('Missing Images', 'Please upload both your ID and a selfie before submitting.');
      return;
    }

    const userId = session?.user?.id;
    if (!userId) {
      Alert.alert('Not Signed In', 'Please sign in again to verify your identity.');
      return;
    }

    const idPath = `${userId}/id-front.jpg`;
    const selfiePath = `${userId}/selfie.jpg`;
    let idUploadUri: string | null = null;
    let selfieUploadUri: string | null = null;
    let idUploadedRemotely = false;

    try {
      // Compress before upload to keep mobile uploads reasonable.
      // Falls back to original URI if compression fails.
      setStep('uploading-id');
      idUploadUri = idImage;
      try {
        const compressed = await compressImage(idImage, 0.7, 'jpeg');
        idUploadUri = compressed.uri;
      } catch (e) {
        console.warn('[IdentityVerification] ID compression failed, uploading original:', e);
      }

      const idResult = await storageService.uploadFile(idUploadUri, {
        bucket: 'verification-docs',
        path: idPath,
      });
      if (!idResult.success || idResult.fallbackToLocal) {
        if (idResult.fallbackToLocal) {
          // Don't keep sensitive ID images in AsyncStorage.
          await purgeFallbackArtifact(idPath);
        }
        throw new Error(idResult.error ?? 'Failed to upload ID to secure storage');
      }
      idUploadedRemotely = true;

      setStep('uploading-selfie');
      selfieUploadUri = selfieImage;
      try {
        const compressed = await compressImage(selfieImage, 0.75, 'jpeg');
        selfieUploadUri = compressed.uri;
      } catch (e) {
        console.warn('[IdentityVerification] Selfie compression failed, uploading original:', e);
      }

      const selfieResult = await storageService.uploadFile(selfieUploadUri, {
        bucket: 'verification-docs',
        path: selfiePath,
      });
      if (!selfieResult.success || selfieResult.fallbackToLocal) {
        if (selfieResult.fallbackToLocal) {
          await purgeFallbackArtifact(selfiePath);
        }
        throw new Error(selfieResult.error ?? 'Failed to upload selfie to secure storage');
      }

      // Mark profile as pending review via existing edge function. We use
      // 'driversLicense' as the default doc type for this lightweight flow.
      setStep('submitting');
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      const { error: fnError } = await supabase.functions.invoke('review-id', {
        body: { userId, docType: 'driversLicense' },
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
      });
      if (fnError) {
        throw new Error(fnError.message ?? 'Verification submission failed');
      }

      // Record selfie submission timestamp on profile (matches existing selfie screen behaviour).
      // Non-fatal if it fails — admin can still review uploads.
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ selfie_submitted_at: new Date().toISOString() })
        .eq('id', userId);
      if (updateError) {
        console.warn('[IdentityVerification] Failed to record selfie timestamp:', updateError.message);
      }

      // TODO: Trigger in-app/push notification to admin team that a new
      // verification submission is awaiting review (notifications-outbox or
      // admin Slack webhook). Currently only logged server-side by review-id.

      setStep('submitted');
    } catch (error) {
      // Roll back any partial uploads so we don't leave orphaned sensitive
      // documents in storage when the submission wasn't actually queued.
      if (idUploadedRemotely) {
        try {
          await storageService.deleteFile('verification-docs', idPath);
        } catch (e) {
          console.warn('[IdentityVerification] Failed to clean up uploaded ID after failure:', e);
        }
      }
      const message = error instanceof Error ? error.message : 'An unexpected error occurred.';
      setErrorMessage(message);
      setStep('idle');
    } finally {
      // Always remove the locally compressed images from the app cache so a
      // sensitive copy doesn't linger on-device.
      await deleteCachedImage(idUploadUri, idImage);
      await deleteCachedImage(selfieUploadUri, selfieImage);
    }
  };

  // Success / pending review state
  if (step === 'submitted') {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <ScrollView contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 100 }]}>
          <View style={styles.header}>
            <View style={{ width: 40 }} />
            <BrandingLogo size="small" />
            <View style={{ width: 40 }} />
          </View>

          <View style={[styles.content, { marginTop: 32 }]}>
            <View style={[styles.iconCircle, styles.iconCircleSuccess]}>
              <MaterialIcons name="hourglass-top" size={48} color="#9CA3AF" />
            </View>
            <Text style={styles.title} accessibilityRole="header">Verification Submitted</Text>
            <Text style={styles.subtitle}>
              Thanks! Your ID and selfie are securely uploaded and queued for review.
              Most submissions are reviewed within 24–48 hours. You can keep using
              Bounty while we verify your identity.
            </Text>
          </View>

          <TouchableOpacity
            style={styles.submitButton}
            onPress={() => router.replace('/onboarding/done')}
            accessibilityRole="button"
            accessibilityLabel="Continue to Bounty"
          >
            <Text style={styles.submitButtonText}>Continue</Text>
            <MaterialIcons name="arrow-forward" size={20} color="#052e1b" />
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }

  const getSubmitLabel = () => {
    switch (step) {
      case 'uploading-id': return 'Uploading ID…';
      case 'uploading-selfie': return 'Uploading selfie…';
      case 'submitting': return 'Submitting…';
      default: return 'Submit for Verification';
    }
  };

  const canSubmit = !!idImage && !!selfieImage && !isSubmitting;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScrollView contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 100 }]}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.backButton}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            disabled={isSubmitting}
          >
            <MaterialIcons name="arrow-back" size={24} color="#9CA3AF" />
          </TouchableOpacity>
          <BrandingLogo size="small" />
          <View style={{ width: 40 }} />
        </View>

        {/* Prompt */}
        <View style={styles.content}>
          <View style={styles.iconCircle}>
            <MaterialIcons name="verified-user" size={48} color="#9CA3AF" />
          </View>
          <Text style={styles.title} accessibilityRole="header">Verify Your Identity</Text>
          <Text style={styles.subtitle}>
            Verifying your identity builds trust with other users and unlocks
            faster payouts. Your documents are encrypted and only used for
            verification — never shared publicly. You can skip for now and
            verify later from your profile.
          </Text>
        </View>

        {/* ID upload */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>1. Government-issued ID</Text>
          <Text style={styles.helperText}>
            Driver{'\u2019'}s license, passport, or national ID — front side.
          </Text>
          <TouchableOpacity
            style={styles.uploadBox}
            onPress={pickIdImage}
            disabled={isSubmitting}
            accessibilityRole="button"
            accessibilityLabel={idImage ? 'ID photo uploaded. Tap to replace.' : 'Upload front of your ID'}
          >
            {idImage ? (
              <Image source={{ uri: idImage }} style={styles.uploadedImage} />
            ) : (
              <>
                <MaterialIcons name="add-a-photo" size={40} color="#9CA3AF" />
                <Text style={styles.uploadText}>Tap to upload front of ID</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        {/* Selfie */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>2. Selfie</Text>
          <TouchableOpacity
            style={styles.uploadBox}
            onPress={takeSelfie}
            disabled={isSubmitting}
            accessibilityRole="button"
            accessibilityLabel={selfieImage ? 'Selfie taken. Tap to retake.' : 'Take a selfie'}
          >
            {selfieImage ? (
              <Image source={{ uri: selfieImage }} style={styles.uploadedImage} />
            ) : (
              <>
                <MaterialIcons name="camera-front" size={40} color="#9CA3AF" />
                <Text style={styles.uploadText}>Tap to take a selfie</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        {/* Privacy notice */}
        <View style={styles.privacyBox}>
          <MaterialIcons name="lock" size={20} color="#9CA3AF" />
          <View style={styles.privacyContent}>
            <Text style={styles.privacyTitle}>Your Privacy</Text>
            <Text style={styles.privacyText}>
              Your documents are stored in a private bucket with access controls.
              Only the Bounty verification team can review your submission.
            </Text>
          </View>
        </View>

        {/* Error */}
        {errorMessage && (
          <View style={styles.errorBox}>
            <MaterialIcons name="error-outline" size={20} color="#fecaca" />
            <Text style={styles.errorText}>{errorMessage}</Text>
            <TouchableOpacity
              onPress={() => setErrorMessage(null)}
              accessibilityLabel="Dismiss error"
            >
              <MaterialIcons name="close" size={18} color="#fecaca" />
            </TouchableOpacity>
          </View>
        )}

        {/* Actions */}
        <TouchableOpacity
          style={[styles.submitButton, !canSubmit && styles.submitButtonDisabled]}
          onPress={handleSubmit}
          disabled={!canSubmit}
          accessibilityRole="button"
          accessibilityLabel={getSubmitLabel()}
          accessibilityState={{ disabled: !canSubmit }}
        >
          <Text style={styles.submitButtonText}>{getSubmitLabel()}</Text>
          {!isSubmitting && <MaterialIcons name="check-circle" size={20} color="#052e1b" />}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.skipButton}
          onPress={handleSkip}
          disabled={isSubmitting}
          accessibilityRole="button"
          accessibilityLabel="Skip identity verification for now"
        >
          <Text style={styles.skipButtonText}>Skip for now</Text>
        </TouchableOpacity>

        {/* Progress dots — step 4 of 5 (username → details → phone → identity → done) */}
        <View style={styles.progressContainer}>
          <View style={styles.progressDot} />
          <View style={styles.progressDot} />
          <View style={styles.progressDot} />
          <View style={[styles.progressDot, styles.progressDotActive]} />
          <View style={styles.progressDot} />
        </View>
      </ScrollView>
    </View>
  );
}

function makeStyles(theme: AppTheme) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.background,
    },
    scrollContent: {
      flexGrow: 1,
      paddingHorizontal: SPACING.SCREEN_HORIZONTAL,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: SPACING.COMPACT_GAP,
      marginBottom: SPACING.SCREEN_HORIZONTAL,
    },
    backButton: {
      padding: SPACING.COMPACT_GAP,
    },
    iconCircle: {
      width: 80,
      height: 80,
      borderRadius: 40,
      backgroundColor: theme.surface,
      justifyContent: 'center',
      alignItems: 'center',
      borderWidth: 2,
      borderColor: theme.border,
    },
    iconCircleSuccess: {
      borderColor: theme.primary,
    },
    content: {
      alignItems: 'center',
      marginBottom: 24,
    },
    title: {
      fontSize: 26,
      fontWeight: 'bold',
      color: theme.text,
      marginTop: SPACING.SCREEN_HORIZONTAL,
      marginBottom: SPACING.COMPACT_GAP,
      textAlign: 'center',
    },
    subtitle: {
      fontSize: 15,
      color: theme.textSecondary,
      textAlign: 'center',
      lineHeight: 22,
      paddingHorizontal: SPACING.SCREEN_HORIZONTAL,
    },
    section: {
      marginBottom: SPACING.SECTION_GAP,
    },
    sectionTitle: {
      fontSize: 16,
      fontWeight: '600',
      color: theme.textSecondary,
      marginBottom: SPACING.ELEMENT_GAP,
    },
    helperText: {
      fontSize: 13,
      color: theme.textSecondary,
      marginTop: -SPACING.COMPACT_GAP,
      marginBottom: SPACING.ELEMENT_GAP,
    },
    uploadBox: {
      backgroundColor: theme.surface,
      borderRadius: 12,
      borderWidth: 2,
      borderColor: theme.border,
      borderStyle: 'dashed',
      height: 180,
      justifyContent: 'center',
      alignItems: 'center',
      overflow: 'hidden',
    },
    uploadText: {
      fontSize: 14,
      color: theme.textSecondary,
      marginTop: 8,
    },
    uploadedImage: {
      width: '100%',
      height: '100%',
      resizeMode: 'cover',
    },
    privacyBox: {
      flexDirection: 'row',
      backgroundColor: theme.surface,
      borderRadius: 12,
      padding: SPACING.CARD_PADDING,
      marginBottom: SPACING.SECTION_GAP,
      borderWidth: 1,
      borderColor: theme.border,
    },
    privacyContent: {
      flex: 1,
      marginLeft: 12,
    },
    privacyTitle: {
      fontSize: 14,
      fontWeight: '600',
      color: theme.textSecondary,
      marginBottom: 4,
    },
    privacyText: {
      fontSize: 13,
      color: theme.textSecondary,
      lineHeight: 18,
    },
    errorBox: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACING.COMPACT_GAP,
      backgroundColor: 'rgba(127,29,29,0.6)',
      borderRadius: 12,
      padding: SPACING.CARD_PADDING,
      marginBottom: SPACING.ELEMENT_GAP,
      borderWidth: 1,
      borderColor: 'rgba(252,165,165,0.3)',
    },
    errorText: {
      flex: 1,
      color: '#fecaca',
      fontSize: 13,
      lineHeight: 18,
    },
    submitButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.primary,
      paddingVertical: SPACING.CARD_PADDING,
      borderRadius: 999,
      marginBottom: SPACING.COMPACT_GAP,
      gap: SPACING.COMPACT_GAP,
    },
    submitButtonDisabled: {
      opacity: 0.5,
    },
    submitButtonText: {
      color: '#052e1b',
      fontSize: 18,
      fontWeight: 'bold',
    },
    skipButton: {
      alignItems: 'center',
      paddingVertical: 12,
      marginBottom: SPACING.SCREEN_HORIZONTAL,
    },
    skipButtonText: {
      color: theme.textSecondary,
      fontSize: 16,
    },
    progressContainer: {
      flexDirection: 'row',
      justifyContent: 'center',
      gap: 8,
      paddingTop: 8,
    },
    progressDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: theme.border,
    },
    progressDotActive: {
      backgroundColor: theme.primary,
    },
  });
}
