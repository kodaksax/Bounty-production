import { BountyFeed } from 'components/bounty-feed'
import type { BountyFeedHandle } from 'components/bounty-feed'
import { MessengerScreen } from "app/tabs/messenger-screen"
import { PostingsScreen } from "app/tabs/postings-screen"
import { ProfileScreen } from "app/tabs/profile-screen"
import { WalletScreen } from "app/tabs/wallet-screen"
import { ConnectionStatus } from 'components/connection-status'
// Search moved to its own route (app/tabs/search.tsx) so we no longer render it inline.
import { BottomNav } from 'components/ui/bottom-nav'
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useRef, useState } from "react"
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { useAuthContext } from '../../hooks/use-auth-context'
import { useAdmin } from '../../lib/admin-context'
import { colors } from '../../lib/theme'
import { WalletProvider } from '../../lib/wallet-context'

function BountyAppInner() {
  const router = useRouter()
  const { screen } = useLocalSearchParams<{ screen?: string }>()
  const { isAdmin, isAdminTabEnabled } = useAdmin()
  // Get current user ID from auth context (reactive to auth state changes)
  const { session, isLoading, profile } = useAuthContext()
  const currentUserId = session?.user?.id

  // Admin tab is only shown if user has admin permissions AND has enabled the toggle
  const showAdminTab = isAdmin && isAdminTabEnabled
  const allowedScreens = new Set(['bounty', 'wallet', 'postings', 'profile', 'create', 'admin'])
  const paramScreen = typeof screen === 'string' && screen.length > 0 && allowedScreens.has(screen) ? screen : 'bounty'
  const [activeScreen, setActiveScreen] = useState(paramScreen)
  const [showBottomNav, setShowBottomNav] = useState(true)

  // Ref to the BountyFeed component — used for scroll-to-top and refresh on tab repress
  const bountyFeedRef = useRef<BountyFeedHandle>(null)

  // Handler for when bounty tab is pressed while already active - scroll to top and refresh
  const handleBountyTabRepress = useCallback(() => {
    bountyFeedRef.current?.handleTabRepress()
  }, [])

  // If the admin tab is selected, navigate to the admin route from an effect
  // to avoid triggering navigation/state updates during render (which causes
  // the "Cannot update a component while rendering a different component" error).
  useEffect(() => {
    if (activeScreen === 'admin' && showAdminTab) {
      router.push('/(admin)')
    }
  }, [activeScreen, showAdminTab, router])

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-background-secondary">
        <ActivityIndicator size="large" color={colors.primary[500]} />
        <Text className="text-white mt-4 text-base">Loading...</Text>
      </View>
    )
  }

  if (!session) {
    if (__DEV__) {
      console.log('[bounty-app] Not authenticated, redirecting to index')
    }
    return <Redirect href="/" />
  }

  // Guard: redirect users who haven't completed onboarding to the onboarding flow.
  if (!isLoading && session && (profile === null || profile?.needs_onboarding === true || profile?.onboarding_completed === false)) {
    if (__DEV__) {
      console.log('[bounty-app] Profile incomplete or onboarding not done, redirecting to onboarding')
    }
    return <Redirect href="/onboarding" />
  }

  return (
    <View style={styles.container}>
      {/* Connection Status Banner - appears at top when offline */}
      <ConnectionStatus showQueueCount={true} />

      {/* BountyFeed is always mounted to preserve scroll position/cached data.
          display:none hides it visually while other tabs are active. */}
      <View style={{ display: activeScreen === 'bounty' ? 'flex' : 'none', flex: 1 }}>
        <BountyFeed
          ref={bountyFeedRef}
          activeScreen={activeScreen}
          setActiveScreen={setActiveScreen}
          currentUserId={currentUserId}
        />
      </View>

      {activeScreen === "wallet" && (
        <WalletScreen onBack={() => setActiveScreen("bounty")} />
      )}
      {activeScreen === "postings" && (
        <PostingsScreen
          onBack={() => setActiveScreen("bounty")}
          activeScreen={activeScreen}
          setActiveScreen={setActiveScreen}
          onBountyPosted={() => bountyFeedRef.current?.refresh()} // Refresh feed when a new bounty is posted
          onBountyAccepted={() => bountyFeedRef.current?.refresh()} // Refresh feed when a bounty is accepted
          setShowBottomNav={setShowBottomNav}
        />
      )}
      {activeScreen === "profile" && (
        <ProfileScreen onBack={() => setActiveScreen("bounty")} />
      )}
      {activeScreen === "create" && (
        <MessengerScreen
          activeScreen={activeScreen}
          onNavigate={setActiveScreen}
          onConversationModeChange={() => setShowBottomNav(true)}
        />
      )}

      {showBottomNav && <BottomNav activeScreen={activeScreen} onNavigate={setActiveScreen} showAdmin={showAdminTab} onBountyTabRepress={handleBountyTabRepress} />}
    </View>
  )
}

export function BountyApp() {
  return (
    <WalletProvider>
      <BountyAppInner />
    </WalletProvider>
  )
}

// Styles
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background.primary, position: 'relative' },
})
export default function BountyAppRoute() {
  return <BountyApp />
}
