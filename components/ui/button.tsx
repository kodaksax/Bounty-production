import { cva, type VariantProps } from "class-variance-authority"
import { useAccessibleAnimation } from "hooks/use-accessible-animation"
import { useHapticFeedback } from "lib/haptic-feedback"
import { theme } from "lib/theme"
import { cn } from "lib/utils"
import * as React from "react"
import { Animated, StyleSheet, Text, TouchableOpacity, TouchableOpacityProps } from "react-native"

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
  accessibilityLabel?: string;
  accessibilityHint?: string;
}

// Hoisted to module scope — recreating this on every render would remount
// the underlying native view on every press (state update -> new component
// type -> full unmount/mount), breaking the press animation.
const AnimatedTouchable = Animated.createAnimatedComponent(TouchableOpacity);

const Button = React.forwardRef<React.ComponentRef<typeof TouchableOpacity>, ButtonProps>(
  ({ className, variant, size, disabled, onPress, children, accessibilityLabel, accessibilityHint, ...props }, ref) => {
    const { triggerHaptic } = useHapticFeedback();
    const { createSpring } = useAccessibleAnimation();
    const scaleAnim = React.useRef(new Animated.Value(1)).current;
    const [isFocused, setIsFocused] = React.useState(false);

    const handlePress = React.useCallback((event: any) => {
      if (disabled) return;

      // Trigger appropriate haptic feedback based on variant
      if (variant === 'destructive') {
        triggerHaptic('warning');
      } else {
        triggerHaptic('light');
      }

      onPress?.(event);
    }, [disabled, onPress, triggerHaptic, variant]);

    const handlePressIn = React.useCallback(() => {
      if (disabled) return;
      setIsFocused(true);
      createSpring(scaleAnim, 0.95).start();
    }, [disabled, scaleAnim, createSpring]);

    const handlePressOut = React.useCallback(() => {
      if (disabled) return;
      setIsFocused(false);
      createSpring(scaleAnim, 1).start();
    }, [disabled, scaleAnim, createSpring]);

    // Handle keyboard focus events for web/keyboard navigation
    const handleFocus = React.useCallback(() => {
      if (disabled) return;
      setIsFocused(true);
    }, [disabled]);

    const handleBlur = React.useCallback(() => {
      if (disabled) return;
      setIsFocused(false);
    }, [disabled]);

    return (
      <AnimatedTouchable
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        style={[
          buttonStyles.base,
          buttonStyles[variant ?? "default"],
          buttonStyles[size ?? "default"],
          disabled && buttonStyles.disabled,
          isFocused && buttonStyles.focused,
          {
            transform: [{ scale: scaleAnim }],
          },
        ]}
        disabled={disabled}
        onPress={handlePress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        onFocus={handleFocus}
        onBlur={handleBlur}
        accessible={true}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel || (typeof children === "string" ? children : undefined)}
        accessibilityHint={accessibilityHint}
        accessibilityState={{ disabled: disabled || false }}
        {...props}
      >
        {typeof children === "string" ? (
          <Text
            className="text-inherit font-inherit"
            style={[
              buttonStyles.text,
              buttonStyles[`${variant ?? "default"}Text` as keyof typeof buttonStyles],
              disabled && buttonStyles.disabledText,
            ]}
          >
            {children}
          </Text>
        ) : (
          children
        )}
      </AnimatedTouchable>
    );
  }
);
Button.displayName = "Button"

const buttonStyles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    paddingHorizontal: 20,
    paddingVertical: 12,
    minHeight: 48,
    // Add subtle transition feel (even though we can't animate in StyleSheet)
    transform: [{ scale: 1 }],
  },
  default: {
    backgroundColor: '#059669', // brand primary green base
    // Enhanced inner glow effect for premium feel
    borderWidth: 1,
    borderColor: 'rgba(5, 150, 105, 0.6)',
    ...theme.shadows.emerald,
  },
  destructive: {
    backgroundColor: '#ef4444', // destructive red
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.6)',
    ...theme.shadows.sm,
  },
  outline: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: 'rgba(5, 150, 105, 0.5)', // emerald outline
  },
  secondary: {
    backgroundColor: '#2d5240', // secondary emerald tone
    borderWidth: 1,
    borderColor: 'rgba(5, 150, 105, 0.3)',
    ...theme.shadows.sm,
  },
  ghost: {
    backgroundColor: 'transparent',
    borderWidth: 0,
  },
  link: {
    backgroundColor: 'transparent',
    borderWidth: 0,
  },
  sm: {
    minHeight: 40,
    paddingHorizontal: 16,
    borderRadius: 10,
  },
  lg: {
    minHeight: 56,
    paddingHorizontal: 28,
    borderRadius: 14,
  },
  icon: {
    width: 48,
    height: 48,
    paddingHorizontal: 0,
    paddingVertical: 0,
  },
  disabled: {
    opacity: 0.5,
  },
  // Focus state for keyboard navigation (WCAG 2.4.7)
  focused: {
    shadowColor: '#059669', // Emerald color for focus ring
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 8,
    elevation: 10,
    // Add visible border for high contrast
    borderWidth: 3,
    borderColor: '#6ee7b7', // Light emerald for visibility
  },
  text: {
    fontSize: 15,
    fontWeight: '600',
  },
  defaultText: {
    color: '#fffef5', // off-white
  },
  destructiveText: {
    color: '#fffef5',
  },
  outlineText: {
    color: '#059669', // emerald text
  },
  secondaryText: {
    color: '#fffef5',
  },
  ghostText: {
    color: '#059669', // emerald text
  },
  linkText: {
    color: '#059669',
    textDecorationLine: 'underline',
  },
  disabledText: {
    opacity: 0.7,
  },
})

export { Button }
