/**
 * Accessibility and Design System Constants
 * 
 * Centralized constants for spacing, sizing, and accessibility standards
 * to ensure consistency across all screens.
 */

// ============================================================================
// SPACING CONSTANTS
// ============================================================================

export const SPACING = {
  // Screen-level spacing
  SCREEN_HORIZONTAL: 16,      // Standard horizontal padding for screens
  SCREEN_VERTICAL: 24,        // Standard vertical spacing between sections
  
  // Element spacing
  ELEMENT_GAP: 12,            // Standard gap between related elements
  SECTION_GAP: 24,            // Gap between major sections
  COMPACT_GAP: 8,             // Compact spacing for tightly related items
  
  // Header spacing
  HEADER_TOP_OFFSET: 55,      // Standard header top offset
  HEADER_ICON_TO_TITLE: 8,    // Space between icon and title (e.g., BOUNTY icon + text)
  HEADER_VERTICAL: 12,        // Vertical padding within headers
  
  // Component spacing
  CARD_PADDING: 16,           // Standard padding inside cards
  BUTTON_PADDING_HORIZONTAL: 24,
  BUTTON_PADDING_VERTICAL: 12,
  
  // List spacing
  LIST_ITEM_GAP: 2,           // Gap between list items
  LIST_SECTION_GAP: 12,       // Gap between list sections
} as const;

// ============================================================================
// SIZING CONSTANTS
// ============================================================================

export const SIZING = {
  // Touch targets (meet WCAG 2.5.5 guidelines)
  MIN_TOUCH_TARGET: 44,       // Minimum 44x44 touch target
  COMFORTABLE_TOUCH_TARGET: 48, // Comfortable touch target for primary actions
  
  // Button heights
  BUTTON_HEIGHT_DEFAULT: 48,
  BUTTON_HEIGHT_COMPACT: 40,
  BUTTON_HEIGHT_LARGE: 56,
  
  // Icon sizes
  ICON_SMALL: 16,
  ICON_MEDIUM: 20,
  ICON_LARGE: 24,
  ICON_XLARGE: 32,
  
  // Avatar sizes
  AVATAR_SMALL: 32,
  AVATAR_MEDIUM: 48,
  AVATAR_LARGE: 80,
  AVATAR_XLARGE: 96,
  
  // Header sizes
  HEADER_EXPANDED: 160,
  HEADER_COLLAPSED: 60,
  
  // Bottom navigation
  BOTTOM_NAV_HEIGHT: 60,
} as const;

// ============================================================================
// TYPOGRAPHY CONSTANTS
// ============================================================================

export const TYPOGRAPHY = {
  // Font sizes (support dynamic scaling)
  SIZE_XLARGE: 24,
  SIZE_LARGE: 20,
  SIZE_HEADER: 18,
  SIZE_BODY: 16,
  SIZE_DEFAULT: 15,
  SIZE_SMALL: 14,
  SIZE_XSMALL: 12,
  SIZE_TINY: 11,
  
  // Line heights (comfortable reading)
  LINE_HEIGHT_TIGHT: 1.2,
  LINE_HEIGHT_NORMAL: 1.5,
  LINE_HEIGHT_RELAXED: 1.7,
  
  // Letter spacing
  LETTER_SPACING_TIGHT: -0.5,
  LETTER_SPACING_NORMAL: 0,
  LETTER_SPACING_WIDE: 0.5,
  LETTER_SPACING_WIDER: 1,
} as const;

// ============================================================================
// COLOR CONSTANTS (with contrast ratios)
// ============================================================================

export const COLORS = {
  // Emerald theme - primary brand colors
  EMERALD_50: '#ecfdf5',
  EMERALD_100: '#d1fae5',
  EMERALD_200: '#a7f3d0',
  EMERALD_300: '#6ee7b7',      // Light text on dark bg (7.4:1 contrast)
  EMERALD_400: '#34d399',
  EMERALD_500: '#10b981',      // Primary green (3.1:1 on white)
  EMERALD_600: '#059669',      // Darker green (4.6:1 on white) - Main app background
  EMERALD_700: '#047857',      // AA compliant on white (6.4:1) - Card backgrounds
  EMERALD_800: '#065f46',      // Surface elements
  EMERALD_900: '#064e3b',      // Darkest emerald
  EMERALD_950: '#022c22',      // Ultra dark for overlays
  
  // Semantic background colors
  BG_PRIMARY: '#059669',       // emerald-600 - Main app background
  BG_SECONDARY: '#047857',     // emerald-700 - Card backgrounds
  BG_SURFACE: '#065f46',       // emerald-800 - Surface elements
  BG_OVERLAY: 'rgba(2, 44, 34, 0.55)', // emerald-950 with opacity
  BG_DARK: '#022c22',          // emerald-950 - Ultra dark overlays
  BG_CARD: 'rgba(4, 120, 87, 0.3)', // emerald-700 with opacity
  
  // Text colors (all AA compliant on dark backgrounds)
  TEXT_PRIMARY: '#fffef5',     // Off-white (>15:1 contrast on dark)
  TEXT_SECONDARY: '#d1fae5',   // emerald-100 (>10:1 contrast)
  TEXT_MUTED: '#a7f3d0',       // emerald-200 (>6:1 contrast)
  TEXT_ACCENT: '#6ee7b7',      // emerald-300 (7.4:1 contrast)
  TEXT_DISABLED: 'rgba(209, 250, 229, 0.5)', // emerald-100 at 50% opacity
  
  // Status colors
  ERROR: '#dc2626',            // Red-600
  ERROR_LIGHT: '#fca5a5',      // Red-300
  WARNING: '#f59e0b',          // Amber-500
  WARNING_LIGHT: '#fcd34d',    // Amber-300
  SUCCESS: '#10b981',          // Emerald-500
  SUCCESS_LIGHT: '#6ee7b7',    // Emerald-300
  INFO: '#3b82f6',             // Blue-500
  INFO_LIGHT: '#93c5fd',       // Blue-300
  
  // Border colors
  BORDER_DEFAULT: '#047857',   // emerald-700
  BORDER_LIGHT: '#6ee7b7',     // emerald-300
  BORDER_DARK: '#022c22',      // emerald-950
  BORDER_SUBTLE: 'rgba(110, 231, 183, 0.2)', // emerald-300 with opacity
  
  // Interactive colors
  INTERACTIVE_DEFAULT: '#10b981',  // emerald-500
  INTERACTIVE_HOVER: '#059669',    // emerald-600
  INTERACTIVE_ACTIVE: '#047857',   // emerald-700
  INTERACTIVE_DISABLED: 'rgba(16, 185, 129, 0.4)', // emerald-500 at 40% opacity
} as const;

// ============================================================================
// BORDER RADIUS CONSTANTS
// ============================================================================

export const RADIUS = {
  NONE: 0,
  XS: 4,
  SM: 8,
  MD: 12,
  LG: 16,
  XL: 24,
  XXL: 32,
  FULL: 9999,
} as const;

// ============================================================================
// SHADOW/ELEVATION CONSTANTS
// ============================================================================

export const SHADOWS = {
  NONE: {
    shadowColor: 'transparent',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
  },
  SM: {
    shadowColor: '#059669',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 2,
    elevation: 2,
  },
  MD: {
    shadowColor: '#059669',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 4,
  },
  LG: {
    shadowColor: '#059669',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 15,
    elevation: 8,
  },
  XL: {
    shadowColor: '#059669',
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.3,
    shadowRadius: 25,
    elevation: 12,
  },
  GLOW: {
    shadowColor: '#059669',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 20,
    elevation: 6,
  },
} as const;

// ============================================================================
// ACCESSIBILITY CONSTANTS
// ============================================================================

export const A11Y = {
  // Contrast ratios
  CONTRAST_MIN_TEXT: 4.5,      // WCAG AA for normal text
  CONTRAST_MIN_LARGE_TEXT: 3.0, // WCAG AA for large text (18pt+)
  CONTRAST_MIN_UI: 3.0,         // WCAG AA for UI components
  
  // Animation durations (comfortable, not too fast)
  ANIMATION_FAST: 150,
  ANIMATION_NORMAL: 250,
  ANIMATION_SLOW: 400,
  
  // Timing for user feedback
  HAPTIC_LIGHT: 'light',
  HAPTIC_MEDIUM: 'medium',
  HAPTIC_HEAVY: 'heavy',
  
  // Accessible roles
  ROLES: {
    BUTTON: 'button',
    LINK: 'link',
    HEADER: 'header',
    TEXT: 'text',
    IMAGE: 'image',
    SEARCH: 'search',
    MENU: 'menu',
    MENUITEM: 'menuitem',
  },
} as const;

// ============================================================================
// STANDARD HEADER LAYOUT
// ============================================================================

/**
 * Standard header configuration used across screens
 * Ensures consistent positioning of title, icon, and balance
 */
export const HEADER_LAYOUT = {
  // Icon and title alignment
  iconSize: SIZING.ICON_LARGE,
  iconToTitleGap: SPACING.HEADER_ICON_TO_TITLE,
  titleFontSize: TYPOGRAPHY.SIZE_LARGE,
  
  // Balance display (right side)
  balanceFontSize: TYPOGRAPHY.SIZE_BODY,
  
  // Vertical spacing
  verticalPadding: SPACING.HEADER_VERTICAL,
  topOffset: SPACING.HEADER_TOP_OFFSET,
  
  // Heights
  expandedHeight: SIZING.HEADER_EXPANDED,
  collapsedHeight: SIZING.HEADER_COLLAPSED,
} as const;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get accessible font size that respects system text size settings
 */
export const getAccessibleFontSize = (baseFontSize: number, scale = 1): number => {
  return Math.round(baseFontSize * scale);
};

/**
 * Ensure minimum touch target size
 */
export const ensureTouchTarget = (size: number): number => {
  return Math.max(size, SIZING.MIN_TOUCH_TARGET);
};

/**
 * Calculate appropriate line height for font size
 */
export const getLineHeight = (fontSize: number): number => {
  return Math.round(fontSize * TYPOGRAPHY.LINE_HEIGHT_NORMAL);
};
