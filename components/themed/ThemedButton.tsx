import { useAppThemeContext } from 'lib/themes';
import React from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableOpacityProps,
  View,
} from 'react-native';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';

interface ThemedButtonProps extends TouchableOpacityProps {
  variant?: ButtonVariant;
  label: string;
  loading?: boolean;
  leftIcon?: React.ReactNode;
}

export function ThemedButton({
  variant = 'primary',
  label,
  loading = false,
  leftIcon,
  style,
  disabled,
  ...props
}: ThemedButtonProps) {
  const { theme } = useAppThemeContext();
  const isDisabled = disabled || loading;

  const bgColor =
    variant === 'primary'     ? theme.primary :
    variant === 'secondary'   ? theme.surfaceSecondary :
    variant === 'destructive' ? theme.error :
    'transparent';

  const textColor =
    variant === 'ghost' || variant === 'secondary' ? theme.text : '#ffffff';

  const borderStyle =
    variant === 'ghost'
      ? { borderWidth: 1, borderColor: theme.border }
      : {};

  return (
    <TouchableOpacity
      style={[
        styles.base,
        {
          backgroundColor: bgColor,
          opacity: isDisabled ? 0.5 : 1,
          borderRadius: theme.radius.lg,
          paddingHorizontal: theme.spacing.lg,
          paddingVertical: theme.spacing.md,
        },
        borderStyle,
        style,
      ]}
      disabled={isDisabled}
      activeOpacity={0.8}
      {...props}
    >
      {loading ? (
        <ActivityIndicator size="small" color={textColor} />
      ) : (
        <View style={styles.inner}>
          {leftIcon}
          <Text
            style={[
              styles.label,
              {
                color: textColor,
                marginLeft: leftIcon ? theme.spacing.sm : 0,
                fontSize: theme.typography.fontSize.sm,
                fontWeight: theme.typography.fontWeight.semibold,
              },
            ]}
          >
            {label}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {},
});
