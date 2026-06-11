import { palette } from './colors';
import type { AppTheme } from './types';

// Light theme — same Bounty brand identity, inverted surfaces.
// Green CTAs stay identical; accent icons shift to a darker green for contrast.
export const lightTheme: AppTheme = {
  foreground:        '#18181B',           // primary text/icons (matches text)
  accent1:           palette.green[600],  // #059669 — brand / CTA
  accent2:           palette.green[700],  // #047857 — highlight (darker for contrast)
  accent3:           '#3B82F6',           // informational (richer blue on light bg)

  background:        palette.navy[50],    // #F9FAFB — warm off-white page bg
  surface:           palette.white,       // #FFFFFF — pure white cards
  surfaceSecondary:  palette.navy[200],   // #E5E7EB — distinct from white surface

  border:            palette.navy[300],   // #D1D5DB — visible borders

  text:              '#18181B',           // near-neutral dark (zinc-900, no navy cast)
  textSecondary:     palette.navy[600],   // #4B5563
  textDisabled:      palette.navy[500],   // #6B7280

  primary:           palette.green[600],  // #059669 — same CTA green
  primaryLight:      palette.green[700],  // #047857 — darker for contrast on white
  overlay:           'rgba(0,0,0,0.05)',

  success:           palette.success,
  error:             palette.error,
  warning:           palette.warning,
  info:              '#3B82F6',           // slightly richer blue on light bg
  completed:         palette.completed,
  cancelled:         palette.cancelled,
  target:            palette.black,
  isDark: false,
   
};
