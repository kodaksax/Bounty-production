import type { Href } from "expo-router";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import 'react-native-get-random-values'; // must run before using tweetnacl
import { useAuthContext } from "../hooks/use-auth-context";
import { useAppBootstrap } from "../hooks/useAppBootstrap";
import { ROUTES } from "../lib/routes";
import { hasDeviceSignedInBefore } from "../lib/storage/onboarding";
import { SignInForm } from "./auth/sign-in-form";
import { markInitialNavigationDone } from './initial-navigation/initialNavigation';

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
  // Tracks whether we've confirmed this is a *returning* user (device has
  // signed in before) — until this is true, an unauthenticated visitor might
  // still be a first-timer who should see onboarding instead of the log-in
  // form, so we hold on the loading spinner rather than flashing sign-in.
  const [confirmedReturningUser, setConfirmedReturningUser] = useState(false)

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

    // Unauthenticated — determine whether this is a genuine first-time
    // visitor (never signed in on this device) or a returning user who is
    // simply logged out right now.
    if (bootstrap.status === 'unauthenticated') {
      if (confirmedReturningUser) return

      let cancelled = false
      ;(async () => {
        const returning = await hasDeviceSignedInBefore()
        if (cancelled || hasNavigatedRef.current) return

        if (!returning) {
          hasNavigatedRef.current = true
          if (__DEV__) {
            console.log('[index] First-time device — routing to onboarding welcome')
          }
          router.replace('/onboarding/welcome' as Href)
          try { markInitialNavigationDone() } catch {}
        } else {
          setConfirmedReturningUser(true)
        }
      })()

      return () => {
        cancelled = true
      }
    }

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
  }, [bootstrap, isPasswordRecovery, router, confirmedReturningUser])

  // Loading, authenticated (redirecting), or an unauthenticated visitor whose
  // first-time-device check hasn't resolved yet — show spinner, never the
  // wrong screen.
  // Use inline StyleSheet styles (not NativeWind className) so the screen is
  // visible even when the CSS-interop runtime fails to process global.css.
  if (
    bootstrap.status === 'loading' ||
    bootstrap.status === 'authenticated' ||
    (bootstrap.status === 'unauthenticated' && !confirmedReturningUser)
  ) {
    if (__DEV__) {
      console.log('[index] Rendering loading/redirecting state:', bootstrap.status)
    }
    return (
      <View style={indexStyles.loadingContainer}>
        <ActivityIndicator size="large" color="#059669" />
        <Text style={indexStyles.loadingText}>
          {bootstrap.status === 'authenticated' ? 'Redirecting...' : 'Loading...'}
        </Text>
      </View>
    )
  }

  // Unauthenticated returning user — show sign-in form.
  if (__DEV__) {
    console.log('[index] Rendering sign-in form')
  }
  return <SignInForm />
}

const indexStyles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0B0F14', // page background
  },
  loadingText: {
    color: '#ffffff',
    marginTop: 16,
    fontSize: 16,
  },
});
