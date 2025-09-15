import * as React from "react"
import { TouchableOpacity, TouchableOpacityProps, Text, StyleSheet } from "react-native"

export interface ButtonProps extends TouchableOpacityProps {
  variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link"
  size?: "default" | "sm" | "lg" | "icon"
  children?: React.ReactNode
}

const Button = React.forwardRef<TouchableOpacity, ButtonProps>(
  ({ variant = "default", size = "default", disabled, onPress, children, style, ...props }, ref) => {
    const buttonStyle = [
      buttonStyles.base,
      buttonStyles[variant],
      buttonStyles[size],
      disabled && buttonStyles.disabled,
      style,
    ]

    return (
      <TouchableOpacity
        ref={ref}
        style={buttonStyle}
        disabled={disabled}
        onPress={onPress}
        {...props}
      >
        {typeof children === 'string' ? (
          <Text style={[buttonStyles.text, buttonStyles[`${variant}Text`], disabled && buttonStyles.disabledText]}>
            {children}
          </Text>
        ) : children}
      </TouchableOpacity>
    )
  }
)
Button.displayName = "Button"

const buttonStyles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
    minHeight: 40,
  },
  default: {
    backgroundColor: '#3b82f6', // primary
  },
  destructive: {
    backgroundColor: '#ef4444', // destructive
  },
  outline: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#d1d5db', // input border
  },
  secondary: {
    backgroundColor: '#f3f4f6', // secondary
  },
  ghost: {
    backgroundColor: 'transparent',
  },
  link: {
    backgroundColor: 'transparent',
  },
  sm: {
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: 6,
  },
  lg: {
    minHeight: 44,
    paddingHorizontal: 32,
    borderRadius: 6,
  },
  icon: {
    width: 40,
    height: 40,
    paddingHorizontal: 0,
  },
  disabled: {
    opacity: 0.5,
  },
  text: {
    fontSize: 14,
    fontWeight: '500',
  },
  defaultText: {
    color: 'white',
  },
  destructiveText: {
    color: 'white',
  },
  outlineText: {
    color: '#374151',
  },
  secondaryText: {
    color: '#374151',
  },
  ghostText: {
    color: '#374151',
  },
  linkText: {
    color: '#3b82f6',
    textDecorationLine: 'underline',
  },
  disabledText: {
    opacity: 0.5,
  },
})

export { Button }
