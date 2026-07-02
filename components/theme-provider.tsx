/**
 * Thin bridge that wraps AppThemeProvider and re-exports a backwards-compatible
 * interface so existing code using `useTheme()` / `<ThemeProvider>` continues to
 * work without changes.
 *
 * New code should import directly from 'lib/themes'.
 */
import * as React from 'react';
import { AppThemeProvider, useAppThemeContext } from '../lib/themes/AppThemeContext';
import type { ThemeMode } from '../lib/themes/types';
import { theme as legacyDesignTheme } from '../lib/theme';

// ─── Legacy interface (kept for backwards compat) ────────────────────────────

type LegacyThemeValue = {
  theme: ThemeMode;
  setTheme: (mode: ThemeMode) => void;
  isDark: boolean;
  toggleTheme: () => void;
  // Design-system tokens (static shape preserved; values now come from active theme)
  colors: typeof legacyDesignTheme.colors;
  spacing: typeof legacyDesignTheme.spacing;
  borderRadius: typeof legacyDesignTheme.borderRadius;
  typography: typeof legacyDesignTheme.typography;
  shadows: typeof legacyDesignTheme.shadows;
  animations: typeof legacyDesignTheme.animations;
};

// ─── Public hook ──────────────────────────────────────────────────────────────

export function useTheme(): LegacyThemeValue {
  const ctx = useAppThemeContext();

  return {
    theme: ctx.mode,
    setTheme: ctx.setTheme,
    isDark: ctx.isDark,
    toggleTheme: ctx.toggleTheme,
    // Pass through static design-system tokens; color values are in ctx.theme
    colors: legacyDesignTheme.colors,
    spacing: legacyDesignTheme.spacing,
    borderRadius: legacyDesignTheme.borderRadius,
    typography: legacyDesignTheme.typography,
    shadows: legacyDesignTheme.shadows,
    animations: legacyDesignTheme.animations,
  };
}

// ─── Provider ─────────────────────────────────────────────────────────────────

interface ThemeProviderProps {
  children: React.ReactNode;
  defaultTheme?: ThemeMode | 'system';
  attribute?: string;
  enableSystem?: boolean;
}

export function ThemeProvider({
  children,
  defaultTheme = 'dark',
}: ThemeProviderProps) {
  const mode: ThemeMode =
    defaultTheme === 'light' ? 'light' :
    defaultTheme === 'system' ? 'system' :
    'dark';

  return (
    <AppThemeProvider defaultMode={mode}>
      {children}
    </AppThemeProvider>
  );
}
