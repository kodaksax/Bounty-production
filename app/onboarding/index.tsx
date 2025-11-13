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

export default function OnboardingIndex() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkOnboardingStatus();
  }, []);

  const checkOnboardingStatus = async () => {
    try {
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
    } finally {
      setLoading(false);
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
