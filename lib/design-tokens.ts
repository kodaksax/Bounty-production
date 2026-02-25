/**
 * Design Tokens — Unified barrel export
 *
 * Single import point for all design system constants.
 * Import from here instead of importing from `lib/theme` and
 * `lib/constants/accessibility` separately.
 *
 * Usage:
 *   import { colors, spacing, SIZING, TYPOGRAPHY } from 'lib/design-tokens';
 */

// Theme tokens (colors, spacing, typography, shadows, glass-morphism, animations)
export {
  colors,
  spacing,
  borderRadius,
  typography,
  shadows,
  glassMorphism,
  animations,
  getSpacing,
  getBorderRadius,
  getFontSize,
  getShadow,
  createButtonStyle,
  createCardStyle,
  theme,
} from './theme';

export type { Theme, Colors, Spacing } from './theme';

// Accessibility + layout constants (SPACING, SIZING, TYPOGRAPHY, COLORS, RADIUS, A11Y, HEADER_LAYOUT)
export {
  SPACING,
  SIZING,
  TYPOGRAPHY,
  COLORS,
  RADIUS,
  A11Y,
  HEADER_LAYOUT,
  getAccessibleFontSize,
  ensureTouchTarget,
  getLineHeight,
} from './constants/accessibility';
