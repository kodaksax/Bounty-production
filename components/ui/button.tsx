import { cva, type VariantProps } from "class-variance-authority"
import { useAccessibleAnimation } from "hooks/use-accessible-animation"
import { useHapticFeedback } from "lib/haptic-feedback"
import { useAppThemeContext } from "lib/themes"
import type { AppTheme } from "lib/themes/types"
import { cn, withAlpha } from "lib/utils"
import * as React from "react"
import { ActivityIndicator, Animated, StyleSheet, Text, TouchableOpacity, TouchableOpacityProps } from "react-native"

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
  /**
   * Shows an inline spinner in place of the label and blocks interaction.
   * The label stays laid out (invisible) underneath so the button doesn't
   * change size when toggling in/out of the loading state.
   */
  loading?: boolean;
}

// Hoisted to module scope — recreating this on every render would remount
// the underlying native view on every press (state update -> new component
// type -> full unmount/mount), breaking the press animation.
const AnimatedTouchable = Animated.createAnimatedComponent(TouchableOpacity);

const Button = React.forwardRef<React.ComponentRef<typeof TouchableOpacity>, ButtonProps>(
  ({ className, variant, size, disabled, loading, onPress, children, accessibilityLabel, accessibilityHint, ...props }, ref) => {
    const { theme } = useAppThemeContext();
    const { triggerHaptic } = useHapticFeedback();
    const { createSpring, createTiming } = useAccessibleAnimation();
    const scaleAnim = React.useRef(new Animated.Value(1)).current;
    const loadingAnim = React.useRef(new Animated.Value(loading ? 1 : 0)).current;
    const [isFocused, setIsFocused] = React.useState(false);
    const isDisabled = disabled || loading;

    React.useEffect(() => {
      createTiming(loadingAnim, loading ? 1 : 0, 150).start();
    }, [loading, loadingAnim, createTiming]);

    const handlePress = React.useCallback((event: any) => {
      if (isDisabled) return;

      // Trigger appropriate haptic feedback based on variant
      if (variant === 'destructive') {
        triggerHaptic('warning');
      } else {
        triggerHaptic('light');
      }

      onPress?.(event);
    }, [isDisabled, onPress, triggerHaptic, variant]);

    const handlePressIn = React.useCallback(() => {
      if (isDisabled) return;
      setIsFocused(true);
      createSpring(scaleAnim, 0.95).start();
    }, [isDisabled, scaleAnim, createSpring]);

    const handlePressOut = React.useCallback(() => {
      if (isDisabled) return;
      setIsFocused(false);
      createSpring(scaleAnim, 1).start();
    }, [isDisabled, scaleAnim, createSpring]);

    // Handle keyboard focus events for web/keyboard navigation
    const handleFocus = React.useCallback(() => {
      if (isDisabled) return;
      setIsFocused(true);
    }, [isDisabled]);

    const handleBlur = React.useCallback(() => {
      if (isDisabled) return;
      setIsFocused(false);
    }, [isDisabled]);

    const { styles: buttonStyles, spinnerColor: spinnerColors } = React.useMemo(() => makeButtonStyles(theme), [theme]);
    const spinnerColor = spinnerColors[variant ?? "default"];

    return (
      <AnimatedTouchable
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        style={[
          buttonStyles.base,
          buttonStyles[variant ?? "default"],
          // "default" is deliberately excluded here — it's the *variant* key
          // (primary green bg/border), and re-applying it whenever `size` is
          // unset would silently override destructive/outline/secondary/ghost
          // variants back to green (base already covers default dimensions).
          size && size !== "default" && buttonStyles[size],
          isDisabled && buttonStyles.disabled,
          isFocused && buttonStyles.focused,
          {
            transform: [{ scale: scaleAnim }],
          },
        ]}
        disabled={isDisabled}
        onPress={handlePress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        onFocus={handleFocus}
        onBlur={handleBlur}
        accessible={true}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel || (typeof children === "string" ? children : undefined)}
        accessibilityHint={accessibilityHint}
        accessibilityState={{ disabled: isDisabled || false, busy: loading || undefined }}
        {...props}
      >
        <Animated.View
          style={{
            opacity: loadingAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {typeof children === "string" ? (
            <Text
              className="text-inherit font-inherit"
              style={[
                buttonStyles.text,
                buttonStyles[`${variant ?? "default"}Text` as keyof typeof buttonStyles],
                isDisabled && buttonStyles.disabledText,
              ]}
            >
              {children}
            </Text>
          ) : (
            children
          )}
        </Animated.View>
        <Animated.View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            { alignItems: 'center', justifyContent: 'center', opacity: loadingAnim },
          ]}
        >
          <ActivityIndicator size="small" color={spinnerColor} />
        </Animated.View>
      </AnimatedTouchable>
    );
  }
);
Button.displayName = "Button"

function makeButtonStyles(theme: AppTheme) {
  const onBrand = '#fffef5'; // off-white text/spinner on filled brand-colored buttons

  const spinnerColor: Record<string, string> = {
    default: onBrand,
    destructive: onBrand,
    outline: theme.primary,
    secondary: theme.isDark ? onBrand : theme.text,
    ghost: theme.primary,
    link: theme.primary,
  };

  const styles = StyleSheet.create({
    base: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: theme.radius.lg,
      paddingHorizontal: theme.spacing.xl,
      paddingVertical: theme.spacing.md,
      minHeight: 48,
    },
    default: {
      backgroundColor: theme.primary,
      borderWidth: 1,
      borderColor: withAlpha(theme.primary, 0.6),
      ...theme.shadows.brand,
    },
    destructive: {
      backgroundColor: theme.error,
      borderWidth: 1,
      borderColor: withAlpha(theme.error, 0.6),
      ...theme.shadows.sm,
    },
    outline: {
      backgroundColor: 'transparent',
      borderWidth: 1.5,
      borderColor: withAlpha(theme.primary, 0.5),
    },
    secondary: {
      backgroundColor: theme.surfaceSecondary,
      borderWidth: 1,
      borderColor: withAlpha(theme.primary, 0.3),
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
      paddingHorizontal: theme.spacing.lg,
      borderRadius: theme.radius.md,
    },
    lg: {
      minHeight: 56,
      paddingHorizontal: theme.spacing['2xl'],
      borderRadius: theme.radius.xl,
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
      shadowColor: theme.primary,
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.6,
      shadowRadius: 8,
      elevation: 10,
      // Add visible border for high contrast
      borderWidth: 3,
      borderColor: theme.primaryLight,
    },
    text: {
      fontSize: theme.typography.fontSize.sm,
      fontWeight: '600',
    },
    defaultText: {
      color: onBrand,
    },
    destructiveText: {
      color: onBrand,
    },
    outlineText: {
      color: theme.primary,
    },
    secondaryText: {
      color: theme.isDark ? onBrand : theme.text,
    },
    ghostText: {
      color: theme.primary,
    },
    linkText: {
      color: theme.primary,
      textDecorationLine: 'underline',
    },
    disabledText: {
      opacity: 0.7,
    },
  });

  return { styles, spinnerColor };
}

export { Button }
