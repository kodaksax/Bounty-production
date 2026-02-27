/**
 * ID Verification Upload Screen
 * Future implementation for identity verification
 * Placeholder for integration with Onfido, Stripe Identity, or similar
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
import { SPACING } from '../../lib/constants/accessibility';

type DocumentType = 'passport' | 'driversLicense' | 'nationalId';

export default function UploadIDScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [selectedDocType, setSelectedDocType] = useState<DocumentType>('driversLicense');
  const [frontImage, setFrontImage] = useState<string | null>(null);
  const [backImage, setBackImage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleDocTypeSelect = (type: DocumentType) => {
    setSelectedDocType(type);
    // Reset images when changing document type
    setFrontImage(null);
    setBackImage(null);
  };

  const pickImage = async (side: 'front' | 'back') => {
    const permissionResult = await ImagePicker.requestCameraPermissionsAsync();

    if (!permissionResult.granted) {
      Alert.alert(
        'Permission Required',
        'Camera permission is required to take photos of your ID.'
      );
      return;
    }

    Alert.alert(
      'Choose Method',
      'How would you like to provide your ID?',
      [
        {
          text: 'Take Photo',
          onPress: async () => {
            const result = await ImagePicker.launchCameraAsync({
              mediaTypes: ['images'],
              allowsEditing: true,
              aspect: [16, 10],
              quality: 0.9,
            });

            if (!result.canceled && result.assets[0]) {
              if (side === 'front') {
                setFrontImage(result.assets[0].uri);
              } else {
                setBackImage(result.assets[0].uri);
              }
            }
          },
        },
        {
          text: 'Choose from Library',
          onPress: async () => {
            const result = await ImagePicker.launchImageLibraryAsync({
              mediaTypes: ['images'],
              allowsEditing: true,
              aspect: [16, 10],
              quality: 0.9,
            });

            if (!result.canceled && result.assets[0]) {
              if (side === 'front') {
                setFrontImage(result.assets[0].uri);
              } else {
                setBackImage(result.assets[0].uri);
              }
            }
          },
        },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  };

  const handleSubmit = async () => {
    // Validate that images are provided
    if (!frontImage || (selectedDocType !== 'passport' && !backImage)) {
      Alert.alert(
        'Missing Images',
        'Please upload all required images of your ID.'
      );
      return;
    }

    setIsSubmitting(true);

    // TODO (Post-Launch): Integrate with actual verification service
    // Options:
    // 1. Onfido: https://onfido.com/
    // 2. Stripe Identity: https://stripe.com/identity
    // 3. Supabase Edge Function + Manual Review

    // Placeholder implementation - in production this would call a real API
    // Use a simple timeout without the Promise wrapper pattern
    setTimeout(() => {
      // In production, check if component is still mounted using a ref
      setIsSubmitting(false);
      Alert.alert(
        'Verification Submitted',
        'Your ID has been submitted for review. We will notify you once verification is complete (typically within 24-48 hours).',
        [
          {
            text: 'OK',
            onPress: () => router.back(),
          },
        ]
      );
    }, 2000);
  };

  const canSubmit = frontImage && (selectedDocType === 'passport' || backImage);

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
            accessibilityHint="Returns to previous screen"
          >
            <MaterialIcons name="arrow-back" size={24} color="#a7f3d0" accessibilityElementsHidden={true} />
          </TouchableOpacity>
          <BrandingLogo size="small" />
          <View style={{ width: 40 }} />
        </View>

        {/* Content */}
        <View style={styles.content}>
          <View style={styles.iconCircle}>
            <MaterialIcons name="verified-user" size={48} color="#a7f3d0" accessibilityElementsHidden={true} />
          </View>
          <Text style={styles.title} accessibilityRole="header">Verify Your Identity</Text>
          <Text style={styles.subtitle}>
            Upload a government-issued ID to get verified. Verified users gain access to premium features.
          </Text>
        </View>

        {/* Benefits */}
        <View style={styles.benefitsCard}>
          <Text style={styles.benefitsTitle}>Verified Member Benefits</Text>
          <View style={styles.benefit}>
            <MaterialIcons name="star" size={18} color="#fbbf24" />
            <Text style={styles.benefitText}>Premium verified badge on profile</Text>
          </View>
          <View style={styles.benefit}>
            <MaterialIcons name="attach-money" size={18} color="#10b981" />
            <Text style={styles.benefitText}>Higher transaction limits</Text>
          </View>
          <View style={styles.benefit}>
            <MaterialIcons name="trending-up" size={18} color="#60a5fa" />
            <Text style={styles.benefitText}>Priority in bounty matching</Text>
          </View>
          <View style={styles.benefit}>
            <MaterialIcons name="security" size={18} color="#a78bfa" />
            <Text style={styles.benefitText}>Enhanced trust score</Text>
          </View>
        </View>

        {/* Document Type Selection */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Select Document Type</Text>
          <View style={styles.docTypeContainer}>
            <TouchableOpacity
              style={[
                styles.docTypeButton,
                selectedDocType === 'driversLicense' && styles.docTypeButtonActive,
              ]}
              onPress={() => handleDocTypeSelect('driversLicense')}
              accessibilityRole="radio"
              accessibilityLabel="Driver's License"
              accessibilityState={{ selected: selectedDocType === 'driversLicense' }}
              accessibilityHint="Select this document type for verification"
            >
              <MaterialIcons name="credit-card" size={24} color={selectedDocType === 'driversLicense' ? '#10b981' : '#a7f3d0'} accessibilityElementsHidden={true} />
              <Text style={[styles.docTypeText, selectedDocType === 'driversLicense' && styles.docTypeTextActive]}>
                Driver
                {"'"}
                s License
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.docTypeButton,
                selectedDocType === 'passport' && styles.docTypeButtonActive,
              ]}
              onPress={() => handleDocTypeSelect('passport')}
              accessibilityRole="radio"
              accessibilityLabel="Passport"
              accessibilityState={{ selected: selectedDocType === 'passport' }}
              accessibilityHint="Select this document type for verification. Only front photo required"
            >
              <MaterialIcons name="flight" size={24} color={selectedDocType === 'passport' ? '#10b981' : '#a7f3d0'} accessibilityElementsHidden={true} />
              <Text style={[styles.docTypeText, selectedDocType === 'passport' && styles.docTypeTextActive]}>
                Passport
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.docTypeButton,
                selectedDocType === 'nationalId' && styles.docTypeButtonActive,
              ]}
              onPress={() => handleDocTypeSelect('nationalId')}
              accessibilityRole="radio"
              accessibilityLabel="National ID"
              accessibilityState={{ selected: selectedDocType === 'nationalId' }}
              accessibilityHint="Select this document type for verification"
            >
              <MaterialIcons name="badge" size={24} color={selectedDocType === 'nationalId' ? '#10b981' : '#a7f3d0'} accessibilityElementsHidden={true} />
              <Text style={[styles.docTypeText, selectedDocType === 'nationalId' && styles.docTypeTextActive]}>
                National ID
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Image Upload */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Upload Photos</Text>

          {/* Front Side */}
          <Text style={styles.uploadLabel}>Front Side</Text>
          <TouchableOpacity
            style={styles.uploadBox}
            onPress={() => pickImage('front')}
            accessibilityRole="button"
            accessibilityLabel={frontImage ? `Front side of ${selectedDocType === 'driversLicense' ? "driver's license" : selectedDocType === 'passport' ? 'passport' : 'national ID'} photo uploaded` : "Upload front side of document"}
            accessibilityHint="Opens camera or photo library to capture front side"
          >
            {frontImage ? (
              <Image source={{ uri: frontImage }} style={styles.uploadedImage} accessibilityLabel={`Front side of ${selectedDocType === 'driversLicense' ? "driver's license" : selectedDocType === 'passport' ? 'passport' : 'national ID'} photo`} />
            ) : (
              <>
                <MaterialIcons name="add-a-photo" size={48} color="#a7f3d0" accessibilityElementsHidden={true} />
                <Text style={styles.uploadText}>Tap to upload</Text>
              </>
            )}
          </TouchableOpacity>

          {/* Back Side (not needed for passport) */}
          {selectedDocType !== 'passport' && (
            <>
              <Text style={[styles.uploadLabel, { marginTop: 16 }]}>Back Side</Text>
              <TouchableOpacity
                style={styles.uploadBox}
                onPress={() => pickImage('back')}
                accessibilityRole="button"
                accessibilityLabel={backImage ? `Back side of ${selectedDocType === 'driversLicense' ? "driver's license" : selectedDocType === 'nationalId' ? 'national ID' : 'document'} photo uploaded` : "Upload back side of document"}
                accessibilityHint="Opens camera or photo library to capture back side"
              >
                {backImage ? (
                  <Image source={{ uri: backImage }} style={styles.uploadedImage} accessibilityLabel={`Back side of ${selectedDocType === 'driversLicense' ? "driver's license" : selectedDocType === 'nationalId' ? 'national ID' : 'document'} photo`} />
                ) : (
                  <>
                    <MaterialIcons name="add-a-photo" size={48} color="#a7f3d0" accessibilityElementsHidden={true} />
                    <Text style={styles.uploadText}>Tap to upload</Text>
                  </>
                )}
              </TouchableOpacity>
            </>
          )}
        </View>

        {/* Privacy Notice */}
        <View style={styles.privacyBox}>
          <MaterialIcons name="lock" size={20} color="#a7f3d0" />
          <View style={styles.privacyContent}>
            <Text style={styles.privacyTitle}>Your Privacy</Text>
            <Text style={styles.privacyText}>
              Your ID is encrypted and securely stored. We only use it for verification purposes and never share it with third parties.
            </Text>
          </View>
        </View>

        {/* Submit Button */}
        <TouchableOpacity
          style={[styles.submitButton, (!canSubmit || isSubmitting) && styles.submitButtonDisabled]}
          onPress={handleSubmit}
          disabled={!canSubmit || isSubmitting}
          accessibilityRole="button"
          accessibilityLabel={isSubmitting ? 'Submitting verification' : 'Submit for verification'}
          accessibilityHint="Submits your ID for review. Typically takes 24-48 hours"
          accessibilityState={{ disabled: !canSubmit || isSubmitting }}
        >
          <Text style={styles.submitButtonText}>
            {isSubmitting ? 'Submitting...' : 'Submit for Verification'}
          </Text>
          {!isSubmitting && <MaterialIcons name="check-circle" size={20} color="#052e1b" accessibilityElementsHidden={true} />}
        </TouchableOpacity>

        {/* Implementation Note (for developers) */}
        <View style={styles.devNote}>
          <MaterialIcons name="code" size={16} color="#f59e0b" />
          <Text style={styles.devNoteText}>
            Note: This is a placeholder UI. Production integration requires implementing with Onfido, Stripe Identity, or similar service.
          </Text>
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
  benefitsCard: {
    backgroundColor: 'rgba(5,46,27,0.5)',
    borderRadius: 16,
    padding: SPACING.CARD_PADDING,
    marginBottom: SPACING.SECTION_GAP,
    borderWidth: 1,
    borderColor: 'rgba(167,243,208,0.2)',
  },
  benefitsTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#a7f3d0',
    marginBottom: SPACING.ELEMENT_GAP,
  },
  benefit: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SPACING.COMPACT_GAP,
  },
  benefitText: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.9)',
    marginLeft: 12,
  },
  section: {
    marginBottom: SPACING.SECTION_GAP,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#a7f3d0',
    marginBottom: SPACING.ELEMENT_GAP,
  },
  docTypeContainer: {
    flexDirection: 'row',
    gap: SPACING.ELEMENT_GAP,
  },
  docTypeButton: {
    flex: 1,
    backgroundColor: 'rgba(5,46,27,0.5)',
    borderRadius: 12,
    padding: SPACING.CARD_PADDING,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'rgba(167,243,208,0.2)',
  },
  docTypeButtonActive: {
    borderColor: '#10b981',
    backgroundColor: 'rgba(16,185,129,0.1)',
  },
  docTypeText: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.7)',
    marginTop: SPACING.COMPACT_GAP,
    textAlign: 'center',
  },
  docTypeTextActive: {
    color: '#10b981',
    fontWeight: '600',
  },
  uploadLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: '#a7f3d0',
    marginBottom: SPACING.COMPACT_GAP,
  },
  uploadBox: {
    backgroundColor: 'rgba(5,46,27,0.5)',
    borderRadius: 12,
    borderWidth: 2,
    borderColor: 'rgba(167,243,208,0.3)',
    borderStyle: 'dashed',
    height: 200,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  uploadText: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.7)',
    marginTop: 8,
  },
  uploadedImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
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
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#a7f3d0',
    paddingVertical: SPACING.CARD_PADDING,
    borderRadius: 999,
    marginBottom: SPACING.SCREEN_HORIZONTAL,
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
  devNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: 'rgba(245,158,11,0.15)',
    borderRadius: 8,
    padding: SPACING.ELEMENT_GAP,
    marginBottom: SPACING.SCREEN_HORIZONTAL,
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.3)',
  },
  devNoteText: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.8)',
    marginLeft: 8,
    flex: 1,
    lineHeight: 18,
  },
});
