import { useRouter } from "expo-router"
import { useEffect, useRef } from "react"
import { ActivityIndicator, Text, View } from "react-native"
import { useAuthContext } from "../hooks/use-auth-context"
import { ROUTES } from "../lib/routes"
import { SignInForm } from "./auth/sign-in-form"
import { markInitialNavigationDone } from './initial-navigation/initialNavigation'
import 'react-native-get-random-values'; // must run before using tweetnacl

/**
 * Root Index - Auth Gate
 * 
 * This component checks authentication state and routes accordingly:
 * - If logged in with complete profile: redirect to main app
 * - If logged in but needs onboarding: redirect to onboarding
 * - If not logged in: show sign-in form
 * 
 * IMPORTANT: This acts as the authentication gate for the entire app.
 * On cold start, we ensure proper initialization before allowing navigation.
 */
export default function Index() {
  const { session, isLoading, profile } = useAuthContext()
  const router = useRouter()
  const latestSessionIdRef = useRef<string | null>(null)
  const hasNavigatedRef = useRef(false)
  
  // Debug logging for initial render (captures state at mount time only)
  useEffect(() => {
    if (__DEV__) {
      console.log('[index] Component mounted, auth state:', {
        isLoading,
        hasSession: Boolean(session),
        hasProfile: Boolean(profile),
        sessionId: session?.user?.id
      })
    }
  }, [])

  // Reset navigation ref on unmount to ensure clean state if component remounts
  useEffect(() => {
    return () => {
      hasNavigatedRef.current = false
    }
  }, [])

  useEffect(() => {
    let isActive = true

    // Track the latest session id for this effect run
    latestSessionIdRef.current = session?.user?.id ?? null
    const startingSessionId = latestSessionIdRef.current

    // Wait for auth state to be determined
    // IMPORTANT: Don't navigate until isLoading is false to prevent race conditions
    if (isLoading) {
      if (__DEV__) {
        console.log('[index] Auth still loading, waiting...')
      }
      return () => {
        isActive = false
      }
    }

    // If user is authenticated, check their profile status
    if (session?.user) {
      try {
        if (!isActive || latestSessionIdRef.current !== startingSessionId) return
        
        // Prevent multiple navigations
        if (hasNavigatedRef.current) {
          if (__DEV__) {
            console.log('[index] Already navigated, skipping')
          }
          return
        }
        
        // Check if user needs to complete onboarding
        // This happens when auth user exists but no profile is found
        if (profile?.needs_onboarding === true || profile?.onboarding_completed === false) {
          if (__DEV__) {
            console.log('[index] User needs onboarding, redirecting to onboarding flow')
          }
          hasNavigatedRef.current = true
          router.replace('/onboarding')
          try {
            markInitialNavigationDone()
          } catch (error) {
            if (__DEV__) {
              console.warn('[index] markInitialNavigationDone failed after onboarding navigation:', error)
            }
          }
        } else {
          if (__DEV__) {
            console.log('[index] Authenticated with complete profile, redirecting to main app')
          }
          hasNavigatedRef.current = true
          router.replace(ROUTES.TABS.BOUNTY_APP)
          try {
            markInitialNavigationDone()
          } catch (error) {
            if (__DEV__) {
              console.warn('[index] markInitialNavigationDone failed after main app navigation:', error)
            }
          }
        }
      } catch (navError) {
        console.error('[index] Navigation error:', navError)
      }
    } else {
      // No session: user should see sign-in form
      // Reset navigation flag to allow navigation after sign-in
      hasNavigatedRef.current = false
      if (__DEV__) {
        console.log('[index] No session found, showing sign-in form')
      }
    }

    return () => {
      isActive = false
    }
  }, [session, isLoading, profile, router])

  // Show loading spinner while checking authentication state
  // CRITICAL: This prevents any content flash before auth is determined
  if (isLoading) {
    if (__DEV__) {
      console.log('[index] Rendering loading state')
    }
    return (
      <View className="flex-1 items-center justify-center bg-emerald-800">
        <ActivityIndicator size="large" color="#10b981" />
        <Text className="text-white mt-4 text-base">Loading...</Text>
      </View>
    )
  }

  // If not authenticated, show sign-in form
  if (!session) {
    if (__DEV__) {
      console.log('[index] Rendering sign-in form')
    }
    return <SignInForm />
  }

  // While redirecting, show loading spinner
  if (__DEV__) {
    console.log('[index] Rendering redirecting state')
  }
  return (
    <View className="flex-1 items-center justify-center bg-emerald-800">
      <ActivityIndicator size="large" color="#10b981" />
      <Text className="text-white mt-4 text-base">Redirecting...</Text>
    </View>
  )
}