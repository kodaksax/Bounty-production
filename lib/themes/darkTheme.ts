import { palette } from './colors';
import { fonts, radius, shadows, spacing, typography } from './tokens';
import type { AppTheme } from './types';

// Dark theme — the proposed warm graphite ramp (dark end) with #008E2A lead.
export const darkTheme: AppTheme = {
  foreground:        palette.cream,       // #E6DED1 — primary text/icons
  accent1:           palette.green[600],  // #008E2A — brand / CTA
  accent2:           palette.green[500],  // #1FAE49 — highlight
  accent3:           '#6C9DBF',           // informational

  background:        palette.navy[950],   // #1B1E24
  surface:           palette.navy[900],   // #22262C
  surfaceSecondary:  palette.navy[800],   // #2A2E35
  surfaceRaised:     palette.navy[800],   // #2A2E35 — lifted above #1B1E24
  borderRaised:      palette.navy[700],   // #454952

  border:            palette.navy[700],   // #454952

  text:              palette.cream,       // #E6DED1
  textSecondary:     palette.navy[500],   // #929497
  textDisabled:      palette.navy[600],   // #61656B

  primary:           palette.green[600],  // #008E2A
  primaryLight:      palette.green[500],  // #1FAE49
  overlay:           'rgba(230,222,209,0.1)',

  success:           palette.green[500],  // #1FAE49
  error:             '#D9695F',
  warning:           '#D9A054',
  info:              '#6C9DBF',
  completed:         palette.completed,
  cancelled:         palette.cancelled,
  target:            palette.cream,
  isDark: true,

  spacing,
  radius,
  typography,
  shadows,
  fonts,
};
