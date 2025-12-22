import { useRouter } from "expo-router"
import React, { useEffect } from "react"
import { ActivityIndicator, View, Text } from "react-native"
import { useAuthContext } from "../hooks/use-auth-context"
import { SignInForm } from "./auth/sign-in-form"
import { supabase } from "../lib/supabase"
import { ROUTES } from "../lib/routes"

/**
 * Root Index - Auth Gate
 * 
 * This component checks authentication state and routes accordingly:
 * - If logged in with profile: redirect to main app
 * - If logged in without profile: redirect to onboarding
 * - If not logged in: show sign-in form
 */
export default function Index() {
  const { session, isLoading, profile } = useAuthContext()
  const router = useRouter()

  useEffect(() => {
    // Wait for auth state to be determined
    if (isLoading) {
      return
    }

    // If user is authenticated, check their profile and redirect
    if (session?.user) {
      const checkProfileAndRedirect = async () => {
        try {
          // Check if user has completed onboarding (has profile in Supabase)
          const { data: profileData } = await supabase
            .from('profiles')
            .select('username')
            .eq('id', session.user.id)
            .single()

          if (!profileData || !profileData.username) {
            // User needs to complete onboarding
            router.replace('/onboarding/username')
          } else {
            // User has completed onboarding, go to main app
            router.replace({ pathname: ROUTES.TABS.BOUNTY_APP, params: { screen: 'bounty' } })
          }
        } catch (error) {
          console.error('[index] Error checking profile:', error)
          // On error, still redirect to app and let other guards handle it
          router.replace({ pathname: ROUTES.TABS.BOUNTY_APP, params: { screen: 'bounty' } })
        }
      }

      checkProfileAndRedirect()
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