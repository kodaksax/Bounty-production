import { MessengerScreen } from "app/tabs/messenger-screen"
import { PostingsScreen } from "app/tabs/postings-screen"
import { ProfileScreen } from "app/tabs/profile-screen"
import { WalletScreen } from "app/tabs/wallet-screen"
import type { BountyFeedHandle } from 'components/bounty-feed'
import { BountyFeed } from 'components/bounty-feed'
import { ConnectionStatus } from 'components/connection-status'
// Search moved to its own route (app/tabs/search.tsx) so we no longer render it inline.
import AsyncStorage from '@react-native-async-storage/async-storage'
import { BottomNav } from 'components/ui/bottom-nav'
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useRef, useState } from "react"
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { useAuthContext } from '../../hooks/use-auth-context'
import { useConversations } from '../../hooks/useConversations'
import { useAdmin } from '../../lib/admin-context'
import { authProfileService } from '../../lib/services/auth-profile-service'
import { navigationIntent } from '../../lib/services/navigation-intent'
import { getOnboardingCompleteKey } from '../../lib/storage/onboarding'

function BountyAppInner() {
  const router = useRouter()
  const { screen, initialTab } = useLocalSearchParams<{ screen?: string, initialTab?: string }>()
  const { isAdmin, isAdminTabEnabled } = useAdmin()
  // Get current user ID from auth context (reactive to auth state changes)
  const { session, isLoading, profile } = useAuthContext()
  const currentUserId = session?.user?.id

  // Fallback: check AsyncStorage for onboarding completion in case the Supabase
  // profile update didn't propagate to AuthContext before this component mounted.
  // Scoped per-user so a prior user's flag cannot bypass a new user's onboarding.
  // null = not yet checked, true = completed, false = not completed.
  const [storageOnboardingDone, setStorageOnboardingDone] = useState<boolean | null>(null)
  // Track whether we have already attempted to repair the Supabase onboarding flag
  // so we don't issue repeated update calls on every render.
  const repairAttemptedRef = useRef(false)

  useEffect(() => {
    if (!currentUserId) {
      // No authenticated user — no need to check storage; resolve immediately.
      setStorageOnboardingDone(false)
      return
    }
    AsyncStorage.getItem(getOnboardingCompleteKey(currentUserId))
      .then(val => setStorageOnboardingDone(val === 'true'))
      .catch(() => setStorageOnboardingDone(false))
  }, [currentUserId])

  // Background repair: when the local flag says onboarding is done but the Supabase
  // profile still has onboarding_completed !== true (e.g. the write failed due to a
  // bad network), silently update the profile so future restarts work correctly.
  useEffect(() => {
    if (
      !repairAttemptedRef.current &&
      storageOnboardingDone === true &&
      currentUserId &&
      profile !== null &&
      profile.onboarding_completed !== true
    ) {
      // Mark that a repair attempt is in-flight to avoid duplicate updates.
      repairAttemptedRef.current = true
      authProfileService
        .updateProfile({ onboarding_completed: true })
        .catch(() => {
          // Non-critical: the local flag is still the fallback on next restart.
          // Reset so a future render/foreground event can retry the repair.
          repairAttemptedRef.current = false
        })
    }
  }, [storageOnboardingDone, currentUserId, profile])

  // Admin tab is only shown if user has admin permissions AND has enabled the toggle
  const showAdminTab = isAdmin && isAdminTabEnabled
  const allowedScreens = new Set(['bounty', 'wallet', 'postings', 'profile', 'create', 'admin'])
  const paramScreen = typeof screen === 'string' && screen.length > 0 && allowedScreens.has(screen) ? screen : 'bounty'
  const allowedInitialTabs = new Set(['new', 'inProgress', 'myPostings', 'requests'])
  const paramInitialTab = typeof initialTab === 'string' && initialTab.length > 0 && allowedInitialTabs.has(initialTab) ? initialTab : undefined
  const [activeScreen, setActiveScreen] = useState(paramScreen)
  const [showBottomNav, setShowBottomNav] = useState(true)
  const [pendingInitialTab, setPendingInitialTab] = useState<string | undefined>(paramInitialTab)

  // Track total unread message count for the bottom nav badge
  const { totalUnreadCount: unreadMessageCount } = useConversations()

  // Ref to the BountyFeed component — used for scroll-to-top and refresh on tab repress
  const bountyFeedRef = useRef<BountyFeedHandle>(null)

  // Handler for when bounty tab is pressed while already active - scroll to top and refresh
  const handleBountyTabRepress = useCallback(() => {
    bountyFeedRef.current?.handleTabRepress()
  }, [])

  // Consume any pending navigation intent and apply active screen / initialTab.
  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const pending = await navigationIntent.getAndClearPendingNavigation()
        if (!pending || !mounted) return
        // Parse the pending URL for `screen` and `initialTab` params.
        try {
          const u = new URL(pending, 'http://example.com') // base for parsing
          const screen = u.searchParams.get('screen')
          const initialTab = u.searchParams.get('initialTab')
          if (screen) setActiveScreen(screen)
          if (initialTab) setPendingInitialTab(initialTab)
        } catch (err) {
          // ignore parsing errors
        }
      } catch (err) {
        // ignore
      }
    })()
    return () => { mounted = false }
  }, [])

  // If the admin tab is selected, navigate to the admin route from an effect
  // to avoid triggering navigation/state updates during render (which causes
  // the "Cannot update a component while rendering a different component" error).
  useEffect(() => {
    if (activeScreen === 'admin' && showAdminTab) {
      router.push('/(admin)')
    }
  }, [activeScreen, showAdminTab, router])

  // Redirect unauthenticated users immediately — do not wait for AsyncStorage.
  if (!isLoading && !session) {
    if (__DEV__) {
      console.log('[bounty-app] Not authenticated, redirecting to index')
    }
    return <Redirect href="/" />
  }

  if (isLoading || storageOnboardingDone === null) {
    return (
      <View className="flex-1 items-center justify-center bg-emerald-600">
        <ActivityIndicator size="large" color="#10b981" />
        <Text className="text-white mt-4 text-base">Loading...</Text>
      </View>
    )
  }

  // Guard: redirect users who haven't completed onboarding to the onboarding flow.
  // The profile is the authoritative source: if it explicitly marks onboarding as
  // required or incomplete, always redirect — even if the local flag says done.
  // Only when the profile is still null (Supabase propagation lag) do we fall back
  // to the local per-user flag to avoid looping back to the username screen.
  if (
    !isLoading &&
    session &&
    (
      // If the profile explicitly indicates onboarding is required OR
      // the profile is null and the per-user storage flag says not done,
      // redirect to onboarding. However, allow the per-user AsyncStorage
      // flag to temporarily override an authored `onboarding_completed: false`
      // value to reduce redirect loops when the DB/profile hasn't propagated yet.
      (profile !== null && (profile.needs_onboarding === true || (profile.onboarding_completed === false && !storageOnboardingDone))) ||
      (profile === null && !storageOnboardingDone)
    )
  ) {
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
          initialTab={pendingInitialTab ?? paramInitialTab}
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

      {showBottomNav && <BottomNav activeScreen={activeScreen} onNavigate={setActiveScreen} showAdmin={showAdminTab} onBountyTabRepress={handleBountyTabRepress} unreadMessageCount={unreadMessageCount} />}
    </View>
  )
}

export function BountyApp() {
  return <BountyAppInner />
}

// Styles
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#059669', position: 'relative' },
})
export default function BountyAppRoute() {
  return <BountyApp />
}
