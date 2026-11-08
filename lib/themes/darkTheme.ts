import { palette } from './colors';
import { fonts, radius, shadows, spacing, textStyles, typography } from './tokens';
import type { AppTheme } from './types';

// Dark theme — warm graphite with #008E2A lead and #F1EBE3 text.
export const darkTheme: AppTheme = {
  foreground:        palette.cream,       // #F1EBE3 — primary text/icons
  accent1:           palette.green[600],  // #008E2A — brand / CTA
  accent2:           palette.green[500],  // #1FAE49 — highlight
  accent3:           '#6C9DBF',           // informational

  background:        palette.navy[950],   // #1B1E24
  surface:           palette.navy[900],   // #22262C
  surfaceSecondary:  palette.navy[800],   // #2A2E35
  surfaceRaised:     palette.navy[800],   // #2A2E35 — lifted above #1B1E24
  borderRaised:      palette.navy[700],   // #454952

  border:            palette.navy[700],   // #454952
  borderSubtle:      '#343840',           // card hairlines
  // One even hairline. Kept per-side because 24 styles spread this token.
  insetBorder: {
    borderTopColor:    '#343840',
    borderLeftColor:   '#343840',
    borderRightColor:  '#343840',
    borderBottomColor: '#343840',
  },

  text:              palette.cream,       // #F1EBE3
  textSecondary:     palette.navy[400],   // #A3A29C
  textDisabled:      '#6E7279',

  primary:           palette.green[600],  // #008E2A
  primaryLight:      palette.green[500],  // #1FAE49 — green text on dark
  primaryShade:      palette.green[700],  // #00701F — pressed fill
  primaryTint:       '#1C392C',
  onPrimary:         palette.white,
  errorShade:        '#A84E46',           // error #D9695F, ~25% darker
  overlay:           'rgba(241,235,227,0.1)',

  success:           palette.green[500],  // #1FAE49
  successText:       palette.green[400],  // #4CC46F, AA on the tint
  successTint:       '#1C392C',
  error:             '#D9695F',
  errorText:         '#E88A82',
  errorTint:         '#3A2628',
  warning:           '#D9A054',
  warningText:       '#E6B877',
  warningTint:       '#3A3022',
  info:              '#6C9DBF',
  infoText:          '#92B8D3',
  infoTint:          '#25323D',
  neutralTint:       palette.navy[800],
  completed:         palette.completed,
  cancelled:         palette.cancelled,
  target:            palette.brandCream,  // #D7CBBD
  isDark: true,

  spacing,
  radius,
  typography,
  textStyles,
  shadows,
  fonts,
};
