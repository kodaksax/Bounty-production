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
          borderRadius: theme.radius.lg,
          padding: theme.spacing.lg,
        },
        style,
      ]}
      {...props}
    />
  );
}

const styles = StyleSheet.create({
  base: {
    borderWidth: 1,
  },
});
