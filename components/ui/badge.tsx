import * as React from "react"
import { View, ViewProps, Text, StyleSheet } from "react-native"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "lib/utils"

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground hover:bg-primary/80",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive:
          "border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80",
        outline: "text-foreground",
        success:
          "border-transparent bg-emerald-500 text-white",
        warning:
          "border-transparent bg-amber-500 text-white",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends ViewProps,
    VariantProps<typeof badgeVariants> {
  className?: string
  children?: React.ReactNode
}

function Badge({ className, variant, children, style, ...props }: BadgeProps) {
  return (
    <View 
      className={cn(badgeVariants({ variant }), className)} 
      style={[
        badgeStyles.base,
        badgeStyles[variant ?? "default"],
        style
      ]}
      {...props} 
    >
      {typeof children === "string" ? (
        <Text style={[
          badgeStyles.text,
          badgeStyles[`${variant ?? "default"}Text` as keyof typeof badgeStyles]
        ]}>
          {children}
        </Text>
      ) : (
        children
      )}
    </View>
  )
}

const badgeStyles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    // Add subtle shadow
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 1,
  },
  default: {
    backgroundColor: '#10b981',
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  secondary: {
    backgroundColor: 'rgba(16, 20, 24, 0.8)',
    borderColor: 'rgba(55, 65, 81, 0.4)',
  },
  destructive: {
    backgroundColor: '#dc2626',
    borderColor: 'rgba(220, 38, 38, 0.3)',
  },
  outline: {
    backgroundColor: 'transparent',
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  success: {
    backgroundColor: '#10b981',
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  warning: {
    backgroundColor: '#f59e0b',
    borderColor: 'rgba(245, 158, 11, 0.3)',
  },
  text: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  defaultText: {
    color: '#ffffff',
  },
  secondaryText: {
    color: 'rgba(255, 255, 255, 0.8)',
  },
  destructiveText: {
    color: '#ffffff',
  },
  outlineText: {
    color: 'rgba(255, 255, 255, 0.9)',
  },
  successText: {
    color: '#ffffff',
  },
  warningText: {
    color: '#ffffff',
  },
});

export { Badge, badgeVariants }
