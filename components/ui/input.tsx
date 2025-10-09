import * as React from "react"
import { TextInput, TextInputProps, StyleSheet } from "react-native"

interface InputProps extends TextInputProps {
  variant?: "default" | "outline"
  label?: string
  error?: string
}

const Input = React.forwardRef<TextInput, InputProps>(
  ({ variant = "default", style, label, error, accessibilityLabel, accessibilityHint, ...props }, ref) => {
    return (
      <TextInput
        style={[
          inputStyles.base, 
          inputStyles[variant], 
          error && inputStyles.error,
          style
        ]}
        ref={ref}
        placeholderTextColor="rgba(255, 255, 255, 0.5)"
        accessible={true}
        accessibilityLabel={accessibilityLabel || label || props.placeholder}
        accessibilityHint={accessibilityHint || (error ? `Error: ${error}` : undefined)}
        accessibilityRole="none" // TextInput already has proper role
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
    color: '#fffef5', // company specified header text color
    backgroundColor: 'rgba(0, 87, 26, 0.3)', // emerald-700 with opacity for glass effect
    fontWeight: '400',
    // Enhanced glass-morphism styling
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 2,
  } as any,
  default: {
    borderWidth: 1,
    borderColor: 'rgba(0, 145, 44, 0.4)', // emerald-600 border
  },
  outline: {
    borderWidth: 1.5,
    borderColor: '#00912C', // emerald-600 (primary brand)
    // Enhanced glow effect for focused state
    shadowColor: '#00912C', // emerald-600 glow
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  error: {
    borderColor: '#dc2626',
    backgroundColor: 'rgba(60, 5, 5, 0.8)',
    shadowColor: '#dc2626',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
  },
})

export { Input }
