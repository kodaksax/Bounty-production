// Mode-independent layout tokens — spacing/radius/typography/shadows are the
// same in light and dark mode; only colors (see colors.ts) vary by mode.
// Consumed via AppTheme (see types.ts) so screens can do `theme.spacing.lg`
// instead of hardcoding pixel values.

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

export const radius = {
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  '2xl': 24,
  full: 9999,
} as const;

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

/**
 * Text roles. Spread into a style, then add a colour:
 * `{ ...theme.textStyles.title, color: theme.text }`.
 * Twelve points is the floor for anything a person has to read.
 */
export const textStyles = {
  display: { fontSize: 32, lineHeight: 38, fontWeight: '800' as const, letterSpacing: -0.6 },
  title: { fontSize: 24, lineHeight: 30, fontWeight: '700' as const, letterSpacing: -0.3 },
  heading: { fontSize: 20, lineHeight: 26, fontWeight: '700' as const, letterSpacing: -0.2 },
  headline: { fontSize: 17, lineHeight: 22, fontWeight: '600' as const },
  body: { fontSize: 15, lineHeight: 22, fontWeight: '400' as const },
  label: { fontSize: 14, lineHeight: 20, fontWeight: '600' as const },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '400' as const },
  micro: { fontSize: 12, lineHeight: 16, fontWeight: '500' as const },
  amount: { fontSize: 28, lineHeight: 34, fontWeight: '800' as const, letterSpacing: -0.5 },
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
  // Formerly a green glow under buttons. Flat now; the token stays so the
  // styles that spread it don't all have to change at once.
  brand: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
  },
} as const;

// App typeface — Inter, loaded in app/_layout.tsx and applied to every
// <Text>/<TextInput> by applyGlobalFont.ts. Custom fonts don't synthesize
// weights, so each weight is its own family.
export const fonts = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
  extrabold: 'Inter_800ExtraBold',
  mono: 'SpaceMono',
} as const;

export function fontForWeight(weight?: string | number): string {
  const w = weight === 'bold' ? 700 : Number(weight) || 400;
  if (w >= 800) return fonts.extrabold;
  if (w >= 700) return fonts.bold;
  if (w >= 600) return fonts.semibold;
  if (w >= 500) return fonts.medium;
  return fonts.regular;
}

export type Fonts = typeof fonts;
export type Spacing = typeof spacing;
export type Radius = typeof radius;
export type Typography = typeof typography;
export type TextStyles = typeof textStyles;
export type Shadows = typeof shadows;
