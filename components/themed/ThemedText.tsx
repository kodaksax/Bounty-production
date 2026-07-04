import { useAppThemeContext } from 'lib/themes';
import React from 'react';
import { Text, TextProps } from 'react-native';

type TextVariant = 'primary' | 'secondary' | 'disabled' | 'accent';

interface ThemedTextProps extends TextProps {
  variant?: TextVariant;
}

export function ThemedText({ variant = 'primary', style, ...props }: ThemedTextProps) {
  const { theme } = useAppThemeContext();

  const color =
    variant === 'secondary' ? theme.textSecondary :
    variant === 'disabled'  ? theme.textDisabled :
    variant === 'accent'    ? theme.primaryLight :
    theme.text;

  return <Text style={[{ color }, style]} {...props} />;
}
