/**
 * Layout utilities
 *
 * Shared helpers for responsive layout, safe-area padding, and device
 * size detection.  Import from here to avoid scattering magic numbers
 * across screen files.
 */

import { Dimensions } from 'react-native';
import { SIZING } from '../constants/accessibility';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ============================================================================
// BREAKPOINTS
// ============================================================================

/** Named screen-width breakpoints (px) */
export const BREAKPOINTS = {
  /** Budget / compact Android phones */
  sm: 360,
  /** Standard iPhone (15, 15 Pro) */
  md: 390,
  /** Large iPhone (Pro Max) and large Android flagships */
  lg: 430,
  /** iPad / tablet */
  xl: 768,
} as const;

/** True when device width < 390 px (budget Android phones) */
export const isCompact = SCREEN_WIDTH < BREAKPOINTS.md;

/** True when device width >= 430 px (Pro Max / large Android) */
export const isWide = SCREEN_WIDTH >= BREAKPOINTS.lg;

/** True when device width >= 768 px (iPad / tablet) */
export const isTablet = SCREEN_WIDTH >= BREAKPOINTS.xl;

// ============================================================================
// SCROLL PADDING
// ============================================================================

/**
 * Minimum `paddingBottom` to apply to every scrollable screen container
 * so that content is not hidden behind the bottom navigation bar.
 *
 * Usage:
 *   <ScrollView contentContainerStyle={{ paddingBottom: SCROLL_BOTTOM_PADDING }} />
 */
export const SCROLL_BOTTOM_PADDING = SIZING.BOTTOM_NAV_HEIGHT + 16;

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Returns the larger of `value` and `BREAKPOINTS.sm`, ensuring a minimum
 * sensible size for any layout dimension.
 */
export const clampToMinWidth = (value: number): number =>
  Math.max(value, BREAKPOINTS.sm);
