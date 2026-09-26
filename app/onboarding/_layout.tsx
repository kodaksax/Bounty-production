/**
 * Onboarding Layout
 * Stack navigator for onboarding flow.
 *
 * `contentStyle` is the background the navigator paints behind a screen —
 * visible for a frame during the push transition and under any screen that
 * doesn't fill its own bounds. It used to be a hardcoded brand green, which
 * flashed green on every step regardless of the user's theme; it follows the
 * theme's background now, so the transition is invisible instead of a flicker.
 */

import { Stack } from 'expo-router';
import React from 'react';
import { OnboardingProvider } from '../../lib/context/onboarding-context';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';

export default function OnboardingLayout() {
  const { theme } = useAppThemeContext();

  return (
    <OnboardingProvider>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.background },
          animation: 'slide_from_right',
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="welcome" />
        <Stack.Screen name="username" />
        <Stack.Screen name="style" />
        <Stack.Screen name="location" />
        <Stack.Screen name="payouts" />
        <Stack.Screen name="founder-note" />
      </Stack>
    </OnboardingProvider>
  );
}
