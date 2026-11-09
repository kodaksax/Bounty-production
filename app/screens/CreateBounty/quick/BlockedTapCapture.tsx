import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

interface BlockedTapCaptureProps {
  /** True while the wrapped button is disabled. */
  blocked: boolean;
  onBlockedTap?: () => void;
  children: React.ReactNode;
}

/**
 * Sees taps on a disabled button without enabling it, by laying a transparent
 * target over the button while it is disabled.
 *
 * Clearing `disabled` instead wouldn't work: TouchableOpacity falls back to
 * accessibilityState.disabled for its press handling and, if `disabled` is set
 * to false, overwrites what screen readers are told. A parent can't catch the
 * tap either, because on web a disabled role="button" stops the event there.
 * This way the button keeps its props, its look and its accessibility state.
 */
export function BlockedTapCapture({ blocked, onBlockedTap, children }: BlockedTapCaptureProps) {
  return (
    <View>
      {children}
      {blocked && onBlockedTap ? (
        <Pressable
          testID="blocked-tap-capture"
          style={styles.overlay}
          accessible={false}
          importantForAccessibility="no"
          onPress={onBlockedTap}
        />
      ) : null}
    </View>
  );
}

export default BlockedTapCapture;

const styles = StyleSheet.create({
  overlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
});
