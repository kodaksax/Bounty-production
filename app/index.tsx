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
 * - If logged in with profile: redirect to main app
 * - If logged in without profile: redirect to onboarding
 * - If not logged in: show sign-in form
 */
export default function Index() {
  const { session, isLoading } = useAuthContext()
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

    // If user is authenticated, always route to dashboard on app start.
    // Onboarding is triggered explicitly after fresh sign-in/sign-up, not here.
    if (session?.user) {
      try {
        if (!isActive || latestSessionIdRef.current !== startingSessionId) return
        console.log('[index] Authenticated on boot, redirecting to main app')
        router.replace(ROUTES.TABS.BOUNTY_APP)
      } catch (navError) {
        console.error('[index] Navigation error to main app:', navError)
      }
    }

    return () => {
      isActive = false
    }
  }, [session, isLoading, router])

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