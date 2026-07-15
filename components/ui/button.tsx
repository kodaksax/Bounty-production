import { cva, type VariantProps } from "class-variance-authority"
import { useHapticFeedback } from "lib/haptic-feedback"
import { useAppThemeContext } from "lib/themes/AppThemeContext"
import type { AppTheme } from "lib/themes/types"
import { cn } from "lib/utils"
import * as React from "react"
import { StyleSheet, Text, TouchableOpacity, TouchableOpacityProps } from "react-native"

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

// Text color placed on top of the bright brand-green primary fill. Matches
// the dark-on-green convention used across onboarding/wallet (see e.g.
// lib/onboarding/onboarding-details-styles.ts nextButtonText) so a button
// rendered through this shared component looks identical to the hand-rolled
// primary CTAs elsewhere in the app.
const ON_PRIMARY_TEXT = '#052e1b';
const ON_DESTRUCTIVE_TEXT = '#ffffff';

type Variant = NonNullable<VariantProps<typeof buttonVariants>["variant"]>;
type Size = NonNullable<VariantProps<typeof buttonVariants>["size"]>;

interface VariantColors {
  background: string;
  border: string;
  text: string;
  shadowColor: string;
}

function makeVariantColors(appTheme: AppTheme): Record<Variant, VariantColors> {
  return {
    default: {
      background: appTheme.primary,
      border: appTheme.primary,
      text: ON_PRIMARY_TEXT,
      shadowColor: appTheme.primary,
    },
    destructive: {
      background: appTheme.error,
      border: appTheme.error,
      text: ON_DESTRUCTIVE_TEXT,
      shadowColor: appTheme.error,
    },
    outline: {
      background: 'transparent',
      border: appTheme.primary,
      text: appTheme.primary,
      shadowColor: 'transparent',
    },
    secondary: {
      background: appTheme.surfaceSecondary,
      border: appTheme.border,
      text: appTheme.text,
      shadowColor: 'transparent',
    },
    ghost: {
      background: 'transparent',
      border: 'transparent',
      text: appTheme.primary,
      shadowColor: 'transparent',
    },
    link: {
      background: 'transparent',
      border: 'transparent',
      text: appTheme.primary,
      shadowColor: 'transparent',
    },
  };
}

const Button = React.forwardRef<React.ComponentRef<typeof TouchableOpacity>, ButtonProps>(
  ({ className, variant, size, disabled, onPress, children, accessibilityLabel, accessibilityHint, style, ...props }, ref) => {
    const { triggerHaptic } = useHapticFeedback();
    const { theme: appTheme } = useAppThemeContext();
    const scaleAnim = React.useRef(new (require('react-native').Animated.Value)(1)).current;
    const [isFocused, setIsFocused] = React.useState(false);

    const resolvedVariant: Variant = variant ?? "default";
    const resolvedSize: Size = size ?? "default";
    const colors = React.useMemo(() => makeVariantColors(appTheme)[resolvedVariant], [appTheme, resolvedVariant]);

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
      require('react-native').Animated.spring(scaleAnim, {
        toValue: 0.95,
        useNativeDriver: true,
        tension: 300,
        friction: 10,
      }).start();
    }, [disabled, scaleAnim]);

    const handlePressOut = React.useCallback(() => {
      if (disabled) return;
      setIsFocused(false);
      require('react-native').Animated.spring(scaleAnim, {
        toValue: 1,
        useNativeDriver: true,
        tension: 300,
        friction: 10,
      }).start();
    }, [disabled, scaleAnim]);

    // Handle keyboard focus events for web/keyboard navigation
    const handleFocus = React.useCallback(() => {
      if (disabled) return;
      setIsFocused(true);
    }, [disabled]);

    const handleBlur = React.useCallback(() => {
      if (disabled) return;
      setIsFocused(false);
    }, [disabled]);

    const AnimatedTouchable = require('react-native').Animated.createAnimatedComponent(TouchableOpacity);

    const hasGlow = resolvedVariant === 'default' || resolvedVariant === 'destructive';
    const borderWidth = resolvedVariant === 'outline' ? 1.5 : resolvedVariant === 'ghost' || resolvedVariant === 'link' ? 0 : 1;

    return (
      <AnimatedTouchable
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        style={[
          layoutStyles.base,
          layoutStyles[resolvedSize],
          {
            backgroundColor: colors.background,
            borderWidth,
            borderColor: colors.border,
          },
          hasGlow && {
            shadowColor: colors.shadowColor,
            shadowOffset: { width: 0, height: 0 },
            shadowOpacity: 0.3,
            shadowRadius: 12,
            elevation: 6,
          },
          disabled && layoutStyles.disabled,
          // Visible keyboard-focus ring (WCAG 2.4.7). Shape lives in the
          // static `focused` style below; color comes from the live theme
          // so the ring stays visible in both light and dark mode.
          isFocused && [layoutStyles.focused, { borderColor: appTheme.primaryLight, shadowColor: appTheme.primary }],
          {
            transform: [{ scale: scaleAnim }],
          },
          style,
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
              layoutStyles.text,
              { color: colors.text },
              resolvedVariant === 'link' && layoutStyles.linkText,
              disabled && layoutStyles.disabledText,
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

// Pill-shaped, theme-agnostic layout (padding/sizing/shape only — colors come
// from makeVariantColors(theme) above so the button adapts to light/dark).
const layoutStyles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    paddingHorizontal: 20,
    paddingVertical: 12,
    minHeight: 48,
  },
  default: {},
  sm: {
    minHeight: 40,
    paddingHorizontal: 16,
    borderRadius: 999,
  },
  lg: {
    minHeight: 56,
    paddingHorizontal: 28,
    borderRadius: 999,
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
  // Focus state shape for keyboard navigation (WCAG 2.4.7); color is applied
  // at render time from the live theme (see the `isFocused &&` override above).
  focused: {
    borderWidth: 3,
    borderColor: 'transparent',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 8,
    elevation: 10,
  },
  text: {
    fontSize: 15,
    fontWeight: '600',
  },
  linkText: {
    textDecorationLine: 'underline',
  },
  disabledText: {
    opacity: 0.7,
  },
})

export { Button }
