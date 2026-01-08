/**
 * Phone Verification Screen
 * Allows users to verify their phone number with OTP
 */

import { MaterialIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
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
import { sendPhoneOTP, verifyPhoneOTP } from '../../lib/services/phone-verification-service';

export default function VerifyPhoneScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();
  
  // Phone number passed from previous screen
  const phoneNumber = (params.phone as string) || '';
  
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const inputRefs = useRef<(TextInput | null)[]>([]);

  // Handle resend cooldown
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    
    if (resendCooldown > 0) {
      timer = setTimeout(() => {
        setResendCooldown(prev => Math.max(0, prev - 1));
      }, 1000);
    }
    
    return () => {
      if (timer) {
        clearTimeout(timer as any);
      }
    };
  }, [resendCooldown]);

  const handleOtpChange = (value: string, index: number) => {
    // Only allow digits
    if (value && !/^\d$/.test(value)) return;

    const newOtp = [...otp];
    newOtp[index] = value;
    setOtp(newOtp);
    setError(null);

    // Auto-focus next input
    if (value && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }

    // Auto-verify when all digits entered
    if (newOtp.every(digit => digit !== '') && value) {
      handleVerify(newOtp.join(''));
    }
  };

  const handleKeyPress = (e: any, index: number) => {
    // Handle backspace
    if (e.nativeEvent.key === 'Backspace' && !otp[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handleVerify = async (code?: string) => {
    const otpCode = code || otp.join('');
    
    if (otpCode.length !== 6) {
      setError('Please enter all 6 digits');
      return;
    }

    setIsVerifying(true);
    setError(null);

    const result = await verifyPhoneOTP(phoneNumber, otpCode);
    setIsVerifying(false);

    if (result.success) {
      Alert.alert(
        'Success',
        'Your phone number has been verified!',
        [
          {
            text: 'Continue',
            onPress: () => router.push('/onboarding/done'),
          },
        ]
      );
    } else {
      setError(result.message);
      // Clear OTP on error
      setOtp(['', '', '', '', '', '']);
      inputRefs.current[0]?.focus();
    }
  };

  const handleResend = async () => {
    if (resendCooldown > 0 || isResending) return;

    setIsResending(true);
    setError(null);

    const result = await sendPhoneOTP(phoneNumber);
    setIsResending(false);

    if (result.success) {
      setResendCooldown(60); // 60 second cooldown
      Alert.alert('Code Sent', 'A new verification code has been sent to your phone');
    } else {
      setError(result.message);
    }
  };

  const handleBack = () => {
    router.back();
  };

  const handleSkip = () => {
    Alert.alert(
      'Skip Verification?',
      'You can verify your phone number later from settings. Phone verification helps build trust with other users.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Skip for Now',
          onPress: () => router.push('/onboarding/done'),
        },
      ]
    );
  };

  const formatPhoneDisplay = (phone: string) => {
    if (!phone) return 'Invalid number';
    
    const hasPlus = phone.trim().startsWith('+');
    const digits = phone.replace(/\D/g, '');
    
    if (digits.length < 7) {
      return 'Invalid number';
    }
    
    // Show last 4 digits, mask the rest for security
    const visibleDigits = digits.slice(-4);
    const maskedLength = digits.length - visibleDigits.length;
    
    // For US numbers (10 digits without country code)
    if (!hasPlus && digits.length === 10) {
      return `(***) ***-${visibleDigits}`;
    }
    
    // For international numbers
    if (hasPlus && digits.length > 10) {
      const countryCode = digits.slice(0, digits.length - 10);
      return `+${countryCode} (***) ***-${visibleDigits}`;
    }
    
    // Default: mask all but last 4 digits
    const masked = '*'.repeat(Math.max(0, maskedLength));
    return masked + visibleDigits;
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
        {/* Header */}
        <View style={styles.headerRow}>
          <TouchableOpacity accessibilityRole="button" onPress={handleBack} style={styles.backButton}>
            <MaterialIcons name="arrow-back" size={24} color="#a7f3d0" />
          </TouchableOpacity>
          <View style={styles.brandingHeader}>
            <BrandingLogo size="small" />
          </View>
          <View style={{ width: 40 }} />
        </View>

        {/* Content */}
        <View style={styles.content}>
          <View style={styles.iconCircle}>
            <MaterialIcons name="sms" size={48} color="#a7f3d0" />
          </View>
          <Text style={styles.title}>Enter Verification Code</Text>
          <Text style={styles.subtitle}>
            We sent a 6-digit code to{'\n'}
            <Text style={styles.phoneNumber}>{formatPhoneDisplay(phoneNumber)}</Text>
          </Text>
        </View>

        {/* OTP Input */}
        <View style={styles.otpContainer}>
          {otp.map((digit, index) => (
            <TextInput accessibilityLabel="Text input field"
              key={index}
              ref={(ref) => { inputRefs.current[index] = ref; }}
              style={[
                styles.otpInput,
                digit ? styles.otpInputFilled : null,
                error ? styles.otpInputError : null,
              ]}
              value={digit}
              onChangeText={(value) => handleOtpChange(value, index)}
              onKeyPress={(e) => handleKeyPress(e, index)}
              keyboardType="number-pad"
              maxLength={1}
              selectTextOnFocus
              autoFocus={index === 0}
            />
          ))}
        </View>

        {/* Error Message */}
        {error && (
          <View style={styles.errorContainer}>
            <MaterialIcons name="error-outline" size={16} color="#ef4444" />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {/* Verify Button */}
        <TouchableOpacity accessibilityRole="button"
          style={[styles.verifyButton, isVerifying && styles.buttonDisabled]}
          onPress={() => handleVerify()}
          disabled={isVerifying || otp.some(d => !d)}
        >
          {isVerifying ? (
            <ActivityIndicator color="#052e1b" />
          ) : (
            <>
              <Text style={styles.verifyButtonText}>Verify Phone</Text>
              <MaterialIcons name="check-circle" size={20} color="#052e1b" />
            </>
          )}
        </TouchableOpacity>

        {/* Resend Code */}
        <View style={styles.resendContainer}>
          <Text style={styles.resendLabel}>Didn't receive the code?</Text>
          {resendCooldown > 0 ? (
            <Text style={styles.resendCooldown}>
              Resend in {resendCooldown}s
            </Text>
          ) : (
            <TouchableOpacity accessibilityRole="button"
              onPress={handleResend}
              disabled={isResending}
              style={styles.resendButton}
            >
              {isResending ? (
                <ActivityIndicator size="small" color="#f59e0b" />
              ) : (
                <Text style={styles.resendText}>Resend Code</Text>
              )}
            </TouchableOpacity>
          )}
        </View>

        {/* Skip Button */}
        <TouchableOpacity accessibilityRole="button"
          style={styles.skipButton}
          onPress={handleSkip}
        >
          <Text style={styles.skipButtonText}>Skip for Now</Text>
        </TouchableOpacity>

        {/* Info Box */}
        <View style={styles.infoBox}>
          <MaterialIcons name="info-outline" size={18} color="#a7f3d0" />
          <Text style={styles.infoText}>
            Phone verification is optional but recommended. It helps build trust with other users and can be completed later from settings.
          </Text>
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
  },
  phoneNumber: {
    fontWeight: '600',
    color: '#a7f3d0',
  },
  otpContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 16,
  },
  otpInput: {
    width: 48,
    height: 56,
    borderRadius: 12,
    backgroundColor: 'rgba(5,46,27,0.5)',
    borderWidth: 2,
    borderColor: 'rgba(167,243,208,0.3)',
    fontSize: 24,
    fontWeight: 'bold',
    color: '#ffffff',
    textAlign: 'center',
  },
  otpInputFilled: {
    borderColor: '#a7f3d0',
    backgroundColor: 'rgba(167,243,208,0.1)',
  },
  otpInputError: {
    borderColor: '#ef4444',
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    gap: 6,
  },
  errorText: {
    color: '#ef4444',
    fontSize: 14,
    fontWeight: '500',
  },
  verifyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#a7f3d0',
    paddingVertical: 16,
    borderRadius: 999,
    marginBottom: 16,
    gap: 8,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  verifyButtonText: {
    color: '#052e1b',
    fontSize: 18,
    fontWeight: 'bold',
  },
  resendContainer: {
    alignItems: 'center',
    marginBottom: 24,
  },
  resendLabel: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 14,
    marginBottom: 8,
  },
  resendButton: {
    paddingVertical: 4,
  },
  resendText: {
    color: '#f59e0b',
    fontSize: 14,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  resendCooldown: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 14,
  },
  skipButton: {
    alignItems: 'center',
    paddingVertical: 12,
    marginBottom: 16,
  },
  skipButtonText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 15,
    textDecorationLine: 'underline',
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
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
});
