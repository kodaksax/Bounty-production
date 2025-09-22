import * as React from "react"
import { TextInput, TextInputProps, StyleSheet } from "react-native"

interface InputProps extends TextInputProps {
  variant?: "default" | "outline"
}

const Input = React.forwardRef<TextInput, InputProps>(
  ({ variant = "default", style, ...props }, ref) => {
    return (
      <TextInput
        style={[inputStyles.base, inputStyles[variant], style]}
        ref={ref}
        placeholderTextColor="#9ca3af"
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

const inputStyles = StyleSheet.create({
  base: {
    height: 40,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    backgroundColor: '#ffffff',
  },
  default: {
    borderWidth: 1,
    borderColor: '#d1d5db',
  },
  outline: {
    borderWidth: 2,
    borderColor: '#3b82f6',
  },
})

export { Input }
