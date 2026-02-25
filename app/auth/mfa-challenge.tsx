/**
 * MFA Challenge Screen
 *
 * Shown after successful password sign-in when the user has TOTP 2FA enabled
 * and needs to provide a verification code to reach AAL2 (Assurance Level 2).
 *
 * Uses a proper TextInput instead of Alert.prompt so it works on both iOS and Android.
 */

import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AnimatedScreen } from '../../components/ui/animated-screen';
import { useTwoFactorAuth } from '../../hooks/use-two-factor-auth';
import useScreenBackground from '../../lib/hooks/useScreenBackground';
import { ROUTES } from '../../lib/routes';
import { supabase } from '../../lib/supabase';
import { markInitialNavigationDone } from '../initial-navigation/initialNavigation';

export default function MfaChallengeScreen() {
  useScreenBackground('#097959ff');
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { challengeAndVerify, isLoading: authLoading, isMfaChallengeRequired, isEnrolled } = useTwoFactorAuth();

  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const inputRef = useRef<TextInput>(null);

  // Guard: once the hook finishes loading, redirect away if the challenge is no longer
  // needed (already at AAL2, no enrolled factor, or no active session).
  useEffect(() => {
    if (authLoading) return;

    if (!isMfaChallengeRequired && !isEnrolled) {
      // No session or no factor – redirect to sign-in
      router.replace(ROUTES.AUTH.SIGN_IN);
      try { markInitialNavigationDone(); } catch { /* ignore */ }
      return;
    }

    if (!isMfaChallengeRequired && isEnrolled) {
      // Already satisfied AAL2 – go to app
      router.replace({ pathname: ROUTES.TABS.BOUNTY_APP, params: { screen: 'bounty' } });
      try { markInitialNavigationDone(); } catch { /* ignore */ }
    }
  // Only run when loading state changes to avoid redirect loops
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading]);

  const handleVerify = async () => {
    const trimmed = code.trim();
    if (trimmed.length !== 6 || !/^\d{6}$/.test(trimmed)) {
      setError('Please enter a valid 6-digit code.');
      return;
    }

    setError(null);
    setIsVerifying(true);

    try {
      const result = await challengeAndVerify(trimmed);
      if (!result.success) {
        setError(result.error ?? 'Invalid code. Please try again.');
        setCode('');
        inputRef.current?.focus();
        return;
      }

      // MFA verified — navigate to the main app
      router.replace({ pathname: ROUTES.TABS.BOUNTY_APP, params: { screen: 'bounty' } });
      try { markInitialNavigationDone(); } catch { /* ignore */ }
    } finally {
      setIsVerifying(false);
    }
  };

  const handleCancelSignIn = async () => {
    // Sign out so the existing session is invalidated and cannot be used to bypass MFA.
    try {
      await supabase.auth.signOut();
    } catch {
      // Proceed to sign-in regardless
    }
    router.replace(ROUTES.AUTH.SIGN_IN);
    try { markInitialNavigationDone(); } catch { /* ignore */ }
  };

  const isLoading = authLoading || isVerifying;

  return (
    <AnimatedScreen animationType="fade" duration={300}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <View
          className="flex-1 bg-emerald-700/95 px-6"
          style={{ paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }}
        >
          {/* Cancel sign-in — signs out so the session cannot bypass MFA */}
          <TouchableOpacity
            onPress={handleCancelSignIn}
            className="mb-8 self-start p-2"
            accessibilityLabel="Cancel sign-in"
            accessibilityRole="button"
          >
            <MaterialIcons name="arrow-back" size={24} color="#fff" />
          </TouchableOpacity>

          {/* Icon */}
          <View className="items-center mb-8">
            <View className="bg-emerald-600 rounded-full p-5 mb-4">
              <MaterialIcons name="security" size={40} color="#fff" />
            </View>
            <Text className="text-2xl font-bold text-white text-center">
              Two-Factor Authentication
            </Text>
            <Text className="text-white/70 text-center mt-2 text-sm leading-5">
              Enter the 6-digit code from your authenticator app to continue.
            </Text>
          </View>

          {/* Code input */}
          <View className="mb-4">
            <Text className="text-sm text-white/80 mb-2">Verification Code</Text>
            <TextInput
              ref={inputRef}
              value={code}
              onChangeText={text => {
                setCode(text.replace(/\D/g, '').slice(0, 6));
                if (error) setError(null);
              }}
              placeholder="000000"
              placeholderTextColor="rgba(255,255,255,0.3)"
              keyboardType="number-pad"
              maxLength={6}
              autoFocus
              editable={!isLoading}
              onSubmitEditing={handleVerify}
              className={`w-full bg-white/10 rounded-lg px-4 py-4 text-white text-center text-2xl tracking-widest font-mono ${error ? 'border border-red-400' : ''}`}
              accessibilityLabel="Enter your 2FA verification code"
              accessibilityHint="6-digit code from your authenticator app"
            />
            {error && (
              <Text className="text-xs text-red-400 mt-2 text-center">{error}</Text>
            )}
          </View>

          {/* Verify button */}
          <TouchableOpacity
            onPress={handleVerify}
            disabled={isLoading || code.length !== 6}
            className={`w-full rounded-lg py-4 items-center flex-row justify-center ${
              code.length === 6 && !isLoading ? 'bg-emerald-500' : 'bg-emerald-500/40'
            }`}
            accessibilityRole="button"
            accessibilityLabel="Verify code"
            accessibilityState={{ disabled: isLoading || code.length !== 6 }}
          >
            {isVerifying ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text className="text-white font-semibold text-base">Verify</Text>
            )}
          </TouchableOpacity>

          {/* Help text */}
          <Text className="text-white/50 text-xs text-center mt-6 leading-4">
            Open Google Authenticator, Authy, or another TOTP app to find your code.
            Codes refresh every 30 seconds.
          </Text>
        </View>
      </KeyboardAvoidingView>
    </AnimatedScreen>
  );
}
