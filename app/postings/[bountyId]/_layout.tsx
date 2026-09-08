// app/postings/[bountyId]/_layout.tsx - Layout for the poster's bounty screens
//
// The group background follows the app theme rather than a hardcoded
// near-black: the dashboard (index) is themed, so pinning the stack to one dark
// value painted a dark band behind a light-theme screen. review-and-verify and
// payout still paint their own dark surfaces and are unaffected.
import { Stack } from 'expo-router';
import React from 'react';
import { useAppThemeContext } from '../../../lib/themes/AppThemeContext';

export default function BountyDetailLayout() {
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
      <Stack.Screen name="review-and-verify" />
      <Stack.Screen
        name="payout"
        options={{
          presentation: 'modal',
          animation: 'slide_from_bottom',
        }}
      />
    </Stack>
  );
}
