// app/bounty/[id]/_layout.tsx - Layout for bounty route group
//
// The background follows the app theme instead of a hardcoded near-black, so a
// light-theme user doesn't get a dark band behind the bounty detail screens.
import { Stack } from 'expo-router';
import React from 'react';
import { useAppThemeContext } from '../../../lib/themes/AppThemeContext';

export default function BountyLayout() {
  const { theme } = useAppThemeContext();

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: theme.background },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="public" />
      <Stack.Screen name="cancel" />
      <Stack.Screen name="cancellation-response" />
      <Stack.Screen name="dispute" />
    </Stack>
  );
}
