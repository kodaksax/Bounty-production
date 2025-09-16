import * as React from "react"
import { View, Text, TouchableOpacity } from "react-native"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "lib/utils"

const alertVariants = cva(
  "relative w-full rounded-lg border p-4 [&>svg~*]:pl-7 [&>svg+div]:translate-y-[-3px] [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4 [&>svg]:text-foreground",
  {
    variants: {
      variant: {
        default: "bg-background text-foreground",
        destructive:
          "border-destructive/50 text-destructive dark:border-destructive [&>svg]:text-destructive",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

const Alert = React.forwardRef<
  React.ComponentRef<typeof View>,
  React.ComponentPropsWithRef<typeof View> & VariantProps<typeof alertVariants>
>(({ className, variant, ...props }, ref) => (
  <View
    ref={ref}
    accessibilityRole="alert"
    className={cn(alertVariants({ variant }), className)}
    {...props}
  />
))
Alert.displayName = "Alert"

const AlertTitle = React.forwardRef<
  React.ComponentRef<typeof Text>,
  React.ComponentPropsWithRef<typeof Text> & { className?: string }
>(({ className, ...props }, ref) => (
  <Text
    ref={ref}
    className={cn("mb-1 font-medium leading-none tracking-tight", className)}
    {...props}
  />
))
 AlertTitle.displayName = "AlertTitle"

const AlertDescription = React.forwardRef<
  React.ComponentRef<typeof Text>,
  React.ComponentPropsWithRef<typeof Text> & { className?: string }
>(({ className, ...props }, ref) => (
  <Text
    ref={ref}
    className={cn("text-sm opacity-90", className)}
    {...props}
  />
))
AlertDescription.displayName = "AlertDescription"

export { Alert, AlertTitle, AlertDescription }
