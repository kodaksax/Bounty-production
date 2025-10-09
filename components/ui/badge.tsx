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
    backgroundColor: '#00912C', // emerald-600 (primary brand color)
    borderColor: 'rgba(0, 145, 44, 0.4)',
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
    borderColor: 'rgba(255, 254, 245, 0.2)', // Using company specified header text color
  },
  success: {
    backgroundColor: '#00912C', // Company specified primary green base
    borderColor: 'rgba(0, 145, 44, 0.3)', // Using primary brand color
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
    color: '#fffef5', // Company specified header text/logos color
  },
  secondaryText: {
    color: 'rgba(255, 254, 245, 0.8)', // Derived from company specified header text
  },
  destructiveText: {
    color: '#fffef5', // Company specified header text/logos color
  },
  outlineText: {
    color: 'rgba(255, 254, 245, 0.9)', // Derived from company specified header text
  },
  successText: {
    color: '#fffef5', // Company specified header text/logos color
  },
  warningText: {
    color: '#fffef5', // Company specified header text/logos color
  },
});

export { Badge, badgeVariants }
