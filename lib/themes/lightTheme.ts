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

  text:              palette.ink,         // #31363F
  textSecondary:     palette.navy[600],   // #61656B
  textDisabled:      palette.navy[500],   // #929497

  primary:           palette.green[600],  // #008E2A
  primaryLight:      palette.green[700],  // #00701F — darker for contrast on cream
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
