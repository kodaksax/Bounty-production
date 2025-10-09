import { useTheme } from '../components/theme-provider';

/**
 * Hook to access the app's design system theme tokens
 * Provides easy access to colors, spacing, typography, etc.
 * 
 * @example
 * const { colors, spacing } = useAppTheme();
 * const styles = StyleSheet.create({
 *   container: {
 *     backgroundColor: colors.background.primary,
 *     padding: spacing.lg,
 *   }
 * });
 */
export function useAppTheme() {
  const context = useTheme();
  
  return {
    colors: context.colors,
    spacing: context.spacing,
    borderRadius: context.borderRadius,
    typography: context.typography,
    shadows: context.shadows,
    animations: context.animations,
    theme: context.theme, // 'dark' | 'light' | 'system'
    setTheme: context.setTheme,
  };
}
