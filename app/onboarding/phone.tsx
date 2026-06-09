/**
 * Phone Onboarding Screen
 * Third step: collect phone number (required for verification)
 * Enhanced with trust-building messaging to encourage verification
 */

import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
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
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../lib/themes/types';

export default function PhoneScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { updateProfile } = useUserProfile();
  const { updateProfile: updateAuthProfile } = useAuthProfile();
  const { data: onboardingData, updateData: updateOnboardingData } = useOnboarding();

  const { theme } = useAppThemeContext();
  const styles = makeStyles(theme);
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
    // Phone is required — prompt if empty
    if (!phone.trim()) {
      Alert.alert('Phone required', 'Please enter your phone number to continue.');
      return;
    }

    setSaving(true);

    // Trim phone once for consistency
    const trimmedPhone = phone.trim();

    // Save to local storage
    const result = await updateProfile({
      phone: trimmedPhone || undefined,
    });

    if (!result.success) {
      setSaving(false);
      Alert.alert('Error', result.error || 'Failed to save phone number');
      return;
    }

    // Also sync to Supabase via AuthProfileService
    await updateAuthProfile({
      phone: trimmedPhone || undefined,
    });

    // Send OTP for verification
    const otpResult = await sendPhoneOTP(trimmedPhone);

    if (otpResult.success) {
      setSaving(false);
      // Navigate to verification screen with phone number
      router.push({
        pathname: '/onboarding/verify-phone',
        params: { phone: trimmedPhone },
      });
    } else {
      setSaving(false);
      Alert.alert(
        'Unable to Send Code',
        `${otpResult.message}\n\nPlease check your number and try again.`,
        [
          { text: 'Try Again', style: 'cancel' },
        ]
      );
    }
  };

  const handleSkip = () => router.push('/onboarding/identity-verification');

  const handleBack = () => {
    router.back();
  };

  const getButtonText = (): string => {
    if (saving) return 'Saving...';
    return 'Save & Continue';
  };

  const formatPhoneDisplay = (text: string) => {
    // Preserve leading + for international numbers, remove other non-digit chars
    const trimmed = text.trimStart();
    const hasLeadingPlus = trimmed.startsWith('+');
    const digits = text.replace(/\D/g, '');
    setPhone(hasLeadingPlus ? `+${digits}` : digits);
  };

  const getDisplayPhone = () => {
    // Format for display only (not stored this way)
    const raw = phone;
    const hasPlus = raw.startsWith('+');
    const digits = raw.replace(/\D/g, '');
    if (digits.length === 0) return hasPlus ? '+' : '';
    // US-style formatting for local numbers without +
    if (!hasPlus && digits.length <= 3) return digits;
    if (!hasPlus && digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
    if (!hasPlus && digits.length <= 10) {
      return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
    }
    // International or long number with country code
    if (digits.length > 10) {
      return `+${digits.slice(0, digits.length - 10)} (${digits.slice(-10, -7)}) ${digits.slice(-7, -4)}-${digits.slice(-4)}`;
    }
    // 10-digit number (with or without +)
    if (hasPlus) return `+${digits}`;
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
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
            <MaterialIcons name="arrow-back" size={24} color="#9CA3AF" />
          </TouchableOpacity>
          <View style={styles.brandingHeader}>
            <BrandingLogo size="small" />
          </View>
          <View style={{ width: 40 }} />
        </View>

        {/* Trust Badge Header */}
        <View style={styles.trustBadgeHeader}>
          <View style={styles.trustBadge}>
            <MaterialIcons name="verified" size={20} color="#059669" />
            <Text style={styles.trustBadgeText}>Build Your Trust Score</Text>
          </View>
        </View>

        {/* Content */}
        <View style={styles.content}>
          <View style={styles.iconCircle}>
            <MaterialIcons name="phone-android" size={48} color="#9CA3AF" />
          </View>
          <Text style={styles.title}>Verify Your Phone</Text>
          <Text style={styles.subtitle}>
            Verified users get more bounty matches and build trust faster. Your number stays private. You can also skip this step and verify later.
          </Text>
        </View>

        {/* Trust Benefits */}
        <View style={styles.trustBenefits}>
          <View style={styles.trustBenefitItem}>
            <MaterialIcons name="star" size={18} color="#fbbf24" />
            <Text style={styles.trustBenefitText}>Earn a verified badge on your profile</Text>
          </View>
          <View style={styles.trustBenefitItem}>
            <MaterialIcons name="trending-up" size={18} color="#059669" />
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
              <MaterialIcons name="lock" size={16} color="#9CA3AF" />
              <Text style={styles.privacyText}>
                Never shared publicly — only used for verification
              </Text>
            </View>
          </View>

          {/* Info box */}
          <View style={styles.infoBox}>
            <MaterialIcons name="security" size={20} color="#9CA3AF" />
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
            <Text style={styles.skipButtonText}>
              Skip for now
            </Text>
          </TouchableOpacity>
        </View>

        {/* Progress indicator — step 3 of 5 */}
        <View style={styles.progressContainer}>
          <View style={styles.progressDot} />
          <View style={styles.progressDot} />
          <View style={[styles.progressDot, styles.progressDotActive]} />
          <View style={styles.progressDot} />
          <View style={styles.progressDot} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
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
      color: theme.text,
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
      backgroundColor: theme.surface,
      paddingHorizontal: 16,
      paddingVertical: 8,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: theme.border,
    },
    trustBadgeText: {
      color: '#059669',
      fontSize: 14,
      fontWeight: '600',
      marginLeft: 8,
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
    content: {
      alignItems: 'center',
      marginBottom: 20,
    },
    title: {
      fontSize: 26,
      fontWeight: 'bold',
      color: theme.text,
      marginTop: 16,
      marginBottom: 8,
      textAlign: 'center',
    },
    subtitle: {
      fontSize: 15,
      color: theme.textSecondary,
      textAlign: 'center',
      lineHeight: 22,
      paddingHorizontal: 16,
    },
    trustBenefits: {
      backgroundColor: theme.surface,
      borderRadius: 16,
      padding: 16,
      marginBottom: 24,
      borderWidth: 1,
      borderColor: theme.border,
      gap: 12,
    },
    trustBenefitItem: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    trustBenefitText: {
      color: theme.text,
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
      color: theme.textSecondary,
      fontSize: 14,
      fontWeight: '600',
      marginBottom: 8,
    },
    input: {
      backgroundColor: theme.surface,
      borderRadius: 12,
      paddingHorizontal: 16,
      paddingVertical: 14,
      fontSize: 18,
      color: theme.text,
      borderWidth: 2,
      borderColor: theme.border,
      letterSpacing: 1,
    },
    privacyNote: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: 8,
      paddingHorizontal: 4,
    },
    privacyText: {
      color: theme.textSecondary,
      fontSize: 13,
      marginLeft: 6,
      flex: 1,
    },
    infoBox: {
      flexDirection: 'row',
      backgroundColor: theme.surface,
      borderRadius: 12,
      padding: 16,
      borderWidth: 1,
      borderColor: theme.border,
    },
    infoText: {
      color: theme.textSecondary,
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
      backgroundColor: theme.primary,
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
      color: theme.textSecondary,
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
      backgroundColor: theme.border,
    },
    progressDotActive: {
      backgroundColor: theme.primary,
    },
  });
}
