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
export const BOTTOM_NAV_VISIBLE_HEIGHT = BOTTOM_NAV_TOTAL_HEIGHT - BOTTOM_NAV_OFFSET;

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
 * For screens with additional fixed bottom elements (like sticky action bars),
 * use this as the base offset and add your element height. Intentionally an
 * alias of `BOTTOM_NAV_VISIBLE_HEIGHT` so existing callers can migrate away
 * from local magic numbers without changing their semantics.
 */
export const BOTTOM_NAV_BASE_OFFSET = BOTTOM_NAV_VISIBLE_HEIGHT;

/**
 * Returns the bottom padding the BottomNav itself should reserve for the device
 * safe area. `bottomInset` is the current `useSafeAreaInsets().bottom` value.
 */
export function getBottomNavSafeAreaPadding(bottomInset = 0) {
  return Math.max(bottomInset, BOTTOM_NAV_MIN_SAFE_AREA_PADDING);
}

/**
 * Returns the baseline clearance content needs above the floating BottomNav.
 * `minimumBottomPadding` lets callers preserve screen-specific minimum spacing.
 */
export function getBottomNavBaseClearance(
  bottomInset = 0,
  minimumBottomPadding = BOTTOM_NAV_MIN_SAFE_AREA_PADDING
) {
  return BOTTOM_NAV_VISIBLE_HEIGHT + Math.max(bottomInset, minimumBottomPadding);
}

/**
 * Returns the total BottomNav height after adding any device bottom inset.
 * `bottomInset` is the current `useSafeAreaInsets().bottom` value.
 */
export function getBottomNavBarHeight(bottomInset = 0) {
  return BOTTOM_NAV_TOTAL_HEIGHT + Math.max(bottomInset, 0);
}

/**
 * Returns the padding content should add to stay clear of the floating
 * BottomNav. `extraPadding` defaults to the standard 16px breathing room.
 */
export function getBottomNavContentPadding(
  bottomInset = 0,
  extraPadding = BOTTOM_NAV_DEFAULT_CONTENT_SPACING,
  minimumBottomPadding = BOTTOM_NAV_MIN_SAFE_AREA_PADDING
) {
  return getBottomNavBaseClearance(bottomInset, minimumBottomPadding) + extraPadding;
}

/**
 * Deprecated fixed fallback for callers that cannot access insets. Prefer
 * `getBottomNavContentPadding(bottomInset)` so the value adapts per device.
 */
export const BOTTOM_NAV_SAFE_PADDING = getBottomNavContentPadding(0);

/**
 * Returns the minimum keyboard/composer offset needed to clear the floating
 * center button and the device safe area.
 */
export function getBottomNavKeyboardOffset(bottomInset = 0) {
  return Math.max(
    BOTTOM_NAV_KEYBOARD_OFFSET,
    bottomInset + BOTTOM_NAV_MIN_SAFE_AREA_PADDING
  );
}
