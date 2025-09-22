import * as React from "react"
import { Text, TextProps, StyleSheet } from "react-native"

interface LabelProps extends TextProps {
  children?: React.ReactNode
}

const Label = React.forwardRef<Text, LabelProps>(
  ({ style, children, ...props }, ref) => (
    <Text
      ref={ref}
      style={[labelStyles.base, style]}
      {...props}
    >
      {children}
    </Text>
  )
)
Label.displayName = "Label"

const labelStyles = StyleSheet.create({
  base: {
    fontSize: 14,
    fontWeight: '500',
    color: '#374151',
    marginBottom: 4,
  },
})

export { Label }
