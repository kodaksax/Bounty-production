import type { Href } from "expo-router"
import { useRouter } from "expo-router"
import { useEffect, useRef } from "react"
import { ActivityIndicator, Text, View } from "react-native"
import 'react-native-get-random-values'; // must run before using tweetnacl
import { useAuthContext } from "../hooks/use-auth-context"
import { useAppBootstrap } from "../hooks/useAppBootstrap"
import { ROUTES } from "../lib/routes"
import { SignInForm } from "./auth/sign-in-form"
import { markInitialNavigationDone } from './initial-navigation/initialNavigation'

/**
 * Root Index - Auth Gate
 *
 * Consumes the `useAppBootstrap` hook which resolves all async state (auth,
 * profile, local AsyncStorage flag) inside its own "loading" phase.  By the
 * time bootstrap.status transitions out of "loading" the correct destination
 * is already known, so navigation is synchronous and the wrong screen is
 * never rendered — eliminating the onboarding screen flash.
 *
 * State machine handled here:
 *   loading        → show splash / loading spinner
 *   unauthenticated → show sign-in form
 *   authenticated  → immediately navigate to main app or onboarding
 *
 * Password recovery is checked before the onboarding route since it is a
 * special override that should always take precedence.
 */
export default function Index() {
  const bootstrap = useAppBootstrap()
  const { isPasswordRecovery } = useAuthContext()
  const router = useRouter()
  const hasNavigatedRef = useRef(false)

  // Debug logging on mount (development only)
  useEffect(() => {
    if (__DEV__) {
      console.log('[index] Component mounted')
    }
  }, [])

  // Reset navigation guard on unmount so a remount starts fresh.
  useEffect(() => {
    return () => {
      hasNavigatedRef.current = false
    }
  }, [])

  useEffect(() => {
    // Prevent double-navigation across re-renders.
    if (hasNavigatedRef.current) return

    // Still resolving auth or onboarding state — do nothing yet.
    if (bootstrap.status === 'loading') return

    // Password recovery takes precedence over all routing decisions.
    if (isPasswordRecovery) {
      hasNavigatedRef.current = true
      if (__DEV__) {
        console.log('[index] Password recovery mode — routing to update-password')
      }
      router.replace(ROUTES.AUTH.UPDATE_PASSWORD as Href)
      try { markInitialNavigationDone() } catch {}
      return
    }

    // Unauthenticated — nothing to navigate; render sign-in form below.
    if (bootstrap.status === 'unauthenticated') return

    // Authenticated — onboardingComplete is already known (resolved by the
    // hook), so this navigation is synchronous with no further async work.
    hasNavigatedRef.current = true
    const dest = bootstrap.onboardingComplete
      ? ROUTES.TABS.BOUNTY_APP
      : '/onboarding'

    if (__DEV__) {
      console.log('[index] Routing decision:', {
        onboardingComplete: bootstrap.onboardingComplete,
        dest,
      })
    }

    router.replace(dest as Href)
    try { markInitialNavigationDone() } catch {}
  }, [bootstrap, isPasswordRecovery, router])

  // Loading or authenticated (redirecting) — show spinner, never wrong screen.
  if (bootstrap.status === 'loading' || bootstrap.status === 'authenticated') {
    if (__DEV__) {
      console.log('[index] Rendering loading/redirecting state:', bootstrap.status)
    }
    return (
      <View className="flex-1 items-center justify-center bg-emerald-800">
        <ActivityIndicator size="large" color="#10b981" />
        <Text className="text-white mt-4 text-base">
          {bootstrap.status === 'authenticated' ? 'Redirecting...' : 'Loading...'}
        </Text>
      </View>
    )
  }

  // Unauthenticated — show sign-in form.
  if (__DEV__) {
    console.log('[index] Rendering sign-in form')
  }
  return <SignInForm />
}
