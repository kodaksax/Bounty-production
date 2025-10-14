import React from 'react';
import { Text as RNText, TextProps as RNTextProps, StyleSheet } from 'react-native';
import { getAccessibleFontSize, TYPOGRAPHY } from '../../lib/constants/accessibility';

/**
 * Accessible Text Component
 * 
 * Wraps React Native's Text with support for:
 * - Dynamic font scaling based on system accessibility settings
 * - Standardized typography sizes
 * - Proper line heights for comfortable reading
 */

export interface AccessibleTextProps extends RNTextProps {
  /**
   * Predefined size from typography constants
   * Falls back to fontSize in style if not provided
   */
  size?: keyof typeof TYPOGRAPHY_SIZES;
  
  /**
   * Whether to allow font scaling (default: true)
   */
  allowFontScaling?: boolean;
  
  /**
   * Maximum font scale multiplier (default: 1.5)
   * Prevents text from becoming too large and breaking layout
   */
  maxFontSizeMultiplier?: number;
}

// Map of size names to font sizes
const TYPOGRAPHY_SIZES = {
  xlarge: TYPOGRAPHY.SIZE_XLARGE,
  large: TYPOGRAPHY.SIZE_LARGE,
  header: TYPOGRAPHY.SIZE_HEADER,
  body: TYPOGRAPHY.SIZE_BODY,
  default: TYPOGRAPHY.SIZE_DEFAULT,
  small: TYPOGRAPHY.SIZE_SMALL,
  xsmall: TYPOGRAPHY.SIZE_XSMALL,
  tiny: TYPOGRAPHY.SIZE_TINY,
} as const;

export const AccessibleText = React.forwardRef<RNText, AccessibleTextProps>(
  (
    {
      size,
      allowFontScaling = true,
      maxFontSizeMultiplier = 1.5,
      style,
      children,
      ...props
    },
    ref
  ) => {
    // Get font size from size prop or style
    const fontSize = size 
      ? TYPOGRAPHY_SIZES[size] 
      : typeof style === 'object' && style && 'fontSize' in style 
        ? (style as any).fontSize 
        : TYPOGRAPHY.SIZE_DEFAULT;

    // Calculate line height for comfortable reading
    const lineHeight = Math.round(fontSize * TYPOGRAPHY.LINE_HEIGHT_NORMAL);

    return (
      <RNText
        ref={ref}
        allowFontScaling={allowFontScaling}
        maxFontSizeMultiplier={maxFontSizeMultiplier}
        style={[
          styles.base,
          {
            fontSize,
            lineHeight,
          },
          style,
        ]}
        {...props}
      >
        {children}
      </RNText>
    );
  }
);

AccessibleText.displayName = 'AccessibleText';

const styles = StyleSheet.create({
  base: {
    // Base text styles - can be overridden by style prop
  },
});

/**
 * Preset text components for common use cases
 */

export const HeaderText = (props: Omit<AccessibleTextProps, 'size'>) => (
  <AccessibleText size="header" {...props} accessibilityRole="header" />
);

export const BodyText = (props: Omit<AccessibleTextProps, 'size'>) => (
  <AccessibleText size="body" {...props} />
);

export const SmallText = (props: Omit<AccessibleTextProps, 'size'>) => (
  <AccessibleText size="small" {...props} />
);

export const LargeText = (props: Omit<AccessibleTextProps, 'size'>) => (
  <AccessibleText size="large" {...props} />
);
