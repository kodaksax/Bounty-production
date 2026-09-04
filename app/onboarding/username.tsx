/**
 * Onboarding Sign In Screen
 * Second step: real Apple / Google sign-in (via useSocialAuth), plus a
 * "Continue with email" path to the real create-account screen.
 * First-time visitors reach this screen unauthenticated, so these need to
 * be real auth actions, not decorative ones.
 */

import { FontAwesome, MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useMemo } from 'react';
import { ActivityIndicator, Alert, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { OnboardingProgressDots } from '../../components/onboarding/OnboardingProgressDots';
import { SkipAuthLink } from '../../components/onboarding/SkipAuthLink';
import { GoogleLogo } from '../../components/ui/google-logo';
import { useAuthContext } from '../../hooks/use-auth-context';
import { useSocialAuth } from '../../hooks/useSocialAuth';
import { useOnboarding } from '../../lib/context/onboarding-context';
import { ONBOARDING_SKIP_AUTH_ENABLED } from '../../lib/feature-flags';
import { hapticFeedback } from '../../lib/haptic-feedback';
import { analyticsService } from '../../lib/services/analytics-service';
import { hasLocalOnboardingFlag } from '../../lib/storage/onboarding';
import { supabase } from '../../lib/supabase';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../lib/themes/types';

// Generic (no intent picked) is a 4-step flow: sign in -> style -> about you
// -> done. Poster/hunter branches are 5 steps: sign in -> style -> details ->
// confirm -> done.
function totalStepsFor(intent: 'poster' | 'hunter' | null) {
  return intent ? 5 : 4;
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
      router.push('/onboarding/style');
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
      router.push('/onboarding/style');
    }
  } catch {
    // On any unexpected error, don't block the user — continue onboarding.
    router.push('/onboarding/style');
  }
}

export default function UsernameScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { theme } = useAppThemeContext();
  const { isLoggedIn } = useAuthContext();
  const { data: onboardingData } = useOnboarding();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const {
    isAppleAvailable,
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

  // Visitors who picked a role on the welcome screen land here without knowing
  // why sign-in is required or what happens after it — the biggest drop-off in
  // the funnel. One intent-aware line confirms their choice, says what signing
  // in unlocks, and previews the remaining step.
  const nextUpMessage = useMemo(() => {
    switch (onboardingData.intent) {
      case 'poster':
        return 'Sign in to post your bounty — then a quick style pick and you’re in.';
      case 'hunter':
        return 'Sign in to claim bounties and get paid — then a quick style pick and you’re in.';
      default:
        return 'Sign in to post or claim bounties — then a quick style pick and you’re in.';
    }
  }, [onboardingData.intent]);

  useEffect(() => {
    analyticsService.trackEvent('onboarding_signin_context_shown', {
      intent: onboardingData.intent ?? 'none',
    });
  }, [onboardingData.intent]);

  useEffect(() => {
    if (!googleSessionReady) return;
    (async () => {
      const { data } = await supabase.auth.getSession();
      const userId = data.session?.user?.id;
      if (userId) {
        await routeAfterSocialSignIn(userId, router, 'google');
      } else {
        router.push('/onboarding/style');
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
      router.push('/onboarding/style');
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
    router.push(isLoggedIn ? '/onboarding/style' : '/auth/sign-up-form');
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <OnboardingProgressDots total={totalSteps} activeIndex={0} style={styles.dotsContainer} />

      <Text style={styles.heading}>Sign in in seconds</Text>
      <Text style={styles.subheading}>
        Use Apple or Google for one-tap, password-free sign-in — or continue with email. We never post
        or share anything without asking.
      </Text>

      <View style={styles.nextUpCard}>
        <MaterialIcons name="lock-open" size={16} color={theme.textSecondary} />
        <Text style={styles.nextUpText}>{nextUpMessage}</Text>
      </View>

      <View style={styles.content} />

      <View style={styles.actionContainer}>
        {/* Apple sign-in is iOS-only. On Android the native module is absent and
            the button failed with ERR_UNAVAILABLE, so hide it there (see #727). */}
        {Platform.OS === 'ios' && (
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
        )}

        {/* Only render Google when it's actually configured for this build.
            An unconfigured button is inert and, on web, exposes no
            disabled/aria-disabled — assistive tech reads it as actionable. */}
        {isGoogleConfigured && (
          <TouchableOpacity
            style={styles.googleButton}
            onPress={handleGooglePress}
            disabled={!googleRequest || loading}
            accessibilityRole="button"
            accessibilityLabel="Continue with Google"
            accessibilityState={{ disabled: !googleRequest || loading, busy: loading }}
          >
            {loading ? (
              <ActivityIndicator color="#000000" style={styles.buttonIcon} />
            ) : (
              <View style={styles.buttonIcon}>
                <GoogleLogo size={18} />
              </View>
            )}
            <Text style={styles.googleButtonText}>Continue with Google</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={styles.emailButton}
          onPress={handleContinueWithEmail}
          accessibilityRole="button"
          accessibilityLabel="Continue with email"
        >
          <MaterialIcons name="alternate-email" size={20} color={theme.text} style={styles.buttonIcon} />
          <Text style={styles.emailButtonText}>Continue with email</Text>
        </TouchableOpacity>

        {ONBOARDING_SKIP_AUTH_ENABLED && <SkipAuthLink onPress={handleSkip} />}
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
    nextUpCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginTop: 20,
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: 12,
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderColor: theme.border,
    },
    nextUpText: {
      flex: 1,
      fontSize: 13,
      lineHeight: 18,
      color: theme.textSecondary,
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
  });
}
