// Design system tokens for BountyExpo
// Spy-themed emerald color palette with glass-morphism effects

export const colors = {
  // Primary emerald palette (spy-themed)
  primary: {
    50: '#ecfdf5',
    100: '#d1fae5',
    200: '#a7f3d0',
    300: '#6ee7b7',
    400: '#34d399',
    500: '#10b981', // Main brand color
    600: '#059669',
    700: '#047857',
    800: '#065f46',
    900: '#064e3b',
    950: '#052e1b',
  },
  
  // Background colors (darker emerald theme)
  background: {
    primary: '#0d4d35', // Main background
    secondary: '#10613e', // Header background
    surface: 'rgba(16, 97, 62, 0.75)', // Card surface
    overlay: 'rgba(16, 97, 62, 0.3)', // Glass-morphism overlay
  },
  
  // Text colors
  text: {
    primary: '#ffffff',
    secondary: 'rgba(255, 255, 255, 0.8)',
    muted: 'rgba(255, 255, 255, 0.6)',
    disabled: 'rgba(255, 255, 255, 0.4)',
  },
  
  // Status colors
  success: '#10b981',
  warning: '#f59e0b',
  error: '#dc2626',
  info: '#3b82f6',
  
  // Special colors
  gold: '#fbbf24', // For pricing, premium features
  
  // Border colors
  border: {
    default: 'rgba(16, 185, 129, 0.4)',
    muted: 'rgba(16, 185, 129, 0.2)',
    focus: '#10b981',
    error: '#dc2626',
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
  // Special glow effects
  glow: {
    shadowColor: colors.primary[500],
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
} as const;

export const glassMorphism = {
  light: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    backdropFilter: 'blur(10px)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  medium: {
    backgroundColor: 'rgba(16, 97, 62, 0.3)',
    backdropFilter: 'blur(15px)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  heavy: {
    backgroundColor: 'rgba(16, 97, 62, 0.6)',
    backdropFilter: 'blur(20px)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.4)',
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