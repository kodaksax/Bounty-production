/**
 * Phone Verification Screen
 * Second half of the poster branch's phone-verification step — see
 * phone.tsx's top comment. Forced dark for the same reason.
 */

import { MaterialIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
import { sendPhoneOTP, verifyPhoneOTP } from '../../lib/services/phone-verification-service';
import { darkTheme } from '../../lib/themes/darkTheme';

const theme = darkTheme;
const OTP_LENGTH = 6;

export default function VerifyPhoneScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();
  const phoneNumber = (params.phone as string) || '';

  const [otp, setOtp] = useState<string[]>(Array(OTP_LENGTH).fill(''));
  const [isVerifying, setIsVerifying] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(60);
  const [error, setError] = useState<string | null>(null);
  const [verified, setVerified] = useState(false);

  const inputRefs = useRef<(TextInput | null)[]>([]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown(prev => Math.max(0, prev - 1)), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  const handleVerify = async (code?: string) => {
    const otpCode = code || otp.join('');
    if (otpCode.length !== OTP_LENGTH) {
      setError('Please enter all 6 digits');
      return;
    }

    setIsVerifying(true);
    setError(null);

    const result = await verifyPhoneOTP(phoneNumber, otpCode);
    setIsVerifying(false);

    if (result.success) {
      setVerified(true);
      setTimeout(() => router.push('/onboarding/done'), 700);
    } else {
      setError(result.message);
      setOtp(Array(OTP_LENGTH).fill(''));
      inputRefs.current[0]?.focus();
    }
  };

  const handleOtpChange = (value: string, index: number) => {
    if (value && !/^\d$/.test(value)) return;

    const newOtp = [...otp];
    newOtp[index] = value;
    setOtp(newOtp);
    setError(null);

    if (value && index < OTP_LENGTH - 1) {
      inputRefs.current[index + 1]?.focus();
    }
    if (newOtp.every(digit => digit !== '') && value) {
      handleVerify(newOtp.join(''));
    }
  };

  const handleKeyPress = (e: any, index: number) => {
    if (e.nativeEvent.key === 'Backspace' && !otp[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handleResend = async () => {
    if (resendCooldown > 0 || isResending) return;
    setIsResending(true);
    setError(null);

    const result = await sendPhoneOTP(phoneNumber);
    setIsResending(false);

    if (result.success) {
      setResendCooldown(60);
    } else {
      setError(result.message);
    }
  };

  const handleBack = () => {
    if (router.canGoBack()) router.back();
  };

  const formatPhoneDisplay = (phone: string) => {
    if (!phone) return '';
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 7) return phone;
    // 10 digits (no country code) or 11 with a leading US/Canada "1" both
    // format as +1 (XXX) XXX-XXXX — the common case for this app's default
    // formatToE164 (phone-verification-service.ts assumes +1 with no +).
    const tenDigit = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
    if (tenDigit.length === 10) {
      return `+1 (${tenDigit.slice(0, 3)}) ${tenDigit.slice(3, 6)}-${tenDigit.slice(6)}`;
    }
    // Other international numbers: show the country code plus last 4 digits.
    return `+${digits.slice(0, digits.length - 4)} ${digits.slice(-4)}`;
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

        {verified ? (
          <View style={styles.verifiedWrap}>
            <View style={styles.verifiedCircle}>
              <MaterialIcons name="check" size={40} color={theme.primaryLight} />
            </View>
            <Text style={styles.heading}>Verified</Text>
          </View>
        ) : (
          <>
            <Text style={styles.heading} accessibilityRole="header">
              Enter the code
            </Text>
            <Text style={styles.subheading}>
              Sent to [{formatPhoneDisplay(phoneNumber)}].
            </Text>

            <View style={styles.otpRow}>
              {otp.map((digit, index) => (
                <TextInput
                  key={index}
                  ref={ref => {
                    inputRefs.current[index] = ref;
                  }}
                  style={[
                    styles.otpBox,
                    digit ? styles.otpBoxFilled : null,
                    error ? styles.otpBoxError : null,
                  ]}
                  value={digit}
                  onChangeText={value => handleOtpChange(value, index)}
                  onKeyPress={e => handleKeyPress(e, index)}
                  {...(Platform.OS === 'web'
                    ? ({ onKeyDown: (e: any) => handleKeyPress({ nativeEvent: { key: e.key } }, index) } as any)
                    : {})}
                  keyboardType="number-pad"
                  maxLength={1}
                  selectTextOnFocus
                  autoFocus={index === 0}
                  accessibilityLabel={`Digit ${index + 1} of ${OTP_LENGTH}`}
                />
              ))}
            </View>

            {error ? <Text style={styles.errorText}>{error}</Text> : null}

            <View style={styles.resendRow}>
              {resendCooldown > 0 ? (
                <Text style={styles.resendCooldown}>Resend in {`0:${resendCooldown.toString().padStart(2, '0')}`}</Text>
              ) : (
                <TouchableOpacity
                  onPress={handleResend}
                  disabled={isResending}
                  accessibilityRole="button"
                  accessibilityLabel="Resend code"
                >
                  {isResending ? (
                    <ActivityIndicator size="small" color={theme.primary} />
                  ) : (
                    <Text style={styles.resendText}>Resend code</Text>
                  )}
                </TouchableOpacity>
              )}
            </View>

            <View style={styles.spacer} />

            <TouchableOpacity
              style={[
                styles.verifyButton,
                { backgroundColor: theme.primary },
                (isVerifying || otp.some(d => !d)) && styles.buttonDisabled,
              ]}
              onPress={() => handleVerify()}
              disabled={isVerifying || otp.some(d => !d)}
              accessibilityRole="button"
              accessibilityLabel="Verify"
              accessibilityState={{ disabled: isVerifying || otp.some(d => !d), busy: isVerifying }}
            >
              {isVerifying ? (
                <ActivityIndicator color={theme.background} />
              ) : (
                <Text style={styles.verifyButtonText}>Verify</Text>
              )}
            </TouchableOpacity>
          </>
        )}
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
  subheading: {
    fontSize: 15,
    color: theme.textSecondary,
    marginTop: 8,
  },
  otpRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 32,
  },
  otpBox: {
    flex: 1,
    height: 56,
    borderRadius: theme.radius.lg,
    borderWidth: 1.5,
    borderColor: theme.border,
    fontSize: 22,
    fontWeight: '700',
    color: theme.text,
    textAlign: 'center',
  },
  otpBoxFilled: {
    borderColor: theme.primary,
    backgroundColor: theme.surface,
  },
  otpBoxError: {
    borderColor: theme.error,
  },
  errorText: {
    color: theme.error,
    fontSize: 13,
    fontWeight: '500',
    marginTop: 12,
  },
  resendRow: {
    marginTop: 16,
  },
  resendCooldown: {
    color: theme.textSecondary,
    fontSize: 14,
  },
  resendText: {
    color: theme.primary,
    fontSize: 14,
    fontWeight: '600',
  },
  spacer: {
    flex: 1,
    minHeight: 40,
  },
  verifyButton: {
    height: 56,
    borderRadius: theme.radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  verifyButtonText: {
    color: theme.background,
    fontSize: 18,
    fontWeight: '700',
  },
  verifiedWrap: {
    alignItems: 'center',
    marginTop: 80,
  },
  verifiedCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 1.5,
    borderColor: theme.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
});
