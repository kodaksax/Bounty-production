import { useAppThemeContext } from 'lib/themes';
import React from 'react';
import { StyleSheet, TextInput, TextInputProps, View, ViewStyle } from 'react-native';

interface ThemedInputProps extends TextInputProps {
  containerStyle?: ViewStyle;
  hasError?: boolean;
}

export function ThemedInput({ containerStyle, hasError, style, ...props }: ThemedInputProps) {
  const { theme } = useAppThemeContext();

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: theme.surfaceSecondary,
          borderColor: hasError ? theme.error : theme.border,
        },
        containerStyle,
      ]}
    >
      <TextInput
        style={[{ color: theme.text, flex: 1 }, styles.input, style]}
        placeholderTextColor={theme.textDisabled}
        {...props}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  input: {
    fontSize: 15,
    padding: 0,
  },
});
