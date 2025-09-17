// Minimal stub for `next-themes` `useTheme` hook used in web code.

type Listener = (theme: string) => void
let currentTheme = 'light'
const listeners = new Set<Listener>()

export function useTheme() {
  const setTheme = (t: string) => {
    currentTheme = t
    listeners.forEach(l => l(t))
  }
  return {
    theme: currentTheme,
    setTheme,
  }
}

export function onThemeChange(listener: Listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

Object.defineProperty(exports, '__esModule', { value: true })
export default useTheme
