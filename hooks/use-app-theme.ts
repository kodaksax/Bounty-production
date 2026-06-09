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
 *   text:      { color: theme.text },
 * });
 */
export { useAppThemeContext as useAppTheme } from '../lib/themes/AppThemeContext';
export type { AppTheme, ThemeMode } from '../lib/themes/types';
