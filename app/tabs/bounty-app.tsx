// The messaging inbox (MessengerScreen) is preserved in ./messenger-screen but is
// no longer what the Inbox tab renders — InboxScreen now hosts Work/Posts/Requests.
import { InboxScreen } from "./inbox-screen"
// The Need Help tab hosts only the post-a-bounty flow. The original combined
// Work/Posts/Requests/New screen is preserved in app/tabs/postings-screen.
import { NeedHelpScreen } from "./need-help-screen"
import { ProfileScreen } from "app/tabs/profile-screen"
import { WalletScreen } from "app/tabs/wallet-screen"
import type { BountyFeedHandle } from 'components/bounty-feed'
import { BountyFeed } from 'components/bounty-feed'
import { ConnectionStatus } from 'components/connection-status'
import { MomentSheet } from '../../components/moments/MomentSheet'
import { MomentsProvider } from '../../providers/moments-provider'
// Search moved to its own route (app/tabs/search.tsx) so we no longer render it inline.
import AsyncStorage from '@react-native-async-storage/async-storage'
import { BottomNav } from 'components/ui/bottom-nav'
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useRef, useState } from "react"
import { ActivityIndicator, Animated, Text, View } from 'react-native'
import { useAuthContext } from '../../hooks/use-auth-context'
import { useFadeAnimation } from '../../hooks/use-accessible-animation'
import { useConversations } from '../../hooks/useConversations'
import { useAdmin } from '../../lib/admin-context'
import { screenNameForBountyAppTab } from '../../lib/analytics/screen-name'
import { trackScreenView } from '../../lib/analytics/screen-tracking'
import { API_TIMEOUTS } from '../../lib/config/network'
import { authProfileService } from '../../lib/services/auth-profile-service'
import { navigationIntent } from '../../lib/services/navigation-intent'
import { getOnboardingCompleteKey } from '../../lib/storage/onboarding'
import { useAppThemeContext } from '../../lib/themes/AppThemeContext'

// Fades a conditionally-mounted tab screen in on mount, so switching tabs
// reads as a smooth transition instead of an instant cut. Respects the
// device's reduced-motion setting via useFadeAnimation.
function FadeInScreen({ children }: { children: React.ReactNode }) {
  const { fadeIn, style } = useFadeAnimation(0)

  useEffect(() => {
    fadeIn(220)
    // Only re-run if the fadeIn identity itself changes (reduced-motion
    // toggling) — this should fire once per mount, not per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <Animated.View style={[{ flex: 1 }, style]}>{children}</Animated.View>
}

// BountyFeed stays mounted across tab switches to preserve scroll position,
// so it can't rely on a mount-triggered fade like the other tabs. Instead it
// re-fades in every time `active` flips true, and is pulled out of layout
// flow (position: absolute) so it doesn't compete for flex space with
// whichever other tab is currently the normal-flow child.
function BountyFeedFade({ active, children }: { active: boolean; children: React.ReactNode }) {
  const { fadeValue, fadeIn } = useFadeAnimation(active ? 1 : 0)

  useEffect(() => {
    if (active) {
      fadeIn(220)
    } else {
      fadeValue.setValue(0)
    }
  }, [active, fadeIn, fadeValue])

  return (
    <Animated.View
      pointerEvents={active ? 'auto' : 'none'}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        opacity: fadeValue,
      }}
    >
      {children}
    </Animated.View>
  )
}

function BountyAppInner() {
  const router = useRouter()
  const { theme } = useAppThemeContext()
  const { screen, initialTab, source } = useLocalSearchParams<{ screen?: string, initialTab?: string, source?: string }>()
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

  // Tracks whether the profile row actually exists when the local flag is set but
  // profile is null in AuthContext (Supabase propagation lag vs truly missing row).
  // null = not yet checked / not applicable, true = row exists OR could not be
  // determined, false = row *confirmed* missing.
  //
  // "Could not be determined" deliberately resolves to true: this check exists
  // only to catch the rare deleted-profile case, and its failure mode must not
  // be to eject a legitimately onboarded user into onboarding. See
  // authProfileService.profileRowStatus.
  const [profileVerifiedForLocalFlag, setProfileVerifiedForLocalFlag] = useState<boolean | null>(null)

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

  // Reset verification flag when the authenticated user changes so a prior user's
  // result cannot bleed into the next user's session. No guard needed — the state
  // starts as null and resetting to null on every userId change (including initial
  // mount) is intentional to ensure a clean slate per session.
  useEffect(() => {
    setProfileVerifiedForLocalFlag(null)
  }, [currentUserId])

  // When the local flag says onboarding is done but the AuthContext profile is still
  // null, verify that the Supabase profile row actually exists before allowing entry
  // to the main app. A completely missing row causes cascading null-access failures.
  useEffect(() => {
    if (profile != null) {
      // Profile is present in AuthContext — no separate fetch needed.
      setProfileVerifiedForLocalFlag(true)
      return
    }
    if (storageOnboardingDone !== true || !currentUserId || isLoading) {
      // Not in the scenario that requires an existence check.
      return
    }
    // Guard against stale results when the effect re-runs before the fetch resolves.
    let cancelled = false
    // Safety timeout: if the Supabase lookup hangs (e.g. a non-responsive
    // project, or a radio that hasn't woken up yet after the app was resumed)
    // stop blocking on it so the loading screen doesn't spin forever. A hang
    // tells us nothing about whether the row exists, so we let the user
    // through on the strength of their local onboarding flag rather than
    // sending them back through onboarding.
    const safetyTimeoutId = setTimeout(() => {
      if (!cancelled) setProfileVerifiedForLocalFlag(true)
    }, API_TIMEOUTS.DEFAULT)
    authProfileService
      .profileRowStatus(currentUserId)
      .then(status => {
        clearTimeout(safetyTimeoutId)
        // Only a *confirmed* absence forces onboarding. 'unknown' (network
        // error, expired JWT mid-refresh, Supabase unreachable) keeps the
        // user in the app — this is the resume-from-background path, where a
        // failed request is far more likely than a deleted account.
        if (!cancelled) setProfileVerifiedForLocalFlag(status !== 'missing')
      })
      .catch(() => {
        clearTimeout(safetyTimeoutId)
        if (!cancelled) setProfileVerifiedForLocalFlag(true)
      })
    return () => {
      cancelled = true
      clearTimeout(safetyTimeoutId)
    }
  }, [storageOnboardingDone, profile, currentUserId, isLoading])

  // Background repair: when the local flag says onboarding is done but the Supabase
  // profile still has onboarding_completed !== true (e.g. the write failed due to a
  // bad network), silently update the profile so future restarts work correctly.
  useEffect(() => {
    if (
      !repairAttemptedRef.current &&
      storageOnboardingDone === true &&
      currentUserId &&
      profile != null &&
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
  const allowedScreens = new Set(['bounty', 'wallet', 'postings', 'profile', 'messages', 'admin'])
  const paramScreen = typeof screen === 'string' && screen.length > 0 && allowedScreens.has(screen) ? screen : 'bounty'
  const allowedInitialTabs = new Set(['new', 'inProgress', 'myPostings', 'requests'])
  const paramInitialTab = typeof initialTab === 'string' && initialTab.length > 0 && allowedInitialTabs.has(initialTab) ? initialTab : undefined
  const [activeScreen, setActiveScreen] = useState(paramScreen)

  // Reports this tab shell's visible screen for analytics. Switching tabs
  // here (via BottomNav) never changes the route, so ScreenTracker in
  // app/_layout.tsx can't see it — this shell owns its own screen_viewed
  // calls instead, including the initial tab on arrival (tagged
  // 'notification' when opened from a notification deep link, 'push'
  // otherwise; later same-session tab switches are always 'tab').
  const isFirstActiveScreenReport = useRef(true)
  useEffect(() => {
    const navSource = isFirstActiveScreenReport.current
      ? (source === 'notification' ? 'notification' : 'push')
      : 'tab'
    isFirstActiveScreenReport.current = false
    trackScreenView(screenNameForBountyAppTab(activeScreen), { source: navSource })
    // Only the tab identity should retrigger this — `source` is read once,
    // on the very first report.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeScreen])

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

  // True while we are still waiting for async checks to complete:
  // - auth loading, OR
  // - per-user storage flag not yet read, OR
  // - profile row existence check in flight (local flag set but profile null)
  const isVerificationInProgress =
    isLoading ||
    storageOnboardingDone === null ||
    (storageOnboardingDone === true && profile == null && profileVerifiedForLocalFlag === null)

  if (isVerificationInProgress) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.background }}>
        <ActivityIndicator size="large" color={theme.primary} />
        <Text style={{ color: theme.text, marginTop: 16, fontSize: 16 }}>Loading...</Text>
      </View>
    )
  }

  // Guard: redirect users who haven't completed onboarding to the onboarding flow.
  // The profile is the authoritative source: if it explicitly marks onboarding as
  // required or incomplete, always redirect — even if the local flag says done.
  // Only when the profile is still null (Supabase propagation lag) do we fall back
  // to the local per-user flag to avoid looping back to the username screen.
  // Additionally, when the profile row is confirmed missing (profileVerifiedForLocalFlag
  // is false), force onboarding regardless — the local flag is stale.
  if (
    !isLoading &&
    session &&
    (
      // If the profile explicitly indicates onboarding is required OR
      // the profile is null/undefined and the per-user storage flag says not done,
      // redirect to onboarding. However, allow the per-user AsyncStorage
      // flag to temporarily override an authored `onboarding_completed: false`
      // value to reduce redirect loops when the DB/profile hasn't propagated yet.
      (profile != null && (profile.needs_onboarding === true || (profile.onboarding_completed === false && !storageOnboardingDone))) ||
      (profile == null && !storageOnboardingDone) ||
      // Profile row confirmed missing despite the local flag being set — stale flag.
      (profile == null && storageOnboardingDone === true && profileVerifiedForLocalFlag === false)
    )
  ) {
    if (__DEV__) {
      console.log('[bounty-app] Profile incomplete or onboarding not done, redirecting to onboarding')
    }
    return <Redirect href="/onboarding" />
  }

  return (
    <MomentsProvider activeScreen={activeScreen}>
      <View style={{ flex: 1, backgroundColor: theme.background, position: 'relative' }}>
        {/* Connection Status Banner - appears at top when offline */}
        <ConnectionStatus showQueueCount={true} />

        {/* BountyFeed is always mounted to preserve scroll position/cached data.
            BountyFeedFade cross-fades it in/out while other tabs are active,
            and is position:absolute so it doesn't take flex space away from
            whichever tab below is the current normal-flow child. */}
        <BountyFeedFade active={activeScreen === 'bounty'}>
          <BountyFeed
            ref={bountyFeedRef}
            activeScreen={activeScreen}
            setActiveScreen={setActiveScreen}
            currentUserId={currentUserId}
          />
        </BountyFeedFade>

        {activeScreen === "wallet" && (
          <FadeInScreen>
            <WalletScreen onBack={() => setActiveScreen("bounty")} />
          </FadeInScreen>
        )}
        {activeScreen === "postings" && (
          <FadeInScreen>
          <NeedHelpScreen
            activeScreen={activeScreen}
            setActiveScreen={setActiveScreen}
            onBountyPosted={() => bountyFeedRef.current?.refresh()} // Refresh feed when a new bounty is posted
            setShowBottomNav={setShowBottomNav}
          />
          </FadeInScreen>
        )}
        {activeScreen === "profile" && (
          <FadeInScreen>
            <ProfileScreen onBack={() => setActiveScreen("bounty")} />
          </FadeInScreen>
        )}
        {activeScreen === "messages" && (
          <FadeInScreen>
          <InboxScreen
            initialTab={pendingInitialTab ?? paramInitialTab}
            onBack={() => setActiveScreen("bounty")}
            activeScreen={activeScreen}
            setActiveScreen={setActiveScreen}
            onBountyAccepted={() => bountyFeedRef.current?.refresh()} // Refresh feed when a bounty is accepted
          />
          </FadeInScreen>
        )}

        {showBottomNav && <BottomNav activeScreen={activeScreen} onNavigate={setActiveScreen} showAdmin={showAdminTab} onBountyTabRepress={handleBountyTabRepress} unreadMessageCount={unreadMessageCount} />}

        {/* Moments Queue host — global, so a contextual activation prompt
            (verify identity, set up payouts, enable notifications, etc.)
            can surface over any tab, not just right after onboarding. */}
        <MomentSheet />
      </View>
    </MomentsProvider>
  )
}

export function BountyApp() {
  return <BountyAppInner />
}

// Styles — container background is intentionally sourced from BountyAppInner's theme hook
export default function BountyAppRoute() {
  return <BountyApp />
}
