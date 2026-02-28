import { useEffect } from 'react'
import { useAuthContext } from '../hooks/use-auth-context'
// Use centralized helpers to avoid calling native hide from multiple
// places which can race and trigger native errors when the native
// splash is already unregistered for the current view controller.
import { hideNativeSplashSafely } from '../app/auth/splash'

// This controller intentionally does NOT call preventAutoHideAsync.
// Root layout is responsible for showing/holding the native splash.
// Here we only attempt to hide it once auth finishes loading, and we
// delegate to the shared safe helper which already swallows native errors.
export function SplashScreenController() {
  const { isLoading } = useAuthContext()

  useEffect(() => {
    if (!isLoading) {
      // call the shared safe hide helper instead of calling the native
      // API directly to avoid races and duplicate-hide issues.
      hideNativeSplashSafely()
    }
  }, [isLoading])

  return null
}