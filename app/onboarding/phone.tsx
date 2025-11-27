/**
 * Phone Onboarding Screen
 * Third step: collect optional phone number (private, never displayed)
 * Note: Phone will eventually be mandatory for verification
 */

import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthProfile } from '../../hooks/useAuthProfile';
import { useUserProfile } from '../../hooks/useUserProfile';
import { useOnboarding } from '../../lib/context/onboarding-context';

export default function PhoneScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { updateProfile } = useUserProfile();
  const { updateProfile: updateAuthProfile } = useAuthProfile();
  const { data: onboardingData, updateData: updateOnboardingData } = useOnboarding();
  
  const [phone, setPhone] = useState(onboardingData.phone);
  const [saving, setSaving] = useState(false);

  // Sync from context on mount
  useEffect(() => {
    if (onboardingData.phone && onboardingData.phone !== phone) {
      setPhone(onboardingData.phone);
    }
  }, []);

  // Persist phone to context when it changes
  useEffect(() => {
    updateOnboardingData({ phone });
  }, [phone]);

  const handleNext = async () => {
    setSaving(true);
    
    // Save to local storage
    const result = await updateProfile({
      phone: phone.trim() || undefined,
    });

    if (!result.success) {
      setSaving(false);
      Alert.alert('Error', result.error || 'Failed to save phone number');
      return;
    }

    // Also sync to Supabase via AuthProfileService
    await updateAuthProfile({
      phone: phone.trim() || undefined,
    });

    setSaving(false);
    router.push('/onboarding/done');
  };

  const handleSkip = () => {
    router.push('/onboarding/done');
  };

  const handleBack = () => {
    router.back();
  };

  const formatPhoneDisplay = (text: string) => {
    // Remove all non-digit characters for clean storage
    const digits = text.replace(/\D/g, '');
    setPhone(digits);
  };

  const getDisplayPhone = () => {
    // Format for display only (not stored this way)
    const digits = phone;
    if (digits.length === 0) return '';
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
    if (digits.length <= 10) {
      return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
    }
    return `+${digits.slice(0, digits.length - 10)} (${digits.slice(-10, -7)}) ${digits.slice(-7, -4)}-${digits.slice(-4)}`;
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 100 }]}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header with Back Button and Branding */}
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={handleBack} style={styles.backButton}>
            <MaterialIcons name="arrow-back" size={24} color="#a7f3d0" />
          </TouchableOpacity>
          <View style={styles.brandingHeader}>
            <MaterialIcons name="gps-fixed" size={20} color="#a7f3d0" />
            <Text style={styles.brandingText}>BOUNTY</Text>
          </View>
          <View style={{ width: 40 }} />
        </View>

        {/* Content */}
        <View style={styles.content}>
          <MaterialIcons name="phone" size={56} color="#a7f3d0" />
          <Text style={styles.title}>Add Your Phone</Text>
          <Text style={styles.subtitle}>
            Your phone number is private and used for account verification and important notifications only.
          </Text>
        </View>

        {/* Phone Input */}
        <View style={styles.inputSection}>
          <View style={styles.field}>
            <Text style={styles.label}>Phone Number</Text>
            <TextInput
              style={styles.input}
              value={getDisplayPhone()}
              onChangeText={formatPhoneDisplay}
              placeholder="(555) 123-4567"
              placeholderTextColor="rgba(255,255,255,0.4)"
              keyboardType="phone-pad"
              maxLength={20}
            />
            <View style={styles.privacyNote}>
              <MaterialIcons name="lock" size={16} color="#a7f3d0" />
              <Text style={styles.privacyText}>
                Never shared publicly — only used for verification
              </Text>
            </View>
          </View>

          {/* Future requirement notice */}
          <View style={styles.futureNotice}>
            <MaterialIcons name="info-outline" size={18} color="#fbbf24" />
            <Text style={styles.futureNoticeText}>
              Phone verification will be required in the future to ensure trust and safety on the platform.
            </Text>
          </View>

          {/* Info box */}
          <View style={styles.infoBox}>
            <MaterialIcons name="verified-user" size={20} color="#a7f3d0" />
            <Text style={styles.infoText}>
              Adding your phone helps build trust with other users and enables important security features like two-factor authentication.
            </Text>
          </View>
        </View>

        {/* Action Buttons */}
        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.nextButton}
            onPress={handleNext}
            disabled={saving}
          >
            <Text style={styles.nextButtonText}>
              {saving ? 'Saving...' : phone.trim() ? 'Save & Continue' : 'Continue'}
            </Text>
            <MaterialIcons name="arrow-forward" size={20} color="#052e1b" />
          </TouchableOpacity>

          <TouchableOpacity onPress={handleSkip} style={styles.skipButton}>
            <Text style={styles.skipButtonText}>Skip for now</Text>
          </TouchableOpacity>
        </View>

        {/* Progress indicator */}
        <View style={styles.progressContainer}>
          <View style={styles.progressDot} />
          <View style={styles.progressDot} />
          <View style={[styles.progressDot, styles.progressDotActive]} />
          <View style={styles.progressDot} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#059669',
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
    marginBottom: 16,
  },
  backButton: {
    padding: 8,
  },
  brandingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  brandingText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#ffffff',
    letterSpacing: 2,
    marginLeft: 6,
  },
  content: {
    alignItems: 'center',
    marginBottom: 32,
  },
  title: {
    fontSize: 26,
    fontWeight: 'bold',
    color: '#ffffff',
    marginTop: 16,
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 15,
    color: 'rgba(255,255,255,0.8)',
    textAlign: 'center',
    lineHeight: 22,
    paddingHorizontal: 16,
  },
  inputSection: {
    marginBottom: 24,
  },
  field: {
    marginBottom: 20,
  },
  label: {
    color: '#a7f3d0',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  input: {
    backgroundColor: 'rgba(5,46,27,0.5)',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 18,
    color: '#ffffff',
    borderWidth: 2,
    borderColor: 'rgba(167,243,208,0.3)',
    letterSpacing: 1,
  },
  privacyNote: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    paddingHorizontal: 4,
  },
  privacyText: {
    color: '#a7f3d0',
    fontSize: 13,
    marginLeft: 6,
    flex: 1,
  },
  futureNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: 'rgba(251,191,36,0.15)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(251,191,36,0.3)',
  },
  futureNoticeText: {
    color: '#fef3c7',
    fontSize: 13,
    lineHeight: 18,
    marginLeft: 10,
    flex: 1,
  },
  infoBox: {
    flexDirection: 'row',
    backgroundColor: 'rgba(5,46,27,0.5)',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(167,243,208,0.3)',
  },
  infoText: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 13,
    lineHeight: 20,
    marginLeft: 12,
    flex: 1,
  },
  actions: {
    marginBottom: 24,
  },
  nextButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#a7f3d0',
    paddingVertical: 16,
    borderRadius: 999,
    marginBottom: 12,
    gap: 8,
  },
  nextButtonText: {
    color: '#052e1b',
    fontSize: 18,
    fontWeight: 'bold',
  },
  skipButton: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  skipButtonText: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 16,
  },
  progressContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    paddingTop: 16,
  },
  progressDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  progressDotActive: {
    backgroundColor: '#a7f3d0',
  },
});
