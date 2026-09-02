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

/**
 * How far BottomNav's buttons are lifted out of the bar's own box (the
 * `marginTop` on `navButton` / `centerButton`). The crosshair is *not*
 * contained by the bar: it floats above the bar's top edge, so screens that
 * only clear `getBottomNavBaseClearance` still get their centered content
 * covered by it.
 */
export const BOTTOM_NAV_ITEM_LIFT = 28;

/** The center button scales up by this factor while the bounty tab is active. */
export const BOTTOM_NAV_CENTER_ACTIVE_SCALE = 1.15;

/** Horizontal breathing room between the center column and the side sections. */
export const BOTTOM_NAV_CENTER_GUTTER = 8;

/**
 * The center button is sized as a share of the viewport width, clamped at both
 * ends: below the minimum the icon crowds its border, above the maximum it
 * dominates the bar.
 */
export const BOTTOM_NAV_CENTER_WIDTH_RATIO = 0.17;
export const BOTTOM_NAV_CENTER_MIN_SIZE = 56;
export const BOTTOM_NAV_CENTER_MAX_SIZE = 72;

/**
 * Center-button geometry, derived from the viewport rather than hardcoded so
 * the crosshair keeps the same visual weight from a 320pt SE up to a 430pt Pro
 * Max. `sectionWidth` reserves the *scaled* footprint plus a gutter so the side
 * sections are never laid out underneath the active (enlarged) button.
 *
 * Shared with the screens that must clear the bar — see
 * `getBottomNavOccludedHeight`.
 */
export function getBottomNavCenterMetrics(windowWidth = 0) {
  const buttonSize = Math.round(
    Math.min(
      BOTTOM_NAV_CENTER_MAX_SIZE,
      Math.max(BOTTOM_NAV_CENTER_MIN_SIZE, windowWidth * BOTTOM_NAV_CENTER_WIDTH_RATIO)
    )
  );
  const sectionWidth =
    Math.ceil(buttonSize * BOTTOM_NAV_CENTER_ACTIVE_SCALE) + BOTTOM_NAV_CENTER_GUTTER;
  return { buttonSize, sectionWidth };
}

/**
 * How far the floating center button rises above the bar's top edge, mirroring
 * BottomNav's own layout: the button is centered in the bar's content box (bar
 * height minus its safe-area padding), then lifted by BOTTOM_NAV_ITEM_LIFT and
 * scaled for the active state. Returns 0 when it stays inside the bar.
 */
export function getBottomNavCenterOverhang(bottomInset = 0, windowWidth = 0) {
  const contentHeight =
    getBottomNavBarHeight(bottomInset) - getBottomNavSafeAreaPadding(bottomInset);
  const { buttonSize } = getBottomNavCenterMetrics(windowWidth);
  const scaledSize = buttonSize * BOTTOM_NAV_CENTER_ACTIVE_SCALE;
  const buttonTop = (contentHeight - scaledSize) / 2 - BOTTOM_NAV_ITEM_LIFT;
  return Math.max(0, Math.ceil(-buttonTop));
}

/**
 * Total height the BottomNav actually occludes: the bar itself *plus* the
 * floating center button that overhangs it. Screens with a fixed bottom CTA
 * should clear this, not `getBottomNavBaseClearance` — anything centered
 * horizontally (a link row under a CTA, say) otherwise lands under the
 * crosshair.
 */
export function getBottomNavOccludedHeight(
  bottomInset = 0,
  windowWidth = 0,
  minimumBottomPadding = BOTTOM_NAV_MIN_SAFE_AREA_PADDING
) {
  return (
    getBottomNavBaseClearance(bottomInset, minimumBottomPadding) +
    getBottomNavCenterOverhang(bottomInset, windowWidth)
  );
}

/**
 * Gap between a screen's bottom-most control and the top of the BottomNav,
 * scaled to the viewport height so it reads the same on a short SE as on a tall
 * Pro Max. Clamped so it never collapses or eats the layout.
 */
export const BOTTOM_NAV_GAP_HEIGHT_RATIO = 0.02;
export const BOTTOM_NAV_MIN_GAP = 12;
export const BOTTOM_NAV_MAX_GAP = 24;

export function getBottomNavContentGap(windowHeight = 0) {
  return Math.round(
    Math.min(BOTTOM_NAV_MAX_GAP, Math.max(BOTTOM_NAV_MIN_GAP, windowHeight * BOTTOM_NAV_GAP_HEIGHT_RATIO))
  );
}
