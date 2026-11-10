import * as React from "react"
import { StyleSheet, TextInput, TextInputProps } from "react-native"
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../lib/themes/types';

type RNTextareaProps = Omit<TextInputProps, 'onChange'> & {
  className?: string
}

const Textarea = React.forwardRef<TextInput, RNTextareaProps>(({ style, className, ...props }, ref) => {
  const { theme } = useAppThemeContext();
  const textareaStyles = React.useMemo(() => makeTextareaStyles(theme), [theme]);
  return (
    <TextInput
      ref={ref}
      multiline
      textAlignVertical="top"
      numberOfLines={props.numberOfLines || 4}
      placeholderTextColor={theme.textSecondary}
      style={[textareaStyles.base, style]}
      {...props}
    />
  )
})
Textarea.displayName = "Textarea"

function makeTextareaStyles(theme: AppTheme) {
  return StyleSheet.create({
  base: {
    minHeight: 80,
    width: '100%',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.border,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    backgroundColor: theme.surfaceSecondary,
  },
})
}

export { Textarea }
