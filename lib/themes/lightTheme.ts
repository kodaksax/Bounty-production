import { palette } from './colors';
import { fonts, radius, shadows, spacing, textStyles, typography } from './tokens';
import type { AppTheme } from './types';

// Light theme — #008E2A green leads on warm cream: #F1EBE3 screens, white
// cards, #D7CBBD lines, graphite text.
export const lightTheme: AppTheme = {
  foreground:        palette.ink,         // #31363F — primary text/icons
  accent1:           palette.green[600],  // #008E2A — brand / CTA (lead)
  accent2:           palette.green[700],  // #00701F — highlight (lead-deep)
  accent3:           palette.berry[500],  // #B81E8A — contrast (urgent, alerts)

  background:        palette.navy[200],   // #F1EBE3 — warm cream screen
  surface:           palette.white,       // #FFFFFF — cards
  surfaceSecondary:  palette.navy[100],   // #E9E1D6 — inputs, secondary surfaces
  surfaceRaised:     palette.navy[50],    // #FBF8F3 — tab bar, search bar
  borderRaised:      palette.navy[300],   // #D7CBBD

  border:            palette.navy[300],   // #D7CBBD
  borderSubtle:      '#E6DCCF',           // card hairlines
  // One even hairline. Kept per-side because 24 styles spread this token.
  insetBorder: {
    borderTopColor:    '#E6DCCF',
    borderLeftColor:   '#E6DCCF',
    borderRightColor:  '#E6DCCF',
    borderBottomColor: '#E6DCCF',
  },

  text:              palette.ink,         // #31363F
  textSecondary:     palette.navy[600],   // #5A5E65
  textDisabled:      palette.navy[500],   // #929497

  primary:           palette.green[600],  // #008E2A — fills, icons, active states
  primaryLight:      palette.green[700],  // #00701F — green text (AA on cream)
  primaryShade:      palette.green[700],  // #00701F — pressed fill
  primaryTint:       '#E3F1E5',
  onPrimary:         palette.white,
  errorShade:        '#933730',           // error #C24A42, ~25% darker
  overlay:           'rgba(49,54,63,0.05)',

  success:           palette.success,     // #008E2A
  successText:       palette.green[700],
  successTint:       '#E3F1E5',
  error:             palette.error,
  errorText:         '#A33A33',
  errorTint:         '#F8E4E1',
  warning:           palette.warning,
  warningText:       '#8A5A14',
  warningTint:       '#F7EAD2',
  info:              palette.info,
  infoText:          '#335C7C',
  infoTint:          '#DFEAF2',
  neutralTint:       palette.navy[100],
  completed:         palette.completed,
  cancelled:         palette.cancelled,
  target:            palette.ink,
  isDark: false,

  spacing,
  radius,
  typography,
  textStyles,
  shadows,
  fonts,
};
