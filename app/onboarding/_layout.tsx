/**
 * Onboarding Layout
 * Stack navigator for onboarding flow
 */

import { Stack } from 'expo-router';
import React from 'react';
import { OnboardingProvider } from '../../lib/context/onboarding-context';

export default function OnboardingLayout() {
  return (
    <OnboardingProvider>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: '#008e2a' },
          animation: 'slide_from_right',
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="carousel" />
        <Stack.Screen name="username" />
        <Stack.Screen name="details" />
        <Stack.Screen name="phone" />
        <Stack.Screen name="done" />
      </Stack>
    </OnboardingProvider>
  );
}
