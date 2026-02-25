/**
 * SafeScreen — Full-bleed screen wrapper with safe-area insets
 *
 * Use this wrapper on screens that render a full-bleed background
 * (auth flows, onboarding, legal pages) to ensure content is never
 * obscured by notches, Dynamic Island, or status bars.
 *
 * Tab screens should NOT use this component — they rely on the
 * ScreenHeader component's built-in inset handling.
 *
 * Usage:
 *   <SafeScreen>
 *     <MyScreenContent />
 *   </SafeScreen>
 *
 *   // Override background color:
 *   <SafeScreen style={{ backgroundColor: colors.background.surface }}>
 *     ...
 *   </SafeScreen>
 */

import React from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../../lib/theme';

export interface SafeScreenProps {
  children: React.ReactNode;
  /** Additional styles merged into the root SafeAreaView */
  style?: StyleProp<ViewStyle>;
  /**
   * Which edges to apply safe-area insets to.
   * Defaults to ['top', 'left', 'right'] so the bottom is handled by
   * the global BottomNav padding instead.
   */
  edges?: ('top' | 'bottom' | 'left' | 'right')[];
}

export function SafeScreen({
  children,
  style,
  edges = ['top', 'left', 'right'],
}: SafeScreenProps) {
  return (
    <SafeAreaView
      style={[styles.root, style]}
      edges={edges}
    >
      <View style={styles.inner}>{children}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background.primary,
  },
  inner: {
    flex: 1,
  },
});
