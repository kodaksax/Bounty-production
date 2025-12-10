/**
 * Phone Onboarding Screen
 * Third step: collect optional phone number (private, never displayed)
 * Enhanced with trust-building messaging to encourage verification
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
import { BrandingLogo } from '../../components/ui/branding-logo';
import { useAuthProfile } from '../../hooks/useAuthProfile';
import { useUserProfile } from '../../hooks/useUserProfile';
import { useOnboarding } from '../../lib/context/onboarding-context';
import { sendPhoneOTP } from '../../lib/services/phone-verification-service';

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
    // If phone is empty, just skip
    if (!phone.trim()) {
      router.push('/onboarding/done');
      return;
    }

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

    // Send OTP for verification
    const otpResult = await sendPhoneOTP(phone.trim());

    if (otpResult.success) {
      setSaving(false);
      // Navigate to verification screen with phone number
      router.push({
        pathname: '/onboarding/verify-phone',
        params: { phone: phone.trim() },
      });
    } else {
      setSaving(false);
      Alert.alert(
        'Unable to Send Code',
        `${otpResult.message}\n\nYou can still continue without verification.`,
        [
          { text: 'Try Again', style: 'cancel' },
          { 
            text: 'Continue Anyway', 
            onPress: () => router.push('/onboarding/done'),
          },
        ]
      );
    }
  };

  const handleSkip = () => {
    router.push('/onboarding/done');
  };

  const handleBack = () => {
    router.back();
  };

  const getButtonText = (): string => {
    if (saving) return 'Saving...';
    if (phone.trim()) return 'Save & Continue';
    return 'Continue';
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
            <BrandingLogo size="small" />
          </View>
          <View style={{ width: 40 }} />
        </View>

        {/* Trust Badge Header */}
        <View style={styles.trustBadgeHeader}>
          <View style={styles.trustBadge}>
            <MaterialIcons name="verified" size={20} color="#10b981" />
            <Text style={styles.trustBadgeText}>Build Your Trust Score</Text>
          </View>
        </View>

        {/* Content */}
        <View style={styles.content}>
          <View style={styles.iconCircle}>
            <MaterialIcons name="phone-android" size={48} color="#a7f3d0" />
          </View>
          <Text style={styles.title}>Verify Your Phone</Text>
          <Text style={styles.subtitle}>
            Verified users get more bounty matches and build trust faster. Your number stays private.
          </Text>
        </View>

        {/* Trust Benefits */}
        <View style={styles.trustBenefits}>
          <View style={styles.trustBenefitItem}>
            <MaterialIcons name="star" size={18} color="#fbbf24" />
            <Text style={styles.trustBenefitText}>Earn a verified badge on your profile</Text>
          </View>
          <View style={styles.trustBenefitItem}>
            <MaterialIcons name="trending-up" size={18} color="#34d399" />
            <Text style={styles.trustBenefitText}>Increase your chances of getting responses on your bounties</Text>
          </View>
          <View style={styles.trustBenefitItem}>
            <MaterialIcons name="shield" size={18} color="#60a5fa" />
            <Text style={styles.trustBenefitText}>Enable two-factor authentication</Text>
          </View>
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

          {/* Info box */}
          <View style={styles.infoBox}>
            <MaterialIcons name="security" size={20} color="#a7f3d0" />
            <Text style={styles.infoText}>
              We use bank-level encryption to protect your data. Your phone number is never displayed to other users.
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
              {getButtonText()}
            </Text>
            <MaterialIcons name="arrow-forward" size={20} color="#052e1b" />
          </TouchableOpacity>

          <TouchableOpacity onPress={handleSkip} style={styles.skipButton}>
            <Text style={styles.skipButtonText}>I'll do this later</Text>
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
  trustBadgeHeader: {
    alignItems: 'center',
    marginBottom: 16,
  },
  trustBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(16,185,129,0.2)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(16,185,129,0.4)',
  },
  trustBadgeText: {
    color: '#10b981',
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 8,
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
    marginBottom: 20,
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
  trustBenefits: {
    backgroundColor: 'rgba(5,46,27,0.5)',
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: 'rgba(167,243,208,0.2)',
    gap: 12,
  },
  trustBenefitItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  trustBenefitText: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 14,
    marginLeft: 12,
    flex: 1,
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
