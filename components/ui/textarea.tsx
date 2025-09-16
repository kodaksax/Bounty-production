import * as React from "react"
import { StyleSheet, TextInput, TextInputProps } from "react-native"

type RNTextareaProps = Omit<TextInputProps, 'onChange'> & {
  className?: string
}

const Textarea = React.forwardRef<TextInput, RNTextareaProps>(({ style, className, ...props }, ref) => {
  return (
    <TextInput
      ref={ref}
      multiline
      textAlignVertical="top"
      numberOfLines={props.numberOfLines || 4}
      placeholderTextColor="#9ca3af"
      style={[textareaStyles.base, style]}
      {...props}
    />
  )
})
Textarea.displayName = "Textarea"

const textareaStyles = StyleSheet.create({
  base: {
    minHeight: 80,
    width: '100%',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#d1d5db',
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    backgroundColor: '#ffffff',
  },
})

export { Textarea }
