import { useTheme } from '../components/theme-provider';

/**
 * Hook to access the full design system theme
 * Includes emerald color palette, spacing, typography, shadows, and animations
 * 
 * @example
 * const { colors, spacing, shadows } = useAppTheme();
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
    colors: theme.colors,
    spacing: theme.spacing,
    borderRadius: theme.borderRadius,
    typography: theme.typography,
    shadows: theme.shadows,
    animations: theme.animations,
  };
}
