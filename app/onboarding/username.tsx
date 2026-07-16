/**
 * Onboarding Sign In Screen
 * Second step: real Apple / Google sign-in (via useSocialAuth), plus a
 * "Continue with email" path to the real create-account screen.
 * First-time visitors reach this screen unauthenticated, so these need to
 * be real auth actions, not decorative ones.
 */

import { FontAwesome, MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { OnboardingProgressDots } from '../../components/onboarding/OnboardingProgressDots';
import { GoogleLogo } from '../../components/ui/google-logo';
import { useAuthContext } from '../../hooks/use-auth-context';
import { useSocialAuth } from '../../hooks/useSocialAuth';
import { useOnboarding } from '../../lib/context/onboarding-context';
import { hapticFeedback } from '../../lib/haptic-feedback';
import { analyticsService } from '../../lib/services/analytics-service';
import { hasLocalOnboardingFlag } from '../../lib/storage/onboarding';
import { supabase } from '../../lib/supabase';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../lib/themes/types';

// Generic (no intent picked) is a 3-step flow: sign in -> about you -> done.
// Poster/hunter branches are 4 steps: sign in -> details -> confirm -> done.
function totalStepsFor(intent: 'poster' | 'hunter' | null) {
  return intent ? 4 : 3;
}

// After a real sign-in, decide whether this is an existing, fully-onboarded
// account (go straight to the app) or a new/incomplete one (continue onboarding).
async function routeAfterSocialSignIn(
  userId: string,
  router: ReturnType<typeof useRouter>,
  method: 'apple' | 'google'
) {
  try {
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('username, onboarding_completed')
      .eq('id', userId)
      .single();

    if (error) {
      // No profile row (brand new account) or lookup failed — continue onboarding.
      analyticsService.trackEvent('onboarding_auth_completed', { method, outcome: 'new_account' });
      router.push('/onboarding/details');
      return;
    }

    const onboarded =
      profile?.username &&
      (profile.onboarding_completed === true || (await hasLocalOnboardingFlag(userId)));

    if (onboarded) {
      analyticsService.trackEvent('onboarding_auth_completed', { method, outcome: 'existing_onboarded' });
      router.replace('/tabs/bounty-app');
    } else {
      analyticsService.trackEvent('onboarding_auth_completed', { method, outcome: 'existing_incomplete' });
      router.push('/onboarding/details');
    }
  } catch {
    // On any unexpected error, don't block the user — continue onboarding.
    router.push('/onboarding/details');
  }
}

export default function UsernameScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { theme } = useAppThemeContext();
  const { isLoggedIn } = useAuthContext();
  const { data: onboardingData } = useOnboarding();
  const styles = makeStyles(theme);
  const {
    isGoogleConfigured,
    googleRequest,
    promptGoogleSignIn,
    googleSessionReady,
    signInWithApple,
    loading,
    error,
    clearError,
  } = useSocialAuth();

  const totalSteps = totalStepsFor(onboardingData.intent);

  useEffect(() => {
    if (!googleSessionReady) return;
    (async () => {
      const { data } = await supabase.auth.getSession();
      const userId = data.session?.user?.id;
      if (userId) {
        await routeAfterSocialSignIn(userId, router, 'google');
      } else {
        router.push('/onboarding/details');
      }
    })();
  }, [googleSessionReady, router]);

  useEffect(() => {
    if (error) {
      Alert.alert('Sign-in failed', error, [{ text: 'OK', onPress: clearError }]);
    }
  }, [error, clearError]);

  const handleAppleContinue = async () => {
    hapticFeedback.light();
    analyticsService.trackEvent('onboarding_auth_started', { method: 'apple' });
    const success = await signInWithApple();
    if (!success) return;

    const { data } = await supabase.auth.getSession();
    const userId = data.session?.user?.id;
    if (userId) {
      await routeAfterSocialSignIn(userId, router, 'apple');
    } else {
      router.push('/onboarding/details');
    }
  };

  const handleGooglePress = () => {
    hapticFeedback.light();
    analyticsService.trackEvent('onboarding_auth_started', { method: 'google' });
    promptGoogleSignIn();
  };

  const handleContinueWithEmail = () => {
    hapticFeedback.light();
    analyticsService.trackEvent('onboarding_auth_started', { method: 'email' });
    router.push('/auth/sign-up-form');
  };

  const handleSkip = () => {
    analyticsService.trackEvent('onboarding_step_skipped', { step: 'sign_in' });
    // Already signed in (e.g. reached this screen mid-onboarding) — safe to
    // continue straight through. If not, there's no session yet for the
    // next screen to save data against, so send them to create an account.
    router.push(isLoggedIn ? '/onboarding/details' : '/auth/sign-up-form');
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <OnboardingProgressDots total={totalSteps} activeIndex={0} style={styles.dotsContainer} />

      <Text style={styles.heading}>Sign in — one tap, no password</Text>
      <Text style={styles.subheading}>We never post or share anything without asking.</Text>

      <View style={styles.content} />

      <View style={styles.actionContainer}>
        <TouchableOpacity
          style={styles.appleButton}
          onPress={handleAppleContinue}
          disabled={loading}
          accessibilityRole="button"
          accessibilityLabel="Continue with Apple"
          accessibilityState={{ disabled: loading, busy: loading }}
        >
          {loading ? (
            <ActivityIndicator color="#ffffff" style={styles.buttonIcon} />
          ) : (
            <FontAwesome name="apple" size={20} color="#ffffff" style={styles.buttonIcon} />
          )}
          <Text style={styles.appleButtonText}>Continue with Apple</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.googleButton}
          onPress={handleGooglePress}
          disabled={!isGoogleConfigured || !googleRequest || loading}
          accessibilityRole="button"
          accessibilityLabel={isGoogleConfigured ? 'Continue with Google' : 'Google sign-in unavailable'}
          accessibilityState={{ disabled: !isGoogleConfigured || !googleRequest || loading, busy: loading }}
        >
          {loading ? (
            <ActivityIndicator color="#000000" style={styles.buttonIcon} />
          ) : (
            <View style={styles.buttonIcon}>
              <GoogleLogo size={18} />
            </View>
          )}
          <Text style={styles.googleButtonText}>
            {isGoogleConfigured ? 'Continue with Google' : 'Google sign-in unavailable'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.emailButton}
          onPress={handleContinueWithEmail}
          accessibilityRole="button"
          accessibilityLabel="Continue with email"
        >
          <MaterialIcons name="alternate-email" size={20} color={theme.text} style={styles.buttonIcon} />
          <Text style={styles.emailButtonText}>Continue with email</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.skipLink}
          onPress={handleSkip}
          accessibilityRole="button"
          accessibilityLabel="Skip for now"
        >
          <Text style={styles.skipLinkText}>Skip for now</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function makeStyles(theme: AppTheme) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.background,
      paddingHorizontal: 24,
    },
    dotsContainer: {
      paddingTop: 16,
    },
    heading: {
      fontSize: 30,
      fontWeight: '600',
      color: theme.text,
      textAlign: 'center',
      marginTop: 24,
    },
    subheading: {
      fontSize: 15,
      color: theme.textSecondary,
      textAlign: 'center',
      marginTop: 8,
    },
    content: {
      flex: 1,
    },
    actionContainer: {
      paddingBottom: 40,
      gap: 12,
    },
    appleButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: '#000000',
      paddingVertical: 16,
      borderRadius: 999,
    },
    appleButtonText: {
      color: '#ffffff',
      fontSize: 18,
      fontWeight: 'bold',
    },
    googleButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: '#ffffff',
      borderWidth: 2,
      borderColor: '#000000',
      paddingVertical: 16,
      borderRadius: 999,
    },
    googleButtonText: {
      color: '#000000',
      fontSize: 18,
      fontWeight: 'bold',
    },
    emailButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderColor: theme.border,
      paddingVertical: 16,
      borderRadius: 999,
    },
    emailButtonText: {
      color: theme.text,
      fontSize: 18,
      fontWeight: 'bold',
    },
    buttonIcon: {
      marginRight: 8,
    },
    skipLink: {
      alignItems: 'center',
      paddingVertical: 12,
    },
    skipLinkText: {
      fontSize: 15,
      color: theme.textDisabled,
      textDecorationLine: 'underline',
    },
  });
}
