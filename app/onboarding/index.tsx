/**
 * Onboarding Index
 * Entry point for onboarding flow
 */

import { useRouter } from 'expo-router';
import { useEffect, useRef, useState, useMemo } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAuthProfile } from '../../hooks/useAuthProfile';
import { useOnboarding } from '../../lib/context/onboarding-context';
import { logger } from '../../lib/utils/error-logger';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../lib/themes/types';

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
  const { data: onboardingData, loading: onboardingLoading } = useOnboarding();
  const { theme } = useAppThemeContext();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const retryCountRef = useRef(0);
  const [showRetryError, setShowRetryError] = useState(false);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    // Wait until auth profile service and the local onboarding-context cache
    // have both resolved their initial state.
    if (loading || onboardingLoading) return;
    checkOnboardingStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, onboardingLoading, profile, onboardingData.intent, profileFetchError]);

  const checkOnboardingStatus = async () => {
    try {
      // Fully onboarded already — this route should be unreachable in practice
      // (app/index.tsx sends onboarded users straight to /tabs/bounty-app), but
      // guard it directly in case this screen is ever reached via a stale deep
      // link or race between profile/bootstrap state.
      if (profile && profile.username && profile.onboarding_completed === true) {
        router.replace('/tabs/bounty-app');
        return;
      }

      // profile fetch failed: do not treat as a confirmed "no profile" — retry
      // a bounded number of times, then show a recoverable error.
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

      // Already picked poster/hunter earlier (e.g. went to create an account
      // from the sign-in step and landed back here) — resume that flow
      // instead of re-showing the welcome/intent screen.
      if (onboardingData.intent) {
        router.replace('/onboarding/style');
        return;
      }

      // Otherwise this is a genuinely fresh onboarding — start at welcome.
      router.replace('/onboarding/welcome');
    } catch (error) {
      logger.error('[onboarding] checkOnboardingStatus threw', { error });
      router.replace('/onboarding/welcome');
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
        <Text style={styles.errorTitle}>Couldn&apos;t verify your account</Text>
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
