/**
 * Navigation Layout Constants
 * 
 * These constants define the layout and spacing for the BottomNav component
 * to ensure consistent padding across all screens.
 */

/**
 * Total height of the BottomNav component (including off-screen portion)
 */
export const BOTTOM_NAV_TOTAL_HEIGHT = 120;

/**
 * How far the BottomNav is positioned off-screen (negative bottom value)
 */
export const BOTTOM_NAV_OFFSET = 50;

/**
 * Visible height of BottomNav above the screen bottom
 * (TOTAL_HEIGHT - OFFSET)
 */
export const BOTTOM_NAV_VISIBLE_HEIGHT = BOTTOM_NAV_TOTAL_HEIGHT - BOTTOM_NAV_OFFSET; // 70px

/**
 * Recommended minimum bottom padding for scrollable content
 * to ensure last items are visible above the nav.
 * This provides comfortable spacing above the visible nav portion.
 */
export const BOTTOM_NAV_SAFE_PADDING = 100;

/**
 * For screens with additional fixed bottom elements (like sticky action bars),
 * use this as the base offset and add your element height.
 * 
 * Example:
 * ```tsx
 * const STICKY_ACTIONS_HEIGHT = 64;
 * const totalPadding = BOTTOM_NAV_BASE_OFFSET + STICKY_ACTIONS_HEIGHT + insets.bottom;
 * ```
 */
export const BOTTOM_NAV_BASE_OFFSET = 60;
