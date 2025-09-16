import React from "react"
import { View, ViewProps, ViewStyle, StyleProp } from "react-native"

interface AspectRatioProps extends Omit<ViewProps, "style"> {
  ratio?: number // width / height (e.g., 16/9 => 16/9)
  style?: StyleProp<ViewStyle>
  children?: React.ReactNode
}

export const AspectRatio = React.forwardRef<React.ComponentRef<typeof View>, AspectRatioProps>(
  ({ ratio = 1, style, children, ...props }, ref) => {
    return (
      <View ref={ref} style={[{ aspectRatio: ratio }, style]} {...props}>
        {children}
      </View>
    )
  }
)
AspectRatio.displayName = "AspectRatio"