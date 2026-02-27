import { useTheme } from '../components/theme-provider';

/**
 * Hook to access the full design system theme
 * Includes emerald color palette, spacing, typography, shadows, and animations.
 * Colors are automatically resolved based on the active theme (dark/light/system).
 *
 * @example
 * const { colors, spacing, shadows, isDark, setTheme } = useAppTheme();
 *
 * const styles = StyleSheet.create({
 *   container: {
 *     backgroundColor: colors.background.primary,
 *     padding: spacing.lg,
 *     ...shadows.xl,
 *   }
 * });
 */
export function useAppTheme() {
  const theme = useTheme();

  return {
    theme: theme.theme,
    setTheme: theme.setTheme,
    isDark: theme.isDark,
    colors: theme.colors,
    spacing: theme.spacing,
    borderRadius: theme.borderRadius,
    typography: theme.typography,
    shadows: theme.shadows,
    animations: theme.animations,
  };
}
