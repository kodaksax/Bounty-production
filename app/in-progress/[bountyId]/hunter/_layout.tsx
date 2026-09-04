/**
 * Hunter Flow Layout
 * Stack navigator for the hunter's in-progress bounty workflow.
 *
 * The safe-area color follows the app theme rather than a hardcoded
 * near-black: the hunter hub (index) is themed like the rest of the app, so
 * pinning the group to one dark value put a black band above a light-theme
 * screen. The remaining step screens still paint their own dark surfaces, and
 * are unaffected.
 */

import { Stack } from 'expo-router';
import React, { useEffect } from 'react';
import { useBackgroundColor } from '../../../../lib/context/BackgroundColorContext';
import { useAppThemeContext } from '../../../../lib/themes/AppThemeContext';

export default function HunterFlowLayout() {
  const { pushColor, popColor } = useBackgroundColor();
  const { theme } = useAppThemeContext();

  useEffect(() => {
    pushColor(theme.background);
    return () => {
      popColor(theme.background);
    };
  }, [pushColor, popColor, theme.background]);

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: theme.background },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="apply" />
      <Stack.Screen name="work-in-progress" />
      <Stack.Screen name="review-and-verify" />
      <Stack.Screen name="payout" />
    </Stack>
  );
}
