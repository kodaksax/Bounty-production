import { useRouter } from "expo-router"
import React, { useEffect, useRef } from "react"
import { ActivityIndicator, Text, View } from "react-native"
import { useAuthContext } from "../hooks/use-auth-context"
import { ROUTES } from "../lib/routes"
import { authProfileService } from "../lib/services/auth-profile-service"
import { SignInForm } from "./auth/sign-in-form"


/**
 * Root Index - Auth Gate
 * 
 * This component checks authentication state and routes accordingly:
 * - If logged in with profile: redirect to main app
 * - If logged in without profile: redirect to onboarding
 * - If not logged in: show sign-in form
 */
export default function Index() {
  const { session, profile, isLoading } = useAuthContext()
  const router = useRouter()
  const latestSessionIdRef = useRef<string | null>(null)

  useEffect(() => {
    let isActive = true

    // Track the latest session id for this effect run
    latestSessionIdRef.current = session?.user?.id ?? null
    const startingSessionId = latestSessionIdRef.current

    // Wait for auth state to be determined
    if (isLoading) {
      return () => {
        isActive = false
      }
    }

    // If user is authenticated, check their profile and redirect
    if (session?.user) {
      const checkProfileAndRedirect = async () => {
        try {
          // Check if user has completed username setup (required for onboarding completion)
          // Use profile from auth context to ensure it's properly loaded
          const profileData = profile

          // If component has unmounted or session has changed, abort navigation
          if (!isActive || latestSessionIdRef.current !== startingSessionId) {
            return
          }

          // User needs to complete onboarding if:
          // 1. No profile exists, OR
          // 2. Profile has no username, OR
          // 3. onboarding_completed flag is explicitly false
          // 
          // IMPORTANT: For returning users:
          // - onboarding_completed should be true (set when they completed onboarding)
          // - If undefined, treat as completed (legacy profiles from before this flag existed)
          // - Only redirect to onboarding if explicitly false OR no username exists
          const hasUsername = profileData?.username
          const onboardingFlag = profileData?.onboarding_completed
          
          // Explicit check: only go to onboarding if no username OR flag is explicitly false
          // undefined means old profile (completed before flag existed) - let them through
          const needsOnboarding = !hasUsername || onboardingFlag === false
          
          console.log('[index] Routing decision:', {
            hasUsername,
            onboardingFlag,
            needsOnboarding,
            userId: session.user.id
          })
          
          if (needsOnboarding) {
            // User needs to complete onboarding
            try {
              console.log('[index] Redirecting to onboarding')
              router.replace('/onboarding/username')
            } catch (navError) {
              console.error('[index] Navigation error to onboarding:', navError)
            }
          } else {
            // User has completed onboarding, go to main app
            try {
              console.log('[index] Redirecting to main app')
              router.replace(ROUTES.TABS.BOUNTY_APP)
            } catch (navError) {
              console.error('[index] Navigation error to main app:', navError)
            }
          }
        } catch (error) {
          console.error('[index] Error checking profile:', error)
          // On error, still redirect to app and let other guards handle it
          if (!isActive || latestSessionIdRef.current !== startingSessionId) {
            return
          }
          try {
            router.replace(ROUTES.TABS.BOUNTY_APP)
          } catch (navError) {
            console.error('[index] Navigation error in fallback redirect:', navError)
          }
        }
      }

      checkProfileAndRedirect()
    }

    return () => {
      isActive = false
    }
  }, [session, profile, isLoading, router])

  // Show loading spinner while checking authentication state
  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-emerald-800">
        <ActivityIndicator size="large" color="#10b981" />
        <Text className="text-white mt-4 text-base">Loading...</Text>
      </View>
    )
  }

  // If not authenticated, show sign-in form
  if (!session) {
    return <SignInForm />
  }

  // While redirecting, show loading spinner
  return (
    <View className="flex-1 items-center justify-center bg-emerald-800">
      <ActivityIndicator size="large" color="#10b981" />
      <Text className="text-white mt-4 text-base">Redirecting...</Text>
    </View>
  )
}