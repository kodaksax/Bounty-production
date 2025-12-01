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
  // Emerald theme
  EMERALD_50: '#ecfdf5',
  EMERALD_100: '#d5ecdc',
  EMERALD_200: '#aad9b8',
  EMERALD_300: '#80c795',      // Light text on dark bg (7.4:1 contrast)
  EMERALD_400: '#34d399',
  EMERALD_500: '#008e2a',      // Primary green (3.1:1 on white)
  EMERALD_600: '#008e2a',      // Darker green (4.6:1 on white)
  EMERALD_700: '#007523',      // AA compliant on white (6.4:1)
  EMERALD_800: '#005c1c',
  EMERALD_900: '#004315',
  
  // Background colors
  BG_DARK: '#0a1f14',          // Dark emerald background
  BG_DARK_SECONDARY: '#008e2a', // Slightly lighter bg
  BG_CARD: 'rgba(0, 117, 35, 0.1)', // Card background
  
  // Text colors (all AA compliant on dark backgrounds)
  TEXT_PRIMARY: '#ffffff',     // Off-white (>15:1 contrast on dark)
  TEXT_SECONDARY: '#d1d5db',   // Gray-300 (>10:1 contrast)
  TEXT_MUTED: '#9ca3af',       // Gray-400 (>6:1 contrast)
  TEXT_EMERALD: '#80c795',     // Emerald-300 (7.4:1 contrast)
  
  // Status colors
  ERROR: '#dc2626',            // Red-600
  WARNING: '#f59e0b',          // Amber-500
  SUCCESS: '#008e2a',          // Emerald-500
  INFO: '#3b82f6',             // Blue-500
  
  // Border colors
  BORDER_DEFAULT: '#374151',   // Gray-700
  BORDER_LIGHT: 'rgba(128, 199, 149, 0.2)', // Emerald with opacity
} as const;

// ============================================================================
// RADIUS / BORDER RADIUS SCALE
// ============================================================================

export const RADIUS = {
  SMALL: 4,
  DEFAULT: 8,
  MEDIUM: 12,
  LARGE: 16,
  PILL: 999,
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
