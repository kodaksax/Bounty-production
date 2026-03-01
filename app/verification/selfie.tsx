/**
 * Selfie / Liveness Verification Screen
 * Captures a front-facing selfie and uploads it to verification-docs storage.
 */

import { MaterialIcons } from '@expo/vector-icons';
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

export default function SelfieScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useAuthContext();

  const [selfieUri, setSelfieUri] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const takeSelfie = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        'Permission Required',
        'Camera permission is required to take a selfie.'
      );
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
      setSelfieUri(result.assets[0].uri);
    }
  };

  const handleRetake = () => {
    setSelfieUri(null);
  };

  const handleConfirm = async () => {
    if (!selfieUri) return;

    const userId = session?.user?.id;
    if (!userId) {
      Alert.alert('Not Signed In', 'Please sign in to verify your identity.');
      return;
    }

    setIsSubmitting(true);

    try {
      const uploadResult = await storageService.uploadFile(selfieUri, {
        bucket: 'verification-docs',
        path: `${userId}/selfie.jpg`,
      });

      if (!uploadResult.success || uploadResult.fallbackToLocal) {
        throw new Error(uploadResult.error ?? 'Failed to upload selfie to secure storage');
      }

      const { error: updateError } = await supabase
        .from('profiles')
        .update({ selfie_submitted_at: new Date().toISOString() })
        .eq('id', userId);

      if (updateError) {
        throw new Error(updateError.message ?? 'Failed to record selfie submission');
      }

      Alert.alert(
        'Selfie Submitted',
        'Your selfie has been submitted for verification.',
        [
          {
            text: 'OK',
            onPress: () => router.back(),
          },
        ]
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'An unexpected error occurred.';
      Alert.alert('Submission Failed', message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + 100 },
        ]}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.backButton}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            accessibilityHint="Returns to previous screen"
          >
            <MaterialIcons
              name="arrow-back"
              size={24}
              color="#a7f3d0"
              accessibilityElementsHidden={true}
            />
          </TouchableOpacity>
          <BrandingLogo size="small" />
          <View style={{ width: 40 }} />
        </View>

        {/* Title */}
        <View style={styles.content}>
          <View style={styles.iconCircle}>
            <MaterialIcons
              name="face"
              size={48}
              color="#a7f3d0"
              accessibilityElementsHidden={true}
            />
          </View>
          <Text style={styles.title} accessibilityRole="header">
            Take a Selfie
          </Text>
          <Text style={styles.subtitle}>
            Position your face inside the circle and take a clear, well-lit photo.
          </Text>
        </View>

        {/* Face frame / preview */}
        <View style={styles.cameraArea}>
          {selfieUri ? (
            <Image
              source={{ uri: selfieUri }}
              style={styles.selfiePreview}
              accessibilityLabel="Selfie preview"
            />
          ) : (
            <View style={styles.facePlaceholder}>
              <MaterialIcons
                name="person"
                size={80}
                color="rgba(167,243,208,0.4)"
                accessibilityElementsHidden={true}
              />
              <Text style={styles.facePlaceholderText}>Align your face here</Text>
            </View>
          )}
        </View>

        {/* Tip */}
        {!selfieUri && (
          <View style={styles.tipBox}>
            <MaterialIcons name="lightbulb" size={18} color="#fbbf24" accessibilityElementsHidden={true} />
            <Text style={styles.tipText}>
              Make sure your face is clearly visible and well-lit.
            </Text>
          </View>
        )}

        {/* Action buttons */}
        {!selfieUri ? (
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={takeSelfie}
            accessibilityRole="button"
            accessibilityLabel="Open camera to take selfie"
          >
            <MaterialIcons name="camera-alt" size={22} color="#052e1b" accessibilityElementsHidden={true} />
            <Text style={styles.primaryButtonText}>Take Selfie</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.actionRow}>
            <TouchableOpacity
              style={styles.retakeButton}
              onPress={handleRetake}
              disabled={isSubmitting}
              accessibilityRole="button"
              accessibilityLabel="Retake selfie"
              accessibilityState={{ disabled: isSubmitting }}
            >
              <MaterialIcons name="refresh" size={20} color="#a7f3d0" accessibilityElementsHidden={true} />
              <Text style={styles.retakeButtonText}>Retake</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.confirmButton, isSubmitting && styles.buttonDisabled]}
              onPress={handleConfirm}
              disabled={isSubmitting}
              accessibilityRole="button"
              accessibilityLabel={isSubmitting ? 'Submitting selfie' : 'Confirm and submit selfie'}
              accessibilityState={{ disabled: isSubmitting }}
            >
              <MaterialIcons name="check-circle" size={20} color="#052e1b" accessibilityElementsHidden={true} />
              <Text style={styles.confirmButtonText}>
                {isSubmitting ? 'Submitting...' : 'Confirm'}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Privacy notice */}
        <View style={styles.privacyBox}>
          <MaterialIcons name="lock" size={20} color="#a7f3d0" />
          <View style={styles.privacyContent}>
            <Text style={styles.privacyTitle}>Your Privacy</Text>
            <Text style={styles.privacyText}>
              Your selfie is encrypted and securely stored. It is used only for
              identity verification and is never shared with third parties.
            </Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#059669',
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
    backgroundColor: 'rgba(5,46,27,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'rgba(167,243,208,0.3)',
  },
  content: {
    alignItems: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 26,
    fontWeight: 'bold',
    color: '#ffffff',
    marginTop: SPACING.SCREEN_HORIZONTAL,
    marginBottom: SPACING.COMPACT_GAP,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 15,
    color: 'rgba(255,255,255,0.8)',
    textAlign: 'center',
    lineHeight: 22,
    paddingHorizontal: SPACING.SCREEN_HORIZONTAL,
  },
  cameraArea: {
    alignSelf: 'center',
    width: 220,
    height: 220,
    borderRadius: 110,
    borderWidth: 3,
    borderColor: '#a7f3d0',
    overflow: 'hidden',
    backgroundColor: 'rgba(5,46,27,0.5)',
    marginBottom: SPACING.SECTION_GAP,
    justifyContent: 'center',
    alignItems: 'center',
  },
  selfiePreview: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  facePlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  facePlaceholderText: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.5)',
    marginTop: 8,
    textAlign: 'center',
  },
  tipBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(5,46,27,0.4)',
    borderRadius: 10,
    padding: SPACING.ELEMENT_GAP,
    marginBottom: SPACING.SECTION_GAP,
    gap: SPACING.COMPACT_GAP,
  },
  tipText: {
    flex: 1,
    fontSize: 13,
    color: 'rgba(255,255,255,0.8)',
    lineHeight: 18,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#a7f3d0',
    paddingVertical: SPACING.CARD_PADDING,
    borderRadius: 999,
    marginBottom: SPACING.SECTION_GAP,
    gap: SPACING.COMPACT_GAP,
  },
  primaryButtonText: {
    color: '#052e1b',
    fontSize: 18,
    fontWeight: 'bold',
  },
  actionRow: {
    flexDirection: 'row',
    gap: SPACING.ELEMENT_GAP,
    marginBottom: SPACING.SECTION_GAP,
  },
  retakeButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(5,46,27,0.5)',
    paddingVertical: SPACING.CARD_PADDING,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: '#a7f3d0',
    gap: SPACING.COMPACT_GAP,
  },
  retakeButtonText: {
    color: '#a7f3d0',
    fontSize: 16,
    fontWeight: '600',
  },
  confirmButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#a7f3d0',
    paddingVertical: SPACING.CARD_PADDING,
    borderRadius: 999,
    gap: SPACING.COMPACT_GAP,
  },
  confirmButtonText: {
    color: '#052e1b',
    fontSize: 16,
    fontWeight: 'bold',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  privacyBox: {
    flexDirection: 'row',
    backgroundColor: 'rgba(5,46,27,0.5)',
    borderRadius: 12,
    padding: SPACING.CARD_PADDING,
    marginBottom: SPACING.SECTION_GAP,
    borderWidth: 1,
    borderColor: 'rgba(167,243,208,0.3)',
  },
  privacyContent: {
    flex: 1,
    marginLeft: 12,
  },
  privacyTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#a7f3d0',
    marginBottom: 4,
  },
  privacyText: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.8)',
    lineHeight: 18,
  },
});
