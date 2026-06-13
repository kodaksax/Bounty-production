import { useAppThemeContext } from 'lib/themes';
import React from 'react';
import { StyleSheet, View, ViewProps } from 'react-native';

interface ThemedCardProps extends ViewProps {
  /** 'default' uses surface bg; 'elevated' uses surfaceSecondary */
  variant?: 'default' | 'elevated';
}

export function ThemedCard({ variant = 'default', style, ...props }: ThemedCardProps) {
  const { theme } = useAppThemeContext();

  return (
    <View
      style={[
        styles.base,
        {
          backgroundColor: variant === 'elevated' ? theme.surfaceSecondary : theme.surface,
          borderColor: theme.border,
        },
        style,
      ]}
      {...props}
    />
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
  },
});
