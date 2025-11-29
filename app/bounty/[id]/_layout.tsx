// app/bounty/[id]/_layout.tsx - Layout for bounty route group
import { Stack } from 'expo-router';
import React from 'react';

export default function BountyLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: '#1a3d2e' },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="cancel" />
      <Stack.Screen name="cancellation-response" />
      <Stack.Screen name="dispute" />
    </Stack>
  );
}
