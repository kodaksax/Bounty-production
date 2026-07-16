import { palette } from './colors';
import { radius, shadows, spacing, typography } from './tokens';
import type { AppTheme } from './types';

export const darkTheme: AppTheme = {
  foreground:        palette.white,       // #FFFFFF — primary text/icons
  accent1:           palette.green[600],  // #059669 — brand / CTA
  accent2:           palette.green[300],  // #6ee7b7 — highlight
  accent3:           palette.info,        // #60A5FA — informational

  background:        palette.navy[950],   // #0B0F14
  surface:           palette.navy[900],   // #111827
  surfaceSecondary:  palette.navy[800],   // #1F2937

  border:            palette.navy[700],   // #374151

  text:              palette.white,       // #FFFFFF
  textSecondary:     palette.navy[400],   // #9CA3AF
  textDisabled:      palette.navy[500],   // #6B7280

  primary:           palette.green[600],  // #059669
  primaryLight:      palette.green[300],  // #6ee7b7
  overlay:           'rgba(255,255,255,0.1)',

  success:           palette.success,
  error:             palette.error,
  warning:           palette.warning,
  info:              palette.info,
  completed:         palette.completed,
  cancelled:         palette.cancelled,
  target:            palette.white,
  isDark: true,

  spacing,
  radius,
  typography,
  shadows,
};
