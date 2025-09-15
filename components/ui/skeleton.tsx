import { View, ViewProps } from "react-native"
import { cn } from "lib/utils"

interface SkeletonProps extends ViewProps {
  className?: string
}

function Skeleton({
  className,
  ...props
}: SkeletonProps) {
  return (
    <View
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  )
}

export { Skeleton }
