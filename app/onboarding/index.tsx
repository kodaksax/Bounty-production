/**
 * Onboarding Index
 * Entry point for onboarding flow
 * Checks if carousel was already shown and routes accordingly
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

const ONBOARDING_KEY = '@bounty_onboarding_complete';
const ONBOARDING_DONE_KEY = '@bounty_onboarding_completed';

export default function OnboardingIndex() {
  const router = useRouter();

  useEffect(() => {
    checkOnboardingStatus();
  }, []);

  const checkOnboardingStatus = async () => {
    try {
      // If the user has already finished the full onboarding flow, send them
      // straight to the main app (handles re-entry after a failed Supabase save).
      const hasCompletedFull = await AsyncStorage.getItem(ONBOARDING_DONE_KEY);
      if (hasCompletedFull === 'true') {
        router.replace('/tabs/bounty-app');
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
      <ActivityIndicator size="large" color="#a7f3d0" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#059669',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
