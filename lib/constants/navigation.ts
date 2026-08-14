/**
 * Navigation Layout Constants
 *
 * Shared BottomNav geometry lives here so the floating bar and the screens that
 * need to clear it stay in sync.
 */

/**
 * Total height of the BottomNav component before safe-area padding is added.
 */
export const BOTTOM_NAV_TOTAL_HEIGHT = 110;

/**
 * How far the BottomNav is positioned off-screen (negative bottom value).
 */
export const BOTTOM_NAV_OFFSET = 50;

/**
 * Visible height of BottomNav above the screen bottom before safe-area padding.
 */
export const BOTTOM_NAV_VISIBLE_HEIGHT = BOTTOM_NAV_TOTAL_HEIGHT - BOTTOM_NAV_OFFSET; // 60px

/**
 * Minimum bottom padding to preserve spacing on devices without a home indicator.
 */
export const BOTTOM_NAV_MIN_SAFE_AREA_PADDING = 12;

/**
 * Default extra breathing room above the BottomNav for scrollable content.
 */
export const BOTTOM_NAV_DEFAULT_CONTENT_SPACING = 16;

/**
 * Minimum offset used by chat/composer surfaces that must clear the floating
 * center button even on devices without a bottom inset.
 */
export const BOTTOM_NAV_KEYBOARD_OFFSET = 96;

/**
 * Recommended minimum bottom padding for standard scrollable content.
 */
export const BOTTOM_NAV_SAFE_PADDING =
  BOTTOM_NAV_VISIBLE_HEIGHT +
  BOTTOM_NAV_MIN_SAFE_AREA_PADDING +
  BOTTOM_NAV_DEFAULT_CONTENT_SPACING;

/**
 * For screens with additional fixed bottom elements (like sticky action bars),
 * use this as the base offset and add your element height.
 */
export const BOTTOM_NAV_BASE_OFFSET = BOTTOM_NAV_VISIBLE_HEIGHT;

export function getBottomNavSafeAreaPadding(bottomInset = 0) {
  return Math.max(bottomInset, BOTTOM_NAV_MIN_SAFE_AREA_PADDING);
}

export function getBottomNavBarHeight(bottomInset = 0) {
  return BOTTOM_NAV_TOTAL_HEIGHT + Math.max(bottomInset, 0);
}

export function getBottomNavContentPadding(bottomInset = 0, extraPadding = 0) {
  return BOTTOM_NAV_VISIBLE_HEIGHT + getBottomNavSafeAreaPadding(bottomInset) + extraPadding;
}

export function getBottomNavKeyboardOffset(bottomInset = 0) {
  return Math.max(
    BOTTOM_NAV_KEYBOARD_OFFSET,
    Math.max(bottomInset, 0) + BOTTOM_NAV_MIN_SAFE_AREA_PADDING
  );
}
