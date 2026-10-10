// components/replay-mask.tsx
//
// Masks a whole subtree in PostHog session replay. sessionReplayConfig in
// lib/posthog.ts masks text inputs and images, but static <Text> is recorded
// as-is — so private messages, balances, payout amounts, dispute evidence and
// (on admin screens) other users' details were readable in replays. Wrap any
// screen that renders those. Taps and navigation still show; content doesn't.
import { PostHogMaskView } from 'posthog-react-native';
import React from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

export function ReplayMask({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <PostHogMaskView style={[styles.fill, style]}>{children}</PostHogMaskView>;
}

/** Route-level form of ReplayMask, for a screen's default export. */
export function withReplayMask<P extends object>(Screen: React.ComponentType<P>) {
  function Masked(props: P) {
    return (
      <ReplayMask>
        <Screen {...props} />
      </ReplayMask>
    );
  }
  Masked.displayName = `withReplayMask(${Screen.displayName || Screen.name || 'Screen'})`;
  return Masked;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
