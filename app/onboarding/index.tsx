/**
 * Onboarding Index
 * Entry point for onboarding flow
 */

import { useRouter } from 'expo-router';
import { useEffect, useRef, useState, useMemo } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAuthContext } from '../../hooks/use-auth-context';
import { useAuthProfile } from '../../hooks/useAuthProfile';
import { useOnboarding } from '../../lib/context/onboarding-context';
import { analyticsService } from '../../lib/services/analytics-service';
import { hasLocalOnboardingFlag } from '../../lib/storage/onboarding';
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
  const { session, isLoading: authLoading } = useAuthContext();
  const { data: onboardingData, loading: onboardingLoading } = useOnboarding();
  const { theme } = useAppThemeContext();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const retryCountRef = useRef(0);
  const [showRetryError, setShowRetryError] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const userId = session?.user?.id ?? null;
  const isAuthenticated = !!userId;

  useEffect(() => {
    // Wait until auth, the auth profile service, and the local
    // onboarding-context cache have all resolved their initial state. Routing
    // before auth settles is what let a signed-in user be treated as a
    // first-time visitor.
    if (authLoading || loading || onboardingLoading) return;
    checkOnboardingStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    authLoading,
    loading,
    onboardingLoading,
    isAuthenticated,
    profile,
    onboardingData.intent,
    profileFetchError,
  ]);

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

      // Same, via the per-user local flag: the Supabase write can fail (bad
      // network on the done step) and leave onboarding_completed false in the
      // DB even though the user genuinely finished. Without this an onboarded
      // user re-entering this route is walked through onboarding again.
      if (isAuthenticated && profile?.username && (await hasLocalOnboardingFlag(userId!))) {
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

      // ── Authenticated, onboarding not finished ────────────────────────────
      // NEVER send a signed-in user to /onboarding/welcome. That screen is the
      // pre-auth entry point: it offers "Log In" and the role CTAs, so landing
      // there after a successful registration reads as "your account wasn't
      // created, sign in again" — the reported beta failure. A signed-in user
      // always resumes at the first post-auth step instead.
      //
      // `intent` (poster/hunter) is deliberately NOT required here: the
      // 'onboarding-skip-role-selection' test arm never sets one (welcome.tsx
      // handleGetStarted), and a draft write can always be lost. Role is
      // optional for the rest of the flow — totalStepsFor(null) in
      // username.tsx already covers the no-intent variant.
      if (isAuthenticated) {
        analyticsService.trackEvent(
          onboardingData.intent ? 'onboarding_resumed' : 'onboarding_started',
          { intent: onboardingData.intent ?? 'none', authenticated: true }
        );
        router.replace('/onboarding/style');
        return;
      }

      // ── Not authenticated ─────────────────────────────────────────────────
      // A role was already picked, so resume at the sign-in/create-account
      // step rather than re-asking for the role.
      if (onboardingData.intent) {
        router.replace('/onboarding/username');
        return;
      }

      // Otherwise this is a genuinely fresh onboarding — start at welcome.
      analyticsService.trackEvent('onboarding_started', { intent: 'none', authenticated: false });
      router.replace('/onboarding/welcome');
    } catch (error) {
      logger.error('[onboarding] checkOnboardingStatus threw', { error });
      // Even the failure path must not eject a signed-in user to the pre-auth
      // welcome screen.
      router.replace(isAuthenticated ? '/onboarding/style' : '/onboarding/welcome');
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
