import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Appearance, ColorSchemeName } from 'react-native';
import { darkTheme } from './darkTheme';
import { lightTheme } from './lightTheme';
import type { AppTheme, ThemeMode } from './types';

const STORAGE_KEY = '@bounty/theme_mode';

export interface ThemeContextValue {
  theme: AppTheme;
  mode: ThemeMode;
  isDark: boolean;
  toggleTheme: () => void;
  setTheme: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function resolveTheme(mode: ThemeMode, system: ColorSchemeName): AppTheme {
  if (mode === 'system') return system === 'light' ? lightTheme : darkTheme;
  return mode === 'light' ? lightTheme : darkTheme;
}

interface AppThemeProviderProps {
  children: React.ReactNode;
  defaultMode?: ThemeMode;
}

export function AppThemeProvider({ children, defaultMode = 'dark' }: AppThemeProviderProps) {
  const [mode, setModeState] = useState<ThemeMode>(defaultMode);
  const [systemScheme, setSystemScheme] = useState<ColorSchemeName>(
    Appearance.getColorScheme() ?? 'dark'
  );

  // Restore persisted preference on mount
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((saved) => {
        if (saved === 'dark' || saved === 'light' || saved === 'system') {
          setModeState(saved);
        }
      })
      .catch(() => {});
  }, []);

  // Track system theme changes
  useEffect(() => {
    const sub = Appearance.addChangeListener(({ colorScheme }) => {
      setSystemScheme(colorScheme);
    });
    return () => sub.remove();
  }, []);

  const setTheme = useCallback((newMode: ThemeMode) => {
    setModeState(newMode);
    AsyncStorage.setItem(STORAGE_KEY, newMode).catch(() => {});
  }, []);

  const toggleTheme = useCallback(() => {
    // System mode toggles to the opposite of the current resolved theme
    const next = mode === 'light' ? 'dark' : 'light';
    setTheme(next);
  }, [mode, setTheme]);

  const theme = resolveTheme(mode, systemScheme);

  // Memoized: this context is consumed by nearly every screen in the app, so
  // an unmemoized value would re-render the whole tree on any AppThemeProvider
  // render (e.g. the Appearance change-listener effect re-running).
  const value = useMemo(
    () => ({ theme, mode, isDark: theme.isDark, toggleTheme, setTheme }),
    [theme, mode, toggleTheme, setTheme]
  );

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useAppThemeContext(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useAppThemeContext must be used within AppThemeProvider');
  return ctx;
}
