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
        { backgroundColor: bgColor, opacity: isDisabled ? 0.5 : 1 },
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
          <Text style={[styles.label, { color: textColor, marginLeft: leftIcon ? 8 : 0 }]}>
            {label}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: 15,
    fontWeight: '600',
  },
});
