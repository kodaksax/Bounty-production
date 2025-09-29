// Design system tokens for BountyExpo
// Spy-themed emerald color palette with glass-morphism effects

export const colors = {
  // Primary green palette (company branding)
  primary: {
    50: '#e6f7ec',
    100: '#ccefda',
    200: '#99deb4',
    300: '#66ce8f',
    400: '#33bd69',
    500: '#00912C', // Main brand color - company specified
    600: '#007423',
    700: '#00571a',
    800: '#003a12',
    900: '#001d09',
    950: '#000e04',
  },
  
  // Background colors (darker green theme aligned with branding)
  background: {
    primary: '#1a3d2e', // Main background - darker tone of primary
    secondary: '#2d5240', // Header background - complementary to primary
    surface: 'rgba(45, 82, 64, 0.75)', // Card surface
    overlay: 'rgba(45, 82, 64, 0.3)', // Glass-morphism overlay
  },
  
  // Text colors (using company specified header text color)
  text: {
    primary: '#fffef5', // Company specified header text/logos color
    secondary: 'rgba(255, 254, 245, 0.8)', // Derived from primary text
    muted: 'rgba(255, 254, 245, 0.6)', // Derived from primary text
    disabled: 'rgba(255, 254, 245, 0.4)', // Derived from primary text
    // Trim colors for secondary content
    trim: '#61656b', // Company specified trim color
    highlight: '#929497', // Company specified highlight color
    subtle: '#c3c3c4', // Company specified subtle highlight color
  },
  
  // Status colors (maintaining functionality with brand-aligned tones)
  success: '#00912C', // Using primary brand color for success
  warning: '#f59e0b',
  error: '#dc2626',
  info: '#3b82f6',
  
  // Special colors
  gold: '#fbbf24', // For pricing, premium features
  
  // Border colors (aligned with new primary)
  border: {
    default: 'rgba(0, 145, 44, 0.4)', // Using primary brand color
    muted: 'rgba(0, 145, 44, 0.2)', // Using primary brand color
    focus: '#00912C', // Primary brand color
    error: '#dc2626',
    trim: '#61656b', // Company specified trim color
  },
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  '2xl': 24,
  '3xl': 32,
  '4xl': 40,
  '5xl': 48,
  '6xl': 64,
} as const;

export const borderRadius = {
  xs: 4,
  sm: 6,
  md: 8,
  lg: 12,
  xl: 16,
  '2xl': 20,
  '3xl': 24,
  full: 999,
} as const;

export const typography = {
  fontSize: {
    xs: 12,
    sm: 14,
    base: 15,
    lg: 16,
    xl: 18,
    '2xl': 20,
    '3xl': 24,
    '4xl': 30,
    '5xl': 36,
  },
  fontWeight: {
    normal: '400' as const,
    medium: '500' as const,
    semibold: '600' as const,
    bold: '700' as const,
    extrabold: '800' as const,
  },
  lineHeight: {
    tight: 1.2,
    normal: 1.4,
    relaxed: 1.6,
  },
  letterSpacing: {
    tight: -0.5,
    normal: 0,
    wide: 0.3,
    wider: 0.5,
  },
} as const;

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
    elevation: 2,
  },
  lg: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  xl: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 8,
  },
  // Special glow effects (updated for new brand colors)
  glow: {
    shadowColor: colors.primary[500], // Using new primary brand color
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
} as const;

export const glassMorphism = {
  light: {
    backgroundColor: 'rgba(255, 254, 245, 0.1)', // Using brand header text color
    backdropFilter: 'blur(10px)',
    borderWidth: 1,
    borderColor: 'rgba(255, 254, 245, 0.2)',
  },
  medium: {
    backgroundColor: 'rgba(45, 82, 64, 0.3)', // Using new background secondary
    backdropFilter: 'blur(15px)',
    borderWidth: 1,
    borderColor: 'rgba(0, 145, 44, 0.3)', // Using new primary brand color
  },
  heavy: {
    backgroundColor: 'rgba(45, 82, 64, 0.6)', // Using new background secondary
    backdropFilter: 'blur(20px)',
    borderWidth: 1,
    borderColor: 'rgba(0, 145, 44, 0.4)', // Using new primary brand color
  },
} as const;

export const animations = {
  duration: {
    fast: 150,
    normal: 200,
    slow: 300,
  },
  easing: {
    ease: 'ease',
    easeIn: 'ease-in',
    easeOut: 'ease-out',
    easeInOut: 'ease-in-out',
  },
} as const;

// Utility functions
export const getSpacing = (size: keyof typeof spacing) => spacing[size];
export const getBorderRadius = (size: keyof typeof borderRadius) => borderRadius[size];
export const getFontSize = (size: keyof typeof typography.fontSize) => typography.fontSize[size];
export const getShadow = (size: keyof typeof shadows) => shadows[size];

// Theme-aware style generators
export const createButtonStyle = (variant: 'primary' | 'secondary' | 'outline' = 'primary') => {
  const baseStyle = {
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    ...shadows.lg,
  };

  switch (variant) {
    case 'primary':
      return {
        ...baseStyle,
        backgroundColor: colors.primary[500],
        borderWidth: 1,
        borderColor: colors.border.default,
        ...shadows.glow,
      };
    case 'secondary':
      return {
        ...baseStyle,
        backgroundColor: colors.background.surface,
        borderWidth: 1,
        borderColor: colors.border.muted,
      };
    case 'outline':
      return {
        ...baseStyle,
        backgroundColor: 'transparent',
        borderWidth: 1.5,
        borderColor: colors.border.focus,
      };
    default:
      return baseStyle;
  }
};

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