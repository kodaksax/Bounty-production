import { palette } from './colors';
import type { AppTheme } from './types';

// Light theme — same Bounty brand identity, inverted surfaces.
// Green CTAs stay identical; accent icons shift to a darker green for contrast.
export const lightTheme: AppTheme = {
  background:        palette.navy[50],    // #F9FAFB — warm off-white page bg
  surface:           palette.white,       // #FFFFFF — pure white cards
  surfaceSecondary:  palette.navy[100],   // #F3F4F6 — light gray inputs

  border:            palette.navy[200],   // #E5E7EB

  text:              palette.navy[900],   // #111827 — near-black primary text
  textSecondary:     palette.navy[500],   // #6B7280
  textDisabled:      palette.navy[400],   // #9CA3AF

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
