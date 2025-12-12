// app/postings/[bountyId]/_layout.tsx - Layout for bounty detail route group
import { Stack } from 'expo-router';
import React from 'react';

export default function BountyDetailLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: '#1a3d2e' },
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
