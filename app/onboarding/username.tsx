/**
 * Onboarding Sign In Screen
 * Second step: real Apple / Google sign-in (via useSocialAuth), plus a
 * "Continue with phone number" path to the real create-account screen.
 * First-time visitors reach this screen unauthenticated, so these need to
 * be real auth actions, not decorative ones.
 */

import { FontAwesome, MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GoogleLogo } from '../../components/ui/google-logo';
import { useAuthContext } from '../../hooks/use-auth-context';
import { useSocialAuth } from '../../hooks/useSocialAuth';
import { hasLocalOnboardingFlag } from '../../lib/storage/onboarding';
import { supabase } from '../../lib/supabase';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../lib/themes/types';

// After a real sign-in, decide whether this is an existing, fully-onboarded
// account (go straight to the app) or a new/incomplete one (continue onboarding).
async function routeAfterSocialSignIn(userId: string, router: ReturnType<typeof useRouter>) {
  try {
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('username, onboarding_completed')
      .eq('id', userId)
      .single();

    if (error) {
      // No profile row (brand new account) or lookup failed — continue onboarding.
      router.push('/onboarding/details');
      return;
    }

    const onboarded =
      profile?.username &&
      (profile.onboarding_completed === true || (await hasLocalOnboardingFlag(userId)));

    if (onboarded) {
      router.replace('/tabs/bounty-app');
    } else {
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

  useEffect(() => {
    if (!googleSessionReady) return;
    (async () => {
      const { data } = await supabase.auth.getSession();
      const userId = data.session?.user?.id;
      if (userId) {
        await routeAfterSocialSignIn(userId, router);
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
    const success = await signInWithApple();
    if (!success) return;

    const { data } = await supabase.auth.getSession();
    const userId = data.session?.user?.id;
    if (userId) {
      await routeAfterSocialSignIn(userId, router);
    } else {
      router.push('/onboarding/details');
    }
  };

  const handleSkip = () => {
    // Already signed in (e.g. reached this screen mid-onboarding) — safe to
    // continue straight through. If not, there's no session yet for the
    // next screen to save data against, so send them to create an account.
    router.push(isLoggedIn ? '/onboarding/details' : '/auth/sign-up-form');
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      {/* ProgreFss dots — step 1 of 3 */}
      <View style={styles.dotsContainer}>
        <View style={[styles.dot, styles.dotActive]} />
        <View style={styles.dot} />
        <View style={styles.dot} />
      </View>

      <Text style={styles.heading}>Sign in - one tap, no password</Text>

      <View style={styles.content} />

      <View style={styles.actionContainer}>
        <TouchableOpacity style={styles.appleButton} onPress={handleAppleContinue} disabled={loading}>
          {loading ? (
            <ActivityIndicator color="#ffffff" style={styles.buttonIcon} />
          ) : (
            <FontAwesome name="apple" size={20} color="#ffffff" style={styles.buttonIcon} />
          )}
          <Text style={styles.appleButtonText}>Continue with Apple</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.googleButton}
          onPress={promptGoogleSignIn}
          disabled={!isGoogleConfigured || !googleRequest || loading}
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

        <TouchableOpacity style={styles.phoneButton} onPress={() => router.push('/auth/sign-up-form')}>
          <MaterialIcons name="phone-iphone" size={20} color={theme.text} style={styles.buttonIcon} />
          <Text style={styles.phoneButtonText}>Continue with phone number</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.skipLink} onPress={handleSkip}>
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
      flexDirection: 'row',
      justifyContent: 'center',
      gap: 8,
      paddingTop: 16,
    },
    dot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: theme.border,
    },
    dotActive: {
      backgroundColor: theme.primary,
    },
    heading: {
      fontSize: 30,
      fontWeight: '600',
      color: theme.text,
      textAlign: 'center',
      marginTop: 24,
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
    phoneButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderColor: theme.border,
      paddingVertical: 16,
      borderRadius: 999,
    },
    phoneButtonText: {
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
