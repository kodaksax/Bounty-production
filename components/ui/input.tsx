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
        placeholderTextColor="rgba(255, 255, 255, 0.5)"
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

const inputStyles = StyleSheet.create({
  base: {
    height: 48,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 15,
    color: '#ffffff',
    backgroundColor: 'rgba(16, 20, 24, 0.8)',
    fontWeight: '400',
    // Glass-morphism styling
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 2,
  },
  default: {
    borderWidth: 1,
    borderColor: 'rgba(55, 65, 81, 0.4)',
  },
  outline: {
    borderWidth: 1.5,
    borderColor: '#10b981', // spy-glow
    // Add glow effect for focused state
    shadowColor: '#10b981',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
})

export { Input }
