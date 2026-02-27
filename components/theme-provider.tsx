import * as React from 'react'
import { createContext, useContext, useEffect, useState } from 'react'
import { Appearance } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { ColorTokens, darkColors, lightColors, theme as designTheme } from '../lib/theme'

type Theme = 'dark' | 'light' | 'system'

const THEME_STORAGE_KEY = '@bounty_app_theme'
const DEFAULT_SYSTEM_SCHEME: 'dark' | 'light' = 'dark'

type ThemeProviderProps = {
  children: React.ReactNode
  defaultTheme?: Theme
  attribute?: string
  enableSystem?: boolean
}

type ThemeProviderState = {
  theme: Theme
  setTheme: (theme: Theme) => void
  isDark: boolean
  colors: ColorTokens
  spacing: typeof designTheme.spacing
  borderRadius: typeof designTheme.borderRadius
  typography: typeof designTheme.typography
  shadows: typeof designTheme.shadows
  animations: typeof designTheme.animations
}

const initialState: ThemeProviderState = {
  theme: 'dark',
  setTheme: () => null,
  isDark: true,
  colors: darkColors,
  spacing: designTheme.spacing,
  borderRadius: designTheme.borderRadius,
  typography: designTheme.typography,
  shadows: designTheme.shadows,
  animations: designTheme.animations,
}

const ThemeProviderContext = createContext<ThemeProviderState>(initialState)

export function ThemeProvider({
  children,
  defaultTheme = 'dark',
  enableSystem = true,
  ...props
}: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(defaultTheme)
  const [systemScheme, setSystemScheme] = useState<'dark' | 'light'>(
    () => Appearance.getColorScheme() ?? DEFAULT_SYSTEM_SCHEME
  )

  // Load persisted preference once on mount (empty deps intentional)
  useEffect(() => {
    AsyncStorage.getItem(THEME_STORAGE_KEY)
      .then((stored) => {
        if (stored === 'dark' || stored === 'light' || stored === 'system') {
          setThemeState(stored)
        }
      })
      .catch(() => {
        // ignore storage errors; fall back to default
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Listen for system appearance changes
  useEffect(() => {
    const subscription = Appearance.addChangeListener(({ colorScheme }) => {
      setSystemScheme(colorScheme ?? DEFAULT_SYSTEM_SCHEME)
    })
    return () => subscription.remove()
  }, [])

  const setTheme = (next: Theme) => {
    setThemeState(next)
    AsyncStorage.setItem(THEME_STORAGE_KEY, next).catch(() => {
      // ignore storage errors
    })
  }

  const resolvedScheme: 'dark' | 'light' =
    theme === 'system' ? systemScheme : theme
  const isDark = resolvedScheme === 'dark'
  const resolvedColors: ColorTokens = isDark ? darkColors : lightColors

  const value: ThemeProviderState = {
    theme,
    setTheme,
    isDark,
    colors: resolvedColors,
    spacing: designTheme.spacing,
    borderRadius: designTheme.borderRadius,
    typography: designTheme.typography,
    shadows: designTheme.shadows,
    animations: designTheme.animations,
  }

  return (
    <ThemeProviderContext.Provider value={value}>
      {children}
    </ThemeProviderContext.Provider>
  )
}

export const useTheme = () => {
  const context = useContext(ThemeProviderContext)

  if (context === undefined)
    throw new Error('useTheme must be used within a ThemeProvider')

  return context
}
