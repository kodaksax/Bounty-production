import * as React from 'react'
import { createContext, useContext, useEffect, useState } from 'react'
import { theme as designTheme } from '../lib/theme'

type Theme = 'dark' | 'light' | 'system'

type ThemeProviderProps = {
  children: React.ReactNode
  defaultTheme?: Theme
  attribute?: string
  enableSystem?: boolean
}

type ThemeProviderState = {
  theme: Theme
  setTheme: (theme: Theme) => void
  colors: typeof designTheme.colors
  spacing: typeof designTheme.spacing
  borderRadius: typeof designTheme.borderRadius
  typography: typeof designTheme.typography
  shadows: typeof designTheme.shadows
  animations: typeof designTheme.animations
}

const initialState: ThemeProviderState = {
  theme: 'dark',
  setTheme: () => null,
  colors: designTheme.colors,
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
  const [theme, setTheme] = useState<Theme>(defaultTheme)

  useEffect(() => {
    // In React Native, we can use Appearance API to detect system theme
    // For now, just use the default theme
    setTheme(defaultTheme)
  }, [defaultTheme])

  const value = {
    theme,
    setTheme,
    colors: designTheme.colors,
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
