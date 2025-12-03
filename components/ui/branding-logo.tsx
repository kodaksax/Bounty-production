import React from 'react';
import { AccessibilityRole, Image, ImageStyle, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';

export interface BrandingLogoProps {
  /**
   * Size variant of the logo
   * - small: 80x24 (for headers)
   * - medium: 120x36 (default)
   * - large: 200x60 (for splash/onboarding)
   */
  size?: 'small' | 'medium' | 'large';
  /**
   * Custom style for the container View
   */
  containerStyle?: StyleProp<ViewStyle>;
  /**
   * Custom style for the Image
   */
  imageStyle?: StyleProp<ImageStyle>;
  /**
   * Accessibility role for screen readers
   * Defaults to 'header' to maintain parity with previous implementation
   */
  accessibilityRole?: AccessibilityRole;
}

const sizeMap = {
  small: { width: 80, height: 24 },
  medium: { width: 120, height: 36 },
  large: { width: 200, height: 60 },
};

/**
 * BrandingLogo component - displays the BOUNTY logo image
 * Use this instead of GPS icon + BOUNTY text pattern
 */
export function BrandingLogo({ 
  size = 'medium', 
  containerStyle, 
  imageStyle,
  accessibilityRole = 'header',
}: BrandingLogoProps) {
  const dimensions = sizeMap[size];
  
  return (
    <View style={[styles.container, containerStyle]}>
      <Image
        source={require('../../assets/images/bounty-logo.png')}
        style={[dimensions, imageStyle]}
        resizeMode="contain"
        accessibilityLabel="BOUNTY"
        accessibilityRole={accessibilityRole}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});

export default BrandingLogo;
