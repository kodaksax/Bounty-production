/**
 * Onboarding Index
 * Entry point for onboarding flow
 */

import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useAuthProfile } from '../../hooks/useAuthProfile';
import { useOnboarding } from '../../lib/context/onboarding-context';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../lib/themes/types';

export default function OnboardingIndex() {
  const router = useRouter();
  const { profile, loading } = useAuthProfile();
  const { data: onboardingData, loading: onboardingLoading } = useOnboarding();
  const { theme } = useAppThemeContext();
  const styles = makeStyles(theme);

  useEffect(() => {
    // Wait until auth profile service and the local onboarding-context cache
    // have both resolved their initial state.
    if (loading || onboardingLoading) return;
    checkOnboardingStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, onboardingLoading, profile, onboardingData.intent]);

  const checkOnboardingStatus = async () => {
    // Fully onboarded already — this route should be unreachable in practice
    // (app/index.tsx sends onboarded users straight to /tabs/bounty-app), but
    // guard it directly in case this screen is ever reached via a stale deep
    // link or race between profile/bootstrap state.
    if (profile && profile.username && profile.onboarding_completed === true) {
      router.replace('/tabs/bounty-app');
      return;
    }

    // Already picked poster/hunter earlier (e.g. went to create an account
    // from the sign-in step and landed back here) — resume that flow
    // instead of re-showing the welcome/intent screen.
    if (onboardingData.intent) {
      router.replace('/onboarding/details');
      return;
    }

    // Otherwise this is a genuinely fresh onboarding — start at welcome.
    router.replace('/onboarding/welcome');
  };

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
  });
}
