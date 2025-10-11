/**
 * Hunter Flow Layout
 * Stack navigator for hunter in-progress bounty workflow
 */

import { Stack } from 'expo-router';
import React from 'react';

export default function HunterFlowLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: '#1a3d2e' },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="apply" />
      <Stack.Screen name="work-in-progress" />
      <Stack.Screen name="review-and-verify" />
      <Stack.Screen name="payout" />
    </Stack>
  );
}
