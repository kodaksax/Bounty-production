// Design system tokens for BountyExpo
// Brand color palette with glass-morphism effects

export const colors = {
  // Primary green palette (company branding)
  // New brand colors:
  // Background: #008e2a, Foreground: #ffffff
  // Accent 1: #d5ecdc, Accent 2: #aad9b8, Accent 3: #80c795
  primary: {
    50: '#f0faf3',
    100: '#d5ecdc', // Accent 1 - lightest
    200: '#aad9b8', // Accent 2 - medium
    300: '#80c795', // Accent 3 - darker accent
    400: '#4ab06a',
    500: '#008e2a', // Main brand color - Background
    600: '#007523',
    700: '#005c1c',
    800: '#004315',
    900: '#002a0e',
    950: '#001507',
  },
  
  // Background colors (brand green theme)
  background: {
    primary: '#008e2a', // Main background - brand specified
    secondary: '#007523', // Header background - slightly darker
    surface: 'rgba(0, 142, 42, 0.75)', // Card surface
    elevated: 'rgba(0, 142, 42, 0.85)', // Modal/elevated surface
  },
  
  // Text colors
  text: {
    primary: '#ffffff', // White for readability - Foreground
    secondary: 'rgba(255, 255, 255, 0.8)',
    muted: 'rgba(255, 255, 255, 0.6)',
    inverse: '#008e2a',
  },
  
  // Border colors
  border: {
    primary: 'rgba(128, 199, 149, 0.4)', // Accent 3
    muted: 'rgba(128, 199, 149, 0.2)',
    strong: 'rgba(128, 199, 149, 0.6)',
  },
  
  // Status colors
  success: '#008e2a',
  warning: '#f59e0b',
  error: '#ef4444',
  info: '#3b82f6',
} as const;

// Spacing scale
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  '2xl': 32,
  '3xl': 48,
  '4xl': 64,
} as const;

// Border radius scale
export const borderRadius = {
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  '2xl': 24,
  full: 9999,
} as const;

// Typography scale
export const typography = {
  fontSize: {
    xs: 12,
    sm: 14,
    base: 16,
    lg: 18,
    xl: 20,
    '2xl': 24,
    '3xl': 30,
    '4xl': 36,
  },
  fontWeight: {
    normal: '400' as const,
    medium: '500' as const,
    semibold: '600' as const,
    bold: '700' as const,
  },
  lineHeight: {
    tight: 1.25,
    normal: 1.5,
    relaxed: 1.75,
  },
} as const;

// Shadow presets with brand glow
export const shadows = {
  sm: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  md: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  lg: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 5,
  },
  xl: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 8,
  },
  brand: {
    shadowColor: '#008e2a', // Brand primary
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 6,
  },
} as const;

// @deprecated Use 'brand' shadow instead. Will be removed in a future version.
export const emeraldShadow = shadows.brand;

// Glass morphism effects
export const glassMorphism = {
  light: {
    backgroundColor: 'rgba(0, 142, 42, 0.6)',
    backdropFilter: 'blur(10px)',
  },
  medium: {
    backgroundColor: 'rgba(0, 142, 42, 0.75)',
    backdropFilter: 'blur(20px)',
  },
  heavy: {
    backgroundColor: 'rgba(0, 142, 42, 0.85)',
    backdropFilter: 'blur(30px)',
  },
} as const;

// Animation presets
export const animations = {
  duration: {
    fast: 150,
    normal: 250,
    slow: 400,
  },
  easing: {
    easeIn: 'ease-in',
    easeOut: 'ease-out',
    easeInOut: 'ease-in-out',
    spring: 'spring',
  },
} as const;

// Helper functions
export const getSpacing = (size: keyof typeof spacing) => spacing[size];
export const getBorderRadius = (size: keyof typeof borderRadius) => borderRadius[size];
export const getFontSize = (size: keyof typeof typography.fontSize) => typography.fontSize[size];
export const getShadow = (size: keyof typeof shadows) => shadows[size];

// Button style generator
export const createButtonStyle = (variant: 'default' | 'outline' | 'ghost' = 'default') => {
  const baseStyle = {
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    minHeight: 48,
  };

  switch (variant) {
    case 'outline':
      return {
        ...baseStyle,
        backgroundColor: 'transparent',
        borderWidth: 1,
        borderColor: colors.border.primary,
      };
    case 'ghost':
      return {
        ...baseStyle,
        backgroundColor: 'transparent',
      };
    default:
      return {
        ...baseStyle,
        backgroundColor: colors.primary[500],
        ...shadows.lg,
      };
  }
};

// Card style generator
export const createCardStyle = (variant: 'default' | 'elevated' = 'default') => {
  const baseStyle = {
    backgroundColor: colors.background.surface,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.border.muted,
  };

  if (variant === 'elevated') {
    return {
      ...baseStyle,
      ...shadows.xl,
      ...glassMorphism.medium,
    };
  }

  return {
    ...baseStyle,
    ...shadows.md,
  };
};

// Export the complete theme
export const theme = {
  colors,
  spacing,
  borderRadius,
  typography,
  shadows,
  glassMorphism,
  animations,
  // Helper functions
  getSpacing,
  getBorderRadius,
  getFontSize,
  getShadow,
  createButtonStyle,
  createCardStyle,
} as const;

export type Theme = typeof theme;
export type Colors = typeof colors;
export type Spacing = typeof spacing;
