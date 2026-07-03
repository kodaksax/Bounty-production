/**
 * Primary theme hook for all new code.
 *
 * Returns the active AppTheme token set alongside mode controls.
 *
 * @example
 * const { theme, isDark, toggleTheme } = useAppTheme();
 *
 * const styles = StyleSheet.create({
 *   container: { backgroundColor: theme.background },
 *   card:      { backgroundColor: theme.surface, borderColor: theme.border },
 *   text:      { color: theme.foreground },
 *   cta:       { backgroundColor: theme.accent1 },
 * });
 *
 * High-level customization knobs (tweak these to restyle the whole app):
 *   theme.foreground  — primary text / icon color
 *   theme.background  — page / screen background
 *   theme.accent1     — brand / CTA accent
 *   theme.accent2     — highlight accent
 *   theme.accent3     — informational accent
 */
export { useAppThemeContext as useAppTheme } from '../lib/themes/AppThemeContext';
export type { AppTheme, ThemeMode } from '../lib/themes/types';
