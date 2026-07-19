/**
 * Onboarding Index
 * Entry point for onboarding flow
 * Checks if carousel was already shown and routes accordingly
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAuthProfile } from '../../hooks/useAuthProfile';
import { logger } from '../../lib/utils/error-logger';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../lib/themes/types';

const ONBOARDING_KEY = '@bounty_onboarding_complete';
// A fetch error alongside an already-verified username means "we couldn't
// confirm current state," not "this is a new user" — retry a bounded number
// of times before falling back to an explicit error instead of silently
// routing an existing user back into username collection. See
// lib/services/auth-profile-service.ts's getLastFetchError() doc comment for
// the 2026-07-19 incident this guards against.
const MAX_FETCH_RETRIES = 2;

export default function OnboardingIndex() {
  const router = useRouter();
  const { profile, loading, profileFetchError, refreshProfile } = useAuthProfile();
  const { theme } = useAppThemeContext();
  const styles = makeStyles(theme);
  const retryCountRef = useRef(0);
  const [showRetryError, setShowRetryError] = useState(false);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    // Wait until auth profile service has resolved initial state
    if (loading) return;
    checkOnboardingStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, profile, profileFetchError]);

  const checkOnboardingStatus = async () => {
    try {
      // A confirmed profile (fetch succeeded) with a username: skip straight
      // past username collection, regardless of any past fetch error.
      if (profile && profile.username) {
        retryCountRef.current = 0;
        setShowRetryError(false);
        router.replace('/onboarding/details');
        return;
      }

      // profile is null/needs_onboarding *and* the last fetch failed: we do
      // not actually know whether this user has a profile — do not treat
      // this the same as a confirmed new user. Retry a bounded number of
      // times, then surface a retry-able error instead of guessing.
      if (profileFetchError) {
        if (retryCountRef.current < MAX_FETCH_RETRIES) {
          retryCountRef.current += 1;
          logger.warning('[onboarding] Profile fetch failed, retrying before routing', {
            attempt: retryCountRef.current,
            error: profileFetchError,
          });
          setRetrying(true);
          await refreshProfile();
          setRetrying(false);
          return; // re-runs via the profile/profileFetchError effect dependency
        }
        logger.error('[onboarding] Profile fetch failed after retries, showing error instead of guessing onboarding state', {
          error: profileFetchError,
        });
        setShowRetryError(true);
        return;
      }

      retryCountRef.current = 0;
      setShowRetryError(false);

      const hasSeenOnboarding = await AsyncStorage.getItem(ONBOARDING_KEY);

      if (hasSeenOnboarding === 'true') {
        // User has seen the carousel before, go directly to username setup
        router.replace('/onboarding/username');
      } else {
        // First time user, show the carousel
        router.replace('/onboarding/carousel');
      }
    } catch (error) {
      console.error('Error checking onboarding status:', error);
      logger.error('[onboarding] checkOnboardingStatus threw', { error });
      // On error, default to showing carousel
      router.replace('/onboarding/carousel');
    }
  };

  const handleManualRetry = async () => {
    retryCountRef.current = 0;
    setShowRetryError(false);
    setRetrying(true);
    await refreshProfile();
    setRetrying(false);
  };

  if (showRetryError) {
    return (
      <View style={[styles.container, styles.errorContainer]}>
        <Text style={styles.errorTitle}>Couldn't verify your account</Text>
        <Text style={styles.errorText}>
          We had trouble loading your profile. Check your connection and try again.
        </Text>
        <TouchableOpacity style={styles.retryButton} onPress={handleManualRetry} disabled={retrying}>
          {retrying ? (
            <ActivityIndicator size="small" color="#052e1b" />
          ) : (
            <Text style={styles.retryButtonText}>Retry</Text>
          )}
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={theme.textSecondary} />
    </View>
  );
}

function makeStyles(theme: AppTheme) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.background,
      justifyContent: 'center',
      alignItems: 'center',
    },
    errorContainer: {
      paddingHorizontal: 32,
    },
    errorTitle: {
      fontSize: 18,
      fontWeight: 'bold',
      color: theme.text,
      marginBottom: 8,
      textAlign: 'center',
    },
    errorText: {
      fontSize: 14,
      color: theme.textSecondary,
      textAlign: 'center',
      marginBottom: 20,
      lineHeight: 20,
    },
    retryButton: {
      backgroundColor: theme.primary,
      paddingVertical: 14,
      paddingHorizontal: 32,
      borderRadius: 999,
      alignSelf: 'center',
    },
    retryButtonText: {
      color: '#052e1b',
      fontSize: 16,
      fontWeight: 'bold',
    },
  });
}
