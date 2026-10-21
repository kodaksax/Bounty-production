import type { AppTheme } from './types';

/**
 * Track and thumb colors for every React Native <Switch>, so they all read
 * the same. The thumb is always white, like the platform's own: a thumb in
 * the brand color vanished into the "on" track (Post → Pay, Security), and a
 * surface-colored thumb went near-black on dark mode.
 *
 * Spread it onto the Switch: `<Switch {...switchColors(theme)} value=… />`.
 */
export function switchColors(theme: AppTheme) {
  return {
    trackColor: { false: theme.border, true: theme.primary },
    thumbColor: '#FFFFFF',
    ios_backgroundColor: theme.border,
  } as const;
}
