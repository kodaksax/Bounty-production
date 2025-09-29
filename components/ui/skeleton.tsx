import { View, ViewProps, StyleSheet } from "react-native"
import { cn } from "lib/utils"

interface SkeletonProps extends ViewProps {
  className?: string
  variant?: "default" | "card" | "text" | "circle"
}

function Skeleton({
  className,
  variant = "default",
  style,
  ...props
}: SkeletonProps) {
  return (
    <View
      style={[
        skeletonStyles.base,
        variant === "card" && skeletonStyles.card,
        variant === "text" && skeletonStyles.text,
        variant === "circle" && skeletonStyles.circle,
        style
      ]}
      className={cn("animate-pulse", className)}
      {...props}
    />
  )
}

const skeletonStyles = StyleSheet.create({
  base: {
    backgroundColor: 'rgba(16, 185, 129, 0.3)', // emerald with opacity
    borderRadius: 8,
    // Add subtle shimmer effect
    overflow: 'hidden',
  },
  card: {
    borderRadius: 16,
    height: 120,
    backgroundColor: 'rgba(12, 58, 36, 0.6)', // dark emerald surface
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.2)', // emerald border
  },
  text: {
    height: 16,
    borderRadius: 4,
    backgroundColor: 'rgba(167, 243, 208, 0.1)', // light emerald with opacity
  },
  circle: {
    borderRadius: 999,
    aspectRatio: 1,
    backgroundColor: 'rgba(16, 185, 129, 0.2)', // emerald glow with opacity
  },
})

export { Skeleton }
