import * as React from "react"
import { TouchableOpacity, TouchableOpacityProps, Text } from "react-native"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "lib/utils"
import { StyleSheet, ViewStyle, TextStyle } from "react-native";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline:
          "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends TouchableOpacityProps,
    VariantProps<typeof buttonVariants> {
  className?: string;
  children?: React.ReactNode;
}

const Button = React.forwardRef<React.ComponentRef<typeof TouchableOpacity>, ButtonProps>(
  ({ className, variant, size, disabled, onPress, children, ...props }, ref) => {
    return (
      <TouchableOpacity
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        style={[
          buttonStyles.base,
          buttonStyles[variant ?? "default"],
          buttonStyles[size ?? "default"],
          disabled && buttonStyles.disabled,
        ]}
        disabled={disabled}
        onPress={onPress}
        {...props}
      >
        {typeof children === "string" ? (
          <Text className="text-inherit font-inherit">{children}</Text>
        ) : (
          children
        )}
      </TouchableOpacity>
    );
  }
);
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
