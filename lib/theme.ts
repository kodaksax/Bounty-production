// Design system tokens for BountyExpo
// Legacy tokens — mirrors lib/themes (use useAppTheme() in new code)

export const colors = {
  // Primary green palette (company branding) — #008E2A leads.
  // Mirrors lib/themes/colors.ts, the source of truth.
  primary: {
    50: '#EDF8F0',
    100: '#DBF0E1',
    200: '#B5E3C2',
    300: '#1FAE49',
    400: '#1FAE49',
    500: '#008E2A', // Main brand color - matches lib/themes green
    600: '#00701F',
    700: '#00571A',
    800: '#00410F',
    900: '#002E0E',
    950: '#001D09',
  },

  // Background colors (warm graphite dark theme)
  background: {
    primary: '#1B1E24', // Main background - page/screen
    secondary: '#22262C', // Section/card/modal background
    surface: '#2A2E35', // Input/secondary interactive background
    elevated: '#22262C', // Modal/elevated surface
  },

  // Text colors
  text: {
    primary: '#E6DED1',
    secondary: '#929497',
    muted: '#61656B',
    inverse: '#31363F',
  },

  // Border colors
  border: {
    primary: '#454952',
    muted: '#454952',
    strong: '#454952',
  },

  // Status colors
  success: '#1FAE49',
  warning: '#D9A054',
  error: '#D9695F',
  info: '#6C9DBF',
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

// Shadow presets with emerald glow
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
  emerald: {
    shadowColor: '#008E2A', // matches lib/themes brand green
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 6,
  },
} as const;

// Glass morphism effects
export const glassMorphism = {
  light: {
    backgroundColor: 'rgba(34, 38, 44, 0.6)',
    backdropFilter: 'blur(10px)',
  },
  medium: {
    backgroundColor: 'rgba(34, 38, 44, 0.75)',
    backdropFilter: 'blur(20px)',
  },
  heavy: {
    backgroundColor: 'rgba(34, 38, 44, 0.85)',
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
        ...shadows.emerald,
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
