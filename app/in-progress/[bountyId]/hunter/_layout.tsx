/**
 * Hunter Flow Layout
 * Stack navigator for hunter in-progress bounty workflow
 * 
 * Uses the BackgroundColorContext to ensure the safe area colors match
 * the dark green background (#1a3d2e) used in hunter screens.
 */

import { Stack } from 'expo-router';
import React, { useEffect } from 'react';
import { useBackgroundColor } from '../../../../lib/context/BackgroundColorContext';

/** Dark green background color used in all hunter in-progress screens */
const HUNTER_BG_COLOR = '#1a3d2e';

export default function HunterFlowLayout() {
  const { pushColor, popColor } = useBackgroundColor();

  useEffect(() => {
    // Push the hunter background color when this layout mounts
    pushColor(HUNTER_BG_COLOR);
    
    return () => {
      // Pop the color when unmounting to restore previous color
      popColor(HUNTER_BG_COLOR);
    };
  }, [pushColor, popColor]);

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: HUNTER_BG_COLOR },
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
