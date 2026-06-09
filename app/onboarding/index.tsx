/**
 * Onboarding Index
 * Entry point for onboarding flow
 * Checks if carousel was already shown and routes accordingly
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useAuthProfile } from '../../hooks/useAuthProfile';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../lib/themes/types';

const ONBOARDING_KEY = '@bounty_onboarding_complete';

export default function OnboardingIndex() {
  const router = useRouter();
  const { profile, loading } = useAuthProfile();
  const { theme } = useAppThemeContext();
  const styles = makeStyles(theme);

  useEffect(() => {
    // Wait until auth profile service has resolved initial state
    if (loading) return;
    checkOnboardingStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, profile]);

  const checkOnboardingStatus = async () => {
    try {
      // If the authenticated profile already has a username, skip the username step
      if (profile && profile.username) {
        router.replace('/onboarding/details');
        return;
      }

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
      // On error, default to showing carousel
      router.replace('/onboarding/carousel');
    }
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
