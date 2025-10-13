import * as SplashScreen from 'expo-splash-screen'
import { useEffect } from 'react'
import { useAuthContext } from '../hooks/use-auth-context'

// This controller intentionally does NOT call preventAutoHideAsync.
// Root layout is responsible for showing/holding the native splash.
// Here we only attempt to hide it once auth finishes loading, and we
// swallow the error if the splash is no longer registered for the
// current view controller (e.g., already hidden by root layout).
export function SplashScreenController() {
  const { isLoading } = useAuthContext()

  useEffect(() => {
    if (!isLoading) {
      SplashScreen.hideAsync().catch(() => {
        // No native splash registered for this view controller – safe to ignore.
      })
    }
  }, [isLoading])

  return null
}