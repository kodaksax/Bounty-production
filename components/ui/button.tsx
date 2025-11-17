import * as React from "react"
import { TouchableOpacity, TouchableOpacityProps, Text } from "react-native"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "lib/utils"
import { StyleSheet, ViewStyle, TextStyle } from "react-native"
import { useHapticFeedback } from "lib/haptic-feedback";

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

const Button = React.forwardRef<React.ComponentRef<typeof TouchableOpacity>, ButtonProps>(
  ({ className, variant, size, disabled, onPress, children, accessibilityLabel, accessibilityHint, ...props }, ref) => {
    const { triggerHaptic } = useHapticFeedback();
    const scaleAnim = React.useRef(new (require('react-native').Animated.Value)(1)).current;

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
      require('react-native').Animated.spring(scaleAnim, {
        toValue: 0.95,
        useNativeDriver: true,
        tension: 300,
        friction: 10,
      }).start();
    }, [disabled, scaleAnim]);

    const handlePressOut = React.useCallback(() => {
      if (disabled) return;
      require('react-native').Animated.spring(scaleAnim, {
        toValue: 1,
        useNativeDriver: true,
        tension: 300,
        friction: 10,
      }).start();
    }, [disabled, scaleAnim]);
    
    const AnimatedTouchable = require('react-native').Animated.createAnimatedComponent(TouchableOpacity);

    return (
      <AnimatedTouchable
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        style={[
          buttonStyles.base,
          buttonStyles[variant ?? "default"],
          buttonStyles[size ?? "default"],
          disabled && buttonStyles.disabled,
          {
            transform: [{ scale: scaleAnim }],
          },
        ]}
        disabled={disabled}
        onPress={handlePress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
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
    // Enhanced sophisticated shadows for better depth
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 6,
    // Add subtle transition feel (even though we can't animate in StyleSheet)
    transform: [{ scale: 1 }],
  },
  default: {
    backgroundColor: '#00912C', // Company specified primary green base
    // Enhanced inner glow effect for premium feel
    borderWidth: 1,
    borderColor: 'rgba(0, 145, 44, 0.6)',
  },
  destructive: {
    backgroundColor: '#ef4444', // destructive red
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.6)',
  },
  outline: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: 'rgba(0, 145, 44, 0.5)', // emerald outline
  },
  secondary: {
    backgroundColor: '#2d5240', // secondary emerald tone
    borderWidth: 1,
    borderColor: 'rgba(0, 145, 44, 0.3)',
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
    color: '#00912C', // emerald text
  },
  secondaryText: {
    color: '#fffef5',
  },
  ghostText: {
    color: '#00912C', // emerald text
  },
  linkText: {
    color: '#00912C',
    textDecorationLine: 'underline',
  },
  disabledText: {
    opacity: 0.7,
  },
})

export { Button }
