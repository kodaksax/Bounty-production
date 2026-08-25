import React from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  StyleProp,
  StyleSheet,
  ViewStyle,
} from 'react-native';

interface KeyboardAvoidingContainerProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /**
   * Distance in points between the top of this container and the top of the
   * screen — the height of any fixed header rendered above it. iOS measures
   * the keyboard gap from the bottom, so this must be a top-inset value, never
   * a raw safe-area top. Defaults to 0 for a full-screen container.
   */
  keyboardVerticalOffset?: number;
}

/**
 * Screen wrapper that lifts its content above the on-screen keyboard so the
 * focused input stays visible. Every form needs this on iOS: without it the
 * keyboard covers the input and the user types blind.
 */
export function KeyboardAvoidingContainer({
  children,
  style,
  keyboardVerticalOffset = 0,
}: KeyboardAvoidingContainerProps) {
  return (
    <KeyboardAvoidingView
      style={[styles.fill, style]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={keyboardVerticalOffset}
    >
      {children}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});

export default KeyboardAvoidingContainer;
