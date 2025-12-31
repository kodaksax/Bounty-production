import { useRouter } from "expo-router"
import React, { useEffect, useRef } from "react"
import { ActivityIndicator, Text, View } from "react-native"
import { useAuthContext } from "../hooks/use-auth-context"
import { ROUTES } from "../lib/routes"
import { SignInForm } from "./auth/sign-in-form"


/**
 * Root Index - Auth Gate
 * 
 * This component checks authentication state and routes accordingly:
 * - If logged in with complete profile: redirect to main app
 * - If logged in but needs onboarding: redirect to onboarding
 * - If not logged in: show sign-in form
 */
export default function Index() {
  const { session, isLoading, profile } = useAuthContext()
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

    // If user is authenticated, check their profile status
    if (session?.user) {
      try {
        if (!isActive || latestSessionIdRef.current !== startingSessionId) return
        
        // Check if user needs to complete onboarding
        // This happens when auth user exists but no profile is found
        if (profile?.needs_onboarding === true || profile?.onboarding_completed === false) {
          console.log('[index] User needs onboarding, redirecting to onboarding flow')
          router.replace('/onboarding')
        } else {
          console.log('[index] Authenticated with complete profile, redirecting to main app')
          router.replace(ROUTES.TABS.BOUNTY_APP)
        }
      } catch (navError) {
        console.error('[index] Navigation error:', navError)
      }
    }

    return () => {
      isActive = false
    }
  }, [session, isLoading, profile, router])

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