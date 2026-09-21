/**
 * Phone Onboarding Screen
 * Poster branch's last stop before done.tsx (see bounty-posted.tsx's
 * primary CTA) — collects a phone number and hands off to verify-phone.tsx
 * for the OTP. Optional: "I'll do this later" skips straight to done.tsx,
 * same as it always has.
 *
 * Forced dark, like the rest of this onboarding funnel (welcome.tsx,
 * role-select.tsx, details.tsx) — see welcome.tsx's top comment for why.
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
import { useAuthProfile } from '../../hooks/useAuthProfile';
import { useUserProfile } from '../../hooks/useUserProfile';
import { useOnboarding } from '../../lib/context/onboarding-context';
import { sendPhoneOTP } from '../../lib/services/phone-verification-service';
import { darkTheme } from '../../lib/themes/darkTheme';

const theme = darkTheme;

// Adapted from the hunter-facing "Posters pick verified hunters far more
// often" framing — this screen is reached from the poster branch
// (bounty-posted.tsx), so the same trust point is mirrored for that
// audience instead of copied verbatim from a line that only makes sense
// read by a hunter.
const TRUST_ROWS: { icon: 'verified-user' | 'notifications' | 'vpn-key'; title: string; body: string }[] = [
  {
    icon: 'verified-user',
    title: 'Verified badge',
    body: 'Hunters trust verified posters more.',
  },
  {
    icon: 'notifications',
    title: 'Job updates',
    body: 'We text you when something happens on your bounty.',
  },
  {
    icon: 'vpn-key',
    title: 'Account recovery',
    body: 'Get back in if you lose access.',
  },
];

export default function PhoneScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { updateProfile } = useUserProfile();
  const { updateProfile: updateAuthProfile } = useAuthProfile();
  const { data: onboardingData, updateData: updateOnboardingData } = useOnboarding();

  const [phone, setPhone] = useState(onboardingData.phone);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (onboardingData.phone && onboardingData.phone !== phone) {
      setPhone(onboardingData.phone);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    updateOnboardingData({ phone });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phone]);

  const handleNext = async () => {
    if (!phone.trim()) {
      Alert.alert('Phone required', 'Please enter your phone number to continue.');
      return;
    }

    setSaving(true);
    const trimmedPhone = phone.trim();

    const result = await updateProfile({ phone: trimmedPhone || undefined });
    if (!result.success) {
      setSaving(false);
      Alert.alert('Error', result.error || 'Failed to save phone number');
      return;
    }

    await updateAuthProfile({ phone: trimmedPhone || undefined });

    const otpResult = await sendPhoneOTP(trimmedPhone);
    setSaving(false);

    if (otpResult.success) {
      router.push({ pathname: '/onboarding/verify-phone', params: { phone: trimmedPhone } });
    } else {
      Alert.alert(
        'Unable to Send Code',
        `${otpResult.message}\n\nPlease check your number and try again.`,
        [{ text: 'Try Again', style: 'cancel' }]
      );
    }
  };

  const handleSkip = () => router.push('/onboarding/done');

  const handleBack = () => {
    if (router.canGoBack()) router.back();
  };

  const formatPhoneDisplay = (text: string) => {
    const trimmed = text.trimStart();
    const hasLeadingPlus = trimmed.startsWith('+');
    const digits = text.replace(/\D/g, '');
    setPhone(hasLeadingPlus ? `+${digits}` : digits);
  };

  const getDisplayPhone = () => {
    const raw = phone;
    const digits = raw.replace(/\D/g, '');
    if (digits.length === 0) return '';
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 32 }]}
        keyboardShouldPersistTaps="handled"
      >
        {router.canGoBack() && (
          <TouchableOpacity
            onPress={handleBack}
            style={styles.backButton}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <MaterialIcons name="arrow-back" size={24} color={theme.text} />
          </TouchableOpacity>
        )}

        <Text style={styles.heading} accessibilityRole="header">
          Let&apos;s secure your account
        </Text>

        <View style={styles.trustRows}>
          {TRUST_ROWS.map(row => (
            <View key={row.title} style={styles.trustRow}>
              <MaterialIcons name={row.icon} size={20} color={theme.primary} style={styles.trustRowIcon} />
              <View style={styles.trustRowText}>
                <Text style={styles.trustRowTitle}>{row.title}</Text>
                <Text style={styles.trustRowBody}>{row.body}</Text>
              </View>
            </View>
          ))}
        </View>

        <View style={styles.phoneRow}>
          <View style={styles.countryCode}>
            <Text style={styles.countryCodeText}>+1</Text>
          </View>
          <TextInput
            style={styles.phoneInput}
            value={getDisplayPhone()}
            onChangeText={formatPhoneDisplay}
            placeholder="(415) 555-0134"
            placeholderTextColor={theme.textDisabled}
            keyboardType="phone-pad"
            maxLength={14}
            accessibilityLabel="Phone number"
          />
        </View>

        <Text style={styles.finePrint}>
          Phone verification helps us keep fake accounts off Bounty. You can
          also do this later from your profile.
        </Text>

        <View style={styles.spacer} />

        <TouchableOpacity
          style={[styles.primaryButton, { backgroundColor: theme.primary }, saving && styles.buttonDisabled]}
          onPress={handleNext}
          disabled={saving}
          accessibilityRole="button"
          accessibilityLabel="Send verification code"
          accessibilityState={{ disabled: saving, busy: saving }}
        >
          <Text style={styles.primaryButtonText}>{saving ? 'Sending…' : 'Send code'}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={handleSkip}
          style={styles.skipButton}
          accessibilityRole="button"
          accessibilityLabel="Do this later"
        >
          <Text style={styles.skipButtonText}>I&apos;ll do this later</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.background,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
  },
  backButton: {
    alignSelf: 'flex-start',
    padding: 8,
    marginTop: 8,
    marginLeft: -8,
  },
  heading: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '700',
    color: theme.text,
    letterSpacing: -0.5,
    marginTop: 16,
  },
  trustRows: {
    marginTop: 28,
    gap: 20,
  },
  trustRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  trustRowIcon: {
    marginTop: 2,
  },
  trustRowText: {
    flex: 1,
  },
  trustRowTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: theme.text,
  },
  trustRowBody: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
    color: theme.textSecondary,
    marginTop: 2,
  },
  phoneRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 32,
  },
  countryCode: {
    width: 56,
    height: 56,
    borderRadius: theme.radius.xl,
    borderWidth: 1.5,
    borderColor: theme.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countryCodeText: {
    color: theme.text,
    fontSize: 16,
    fontWeight: '600',
  },
  phoneInput: {
    flex: 1,
    height: 56,
    borderRadius: theme.radius.xl,
    borderWidth: 1.5,
    borderColor: theme.border,
    paddingHorizontal: 16,
    fontSize: 16,
    color: theme.text,
  },
  finePrint: {
    fontSize: 13,
    lineHeight: 19,
    color: theme.textSecondary,
    marginTop: 12,
  },
  spacer: {
    flex: 1,
    minHeight: 40,
  },
  primaryButton: {
    height: 56,
    borderRadius: theme.radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  primaryButtonText: {
    color: theme.background,
    fontSize: 18,
    fontWeight: '700',
  },
  skipButton: {
    alignItems: 'center',
    paddingVertical: 16,
  },
  skipButtonText: {
    color: theme.textSecondary,
    fontSize: 16,
    fontWeight: '600',
  },
});
