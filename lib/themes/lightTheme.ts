import { palette } from './colors';
import { fonts, radius, shadows, spacing, typography } from './tokens';
import type { AppTheme } from './types';

// Light theme — "01 Complementary": #008E2A green leads, berry #B81E8A is the
// contrast accent, warm cream screens with white cards and graphite text.
export const lightTheme: AppTheme = {
  foreground:        palette.ink,         // #31363F — primary text/icons
  accent1:           palette.green[600],  // #008E2A — brand / CTA (lead)
  accent2:           palette.green[700],  // #00701F — highlight (lead-deep)
  accent3:           palette.berry[500],  // #B81E8A — contrast (urgent, alerts)

  background:        palette.navy[200],   // #E6DED1 — warm cream screen
  surface:           palette.white,       // #FFFFFF — cards
  surfaceSecondary:  palette.navy[100],   // #F4F1EC — inputs, secondary surfaces
  surfaceRaised:     palette.navy[100],   // #F4F1EC — cream white, same as the search bar / tab bar
  borderRaised:      palette.navy[300],   // #D8D2C4

  border:            palette.navy[300],   // #D8D2C4
  insetBorder: {
    borderTopColor:    '#B8AE9C',           // dark top edge
    borderLeftColor:   palette.navy[300],   // #D8D2C4
    borderRightColor:  palette.navy[300],
    borderBottomColor: palette.white,       // light bottom edge
  },
  insetBorderStrong: {
    borderTopColor:    '#8F8470',           // dark top edge
    borderLeftColor:   '#B3A994',
    borderRightColor:  '#B3A994',
    borderBottomColor: palette.white,       // light bottom edge
  },
  insetBorderPrimary: {
    borderTopColor:    palette.green[800],  // #00571A — dark top edge
    borderLeftColor:   palette.green[700],  // #00701F
    borderRightColor:  palette.green[700],
    borderBottomColor: palette.green[500],  // #1FAE49 — light bottom edge
  },

  text:              palette.ink,         // #31363F
  textSecondary:     palette.navy[600],   // #61656B
  textDisabled:      palette.navy[500],   // #929497

  primary:           palette.green[600],  // #008E2A
  primaryLight:      palette.green[700],  // #00701F — darker for contrast on cream
  primaryShade:      palette.green[700],  // #00701F — button depth band
  errorShade:        '#933730',           // error #C24A42, ~25% darker
  overlay:           'rgba(49,54,63,0.05)',

  success:           palette.success,     // #008E2A
  error:             palette.error,
  warning:           palette.warning,
  info:              palette.info,
  completed:         palette.completed,
  cancelled:         palette.cancelled,
  target:            palette.ink,
  isDark: false,

  spacing,
  radius,
  typography,
  shadows,
  fonts,
};
