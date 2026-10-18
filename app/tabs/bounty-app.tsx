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
import { TabPagerContext } from 'components/ui/tab-pager'
import type { TabPager } from 'components/ui/tab-pager'
import { MomentSheet } from '../../components/moments/MomentSheet'
import { MomentsProvider } from '../../providers/moments-provider'
// Search moved to its own route (app/tabs/search.tsx) so we no longer render it inline.
import AsyncStorage from '@react-native-async-storage/async-storage'
import { BottomNav } from 'components/ui/bottom-nav'
import { FloatingTabBar } from 'components/ui/floating-tab-bar'
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ActivityIndicator, Animated, AppState, Keyboard, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import { useAuthContext } from '../../hooks/use-auth-context'
import { useTabBackToFeed } from '../../hooks/useTabBackToFeed'
import { useConversations } from '../../hooks/useConversations'
import { useAdmin } from '../../lib/admin-context'
import { ROUTES } from '../../lib/routes'
import { screenNameForBountyAppTab } from '../../lib/analytics/screen-name'
import { trackScreenView } from '../../lib/analytics/screen-tracking'
import { ReplayMask } from '../../components/replay-mask'
import { API_TIMEOUTS } from '../../lib/config/network'
import { authProfileService } from '../../lib/services/auth-profile-service'
import { navigationIntent } from '../../lib/services/navigation-intent'
import { getOnboardingCompleteKey } from '../../lib/storage/onboarding'
import { saveLastScreen } from '../../lib/storage/last-screen'
import { useAppThemeContext } from '../../lib/themes/AppThemeContext'
import { useTopInsetOverlay } from '../../lib/context/TopInsetOverlayContext'

// Main tab bar style. FloatingTabBar is the compact floating pill; BottomNav
// is the classic full-width bar with the raised crosshair, kept for later —
// swap this line back to `BottomNav` to restore it.
const MainTabBar: typeof BottomNav = FloatingTabBar

// Left-to-right order of the tabs you can swipe between — must match the
// FloatingTabBar order. Admin is never swipeable: it pushes its own route
// rather than rendering in this shell. When the admin tab replaces Profile
// in the bar, Profile drops out of the swipe order too.
const SWIPE_ORDER = ['messages', 'wallet', 'bounty', 'postings', 'profile']
const SWIPE_ORDER_WITH_ADMIN = ['messages', 'wallet', 'bounty', 'postings']

// How long a tab-bar tap's animated scroll to the adjacent tab is given
// before its result is committed anyway. Android's programmatic smooth
// scroll doesn't report momentum end; iOS does, and commits sooner.
const TAP_SCROLL_COMMIT_FALLBACK_MS = 500

// One page of the native pager, exactly one pager wide. Memoised so a shell
// re-render (the tab bar highlight, the unread badge) that hands it the same
// size and the same memoised screen element skips the screen entirely.
const PagerPage = memo(function PagerPage({
  width,
  height,
  children,
}: {
  width: number
  height: number
  children: React.ReactNode
}) {
  return <View style={{ width, height }}>{children}</View>
})

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
  const [activeScreen, setActiveScreenState] = useState(paramScreen)

  // Reports this tab shell's visible screen for analytics. Switching tabs
  // here (via BottomNav) never changes the route, so ScreenTracker in
  // app/_layout.tsx can't see it — this shell owns its own screen-view
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

  // ── Swipe between tabs ────────────────────────────────────────────────
  // The tabs sit side by side in a native horizontal paging ScrollView —
  // the platform's own pager (UIScrollView paging on iOS), as Instagram
  // uses: it tracks the finger 1:1 from the first point, can be caught and
  // reversed mid-fling, and settles with native momentum, all on the UI
  // thread. JS only hears about it to move the tab bar highlight (at the
  // halfway point) and to commit the new tab once the pager comes to rest.
  //
  // A tab mounts the first time it is visited or becomes a neighbour of the
  // current tab, and then stays mounted, so swiping never waits on a mount.
  const { width: windowWidth, height: windowHeight } = useWindowDimensions()
  const [pagerSize, setPagerSize] = useState({ width: windowWidth, height: windowHeight })
  const pageWidth = pagerSize.width
  const swipeOrder = showAdminTab ? SWIPE_ORDER_WITH_ADMIN : SWIPE_ORDER
  // The tab bar highlight. Runs ahead of activeScreen: it follows the pager
  // live, while activeScreen commits only once the pager settles.
  const [barScreen, setBarScreen] = useState(paramScreen)
  const [mountedTabs, setMountedTabs] = useState<ReadonlySet<string>>(() => new Set([paramScreen]))

  const pagerRef = useRef<ScrollView>(null)
  // The native pager's gesture, so a swipe nested inside a tab (the Inbox
  // segments) can make it wait — see components/ui/tab-pager.ts.
  const pagerGesture = useMemo(() => Gesture.Native(), [])
  // JS-side committed state, read synchronously by scroll callbacks that
  // can fire several times before React re-renders.
  const activeRef = useRef(paramScreen)
  const barRef = useRef(paramScreen)
  const swipeOrderRef = useRef(swipeOrder)
  swipeOrderRef.current = swipeOrder
  const pageWidthRef = useRef(pageWidth)
  pageWidthRef.current = pageWidth
  const lastOffsetXRef = useRef(0)
  const draggingRef = useRef(false)
  const tapCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // A tap that jumps past the neighbours: committed first (so the target
  // mounts), then the pager jumps there once React has rendered it.
  const [pendingJump, setPendingJump] = useState<string | null>(null)

  useEffect(() => () => {
    if (tapCommitTimerRef.current) clearTimeout(tapCommitTimerRef.current)
  }, [])

  // Mount `key` and its swipe neighbours (they stay mounted from then on).
  const mountAround = useCallback((key: string) => {
    const order = swipeOrderRef.current
    const idx = order.indexOf(key)
    const wanted = [key, order[idx - 1], order[idx + 1]].filter(
      (k): k is string => typeof k === 'string'
    )
    setMountedTabs(prev => {
      if (wanted.every(k => prev.has(k))) return prev
      const next = new Set(prev)
      wanted.forEach(k => next.add(k))
      return next
    })
  }, [])

  // The current tab's neighbours mount once the shell has painted, not in
  // the same frame as the tab itself.
  useEffect(() => {
    mountAround(activeScreen)
  }, [activeScreen, mountAround])

  const setBar = useCallback((key: string) => {
    if (barRef.current === key) return
    barRef.current = key
    setBarScreen(key)
  }, [])

  const commitScreen = useCallback((key: string) => {
    setBar(key)
    if (activeRef.current === key) return
    activeRef.current = key
    setActiveScreenState(key)
  }, [setBar])

  const commitIndex = useCallback((idx: number) => {
    if (tapCommitTimerRef.current) {
      clearTimeout(tapCommitTimerRef.current)
      tapCommitTimerRef.current = null
    }
    const key = swipeOrderRef.current[idx]
    if (key) commitScreen(key)
  }, [commitScreen])

  const scrollToIndex = useCallback((idx: number, animated: boolean) => {
    const x = idx * pageWidthRef.current
    lastOffsetXRef.current = x
    pagerRef.current?.scrollTo?.({ x, y: 0, animated })
  }, [])

  const onPagerScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const x = e.nativeEvent.contentOffset.x
    lastOffsetXRef.current = x
    const width = pageWidthRef.current
    if (width <= 0) return
    const key = swipeOrderRef.current[Math.round(x / width)]
    if (key) setBar(key)
  }, [setBar])

  const onPagerScrollBeginDrag = useCallback(() => {
    draggingRef.current = true
    Keyboard.dismiss()
  }, [])

  // Released exactly on a page boundary there is no momentum phase (and so
  // no momentum-end event) — commit straight away.
  const onPagerScrollEndDrag = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    draggingRef.current = false
    const x = e.nativeEvent.contentOffset.x
    const width = pageWidthRef.current
    if (width <= 0) return
    const idx = Math.round(x / width)
    if (Math.abs(x - idx * width) < 1) commitIndex(idx)
  }, [commitIndex])

  const onPagerSettled = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const width = pageWidthRef.current
    if (width <= 0) return
    commitIndex(Math.round(e.nativeEvent.contentOffset.x / width))
  }, [commitIndex])

  // Every programmatic tab change (tab bar taps, a child's onBack, a
  // navigation intent) goes through here. Like Instagram's tab bar, an
  // adjacent tab scrolls over and anything further jumps straight there.
  const setActiveScreen = useCallback((next: string) => {
    const prev = activeRef.current
    if (next === prev) return
    Keyboard.dismiss()
    const order = swipeOrderRef.current
    const fromIdx = order.indexOf(prev)
    const toIdx = order.indexOf(next)
    if (toIdx !== -1 && fromIdx !== -1 && Math.abs(toIdx - fromIdx) === 1) {
      setBar(next)
      scrollToIndex(toIdx, true)
      if (tapCommitTimerRef.current) clearTimeout(tapCommitTimerRef.current)
      tapCommitTimerRef.current = setTimeout(() => {
        tapCommitTimerRef.current = null
        // Commit wherever the pager actually is — the poster may have
        // grabbed it mid-scroll.
        if (draggingRef.current) return
        const width = pageWidthRef.current
        if (width > 0) commitIndex(Math.round(lastOffsetXRef.current / width))
      }, TAP_SCROLL_COMMIT_FALLBACK_MS)
      return
    }
    // Mount the target in the same render as the commit, so the jump below
    // lands on a rendered page rather than an empty one.
    mountAround(next)
    commitScreen(next)
    if (toIdx !== -1) setPendingJump(next)
  }, [setBar, scrollToIndex, commitIndex, commitScreen, mountAround])

  // Jump once the target tab has rendered (it may have just mounted), so the
  // pager never lands on an empty page.
  useEffect(() => {
    if (!pendingJump) return
    setPendingJump(null)
    const idx = swipeOrderRef.current.indexOf(pendingJump)
    if (idx !== -1) scrollToIndex(idx, false)
  }, [pendingJump, scrollToIndex])

  // Keep the pager on the current tab when its geometry changes underneath
  // it: rotation / a resized window, or the admin toggle changing the order.
  useEffect(() => {
    const idx = swipeOrder.indexOf(activeRef.current)
    if (idx !== -1) scrollToIndex(idx, false)
  }, [pageWidth, swipeOrder, scrollToIndex])

  const onPagerLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout
    setPagerSize(prev => (prev.width === width && prev.height === height ? prev : { width, height }))
  }, [])

  const activeIdx = swipeOrder.indexOf(activeScreen)
  const initialPagerOffset = useMemo(
    () => ({ x: Math.max(0, swipeOrder.indexOf(paramScreen)) * windowWidth, y: 0 }),
    // Only the first render's offset matters; later moves go through scrollTo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )
  const swipeEnabled = showBottomNav && activeIdx !== -1

  // The pager's live scroll position, natively driven: things outside the
  // pages that must move with them (the status-bar strip's green, which
  // RootFrame draws above every screen) interpolate it on the UI thread
  // rather than waiting for the swipe to commit — see pageTranslateX.
  const pagerScrollX = useRef(new Animated.Value(initialPagerOffset.x)).current
  const onPagerScrollEvent = useMemo(
    () =>
      Animated.event([{ nativeEvent: { contentOffset: { x: pagerScrollX } } }], {
        useNativeDriver: true,
        listener: onPagerScroll,
      }),
    [pagerScrollX, onPagerScroll]
  )
  const tabPager = useMemo<TabPager>(
    () => ({ gesture: pagerGesture, scrollX: pagerScrollX, pageWidth, order: swipeOrder }),
    [pagerGesture, pagerScrollX, pageWidth, swipeOrder]
  )

  // The status-bar icons take their colour from the overlay of the tab
  // mostly on screen, flipping at the halfway point with the tab bar.
  const setTopInsetFocusKey = useTopInsetOverlay()?.setFocusKey
  useEffect(() => {
    setTopInsetFocusKey?.(barScreen)
  }, [barScreen, setTopInsetFocusKey])
  useEffect(() => () => setTopInsetFocusKey?.(null), [setTopInsetFocusKey])

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
    // Consume the pending intent once, on mount — not again whenever the
    // swipe order (and so setActiveScreen's identity) changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // If the admin tab is selected, navigate to the admin route from an effect
  // to avoid triggering navigation/state updates during render (which causes
  // the "Cannot update a component while rendering a different component" error).
  //
  // The console is its own stack screen, so the shell must not stay parked on
  // 'admin' (it renders nothing for it): backing out of the console used to
  // land on an empty shell, and tapping Admin again was a no-op because the
  // state never changed — the operator was stuck (GitHub #807).
  useEffect(() => {
    if (activeScreen === 'admin' && showAdminTab) {
      router.push(ROUTES.ADMIN.INDEX)
      setActiveScreen('bounty')
    }
  }, [activeScreen, showAdminTab, router, setActiveScreen])

  const handleNavigate = useCallback((next: string) => {
    if (next === 'admin') {
      if (showAdminTab) router.push(ROUTES.ADMIN.INDEX)
      return
    }
    setActiveScreen(next)
  }, [showAdminTab, router, setActiveScreen])

  // Android hardware back returns to the feed from the other tabs, instead
  // of closing the app. See useTabBackToFeed for why it is focus-scoped.
  const showFeed = useCallback(() => setActiveScreen('bounty'), [setActiveScreen])
  useTabBackToFeed(activeScreen, showFeed)

  // Screen elements are memoised so React skips them on shell re-renders
  // (the tab bar highlight moving on release, unread-count updates) — only
  // a change to a screen's own props re-renders it.
  const backToFeed = useCallback(() => setActiveScreen('bounty'), [setActiveScreen])
  const refreshFeed = useCallback(() => bountyFeedRef.current?.refresh(), [])
  // BountyFeed only ever compares activeScreen against 'bounty', so it gets
  // just that distinction; the raw value would re-render the whole feed on
  // every tab change.
  const feedActiveScreen = activeScreen === 'bounty' ? 'bounty' : 'elsewhere'
  const inboxInitialTab = pendingInitialTab ?? paramInitialTab
  const feedPage = useMemo(
    () => (
      <BountyFeed
        ref={bountyFeedRef}
        activeScreen={feedActiveScreen}
        setActiveScreen={setActiveScreen}
        currentUserId={currentUserId}
      />
    ),
    [feedActiveScreen, setActiveScreen, currentUserId]
  )
  const walletPage = useMemo(
    () => (
      <ReplayMask>
        <WalletScreen onBack={backToFeed} />
      </ReplayMask>
    ),
    [backToFeed]
  )
  const profilePage = useMemo(() => <ProfileScreen onBack={backToFeed} />, [backToFeed])
  // InboxScreen and NeedHelpScreen take activeScreen but never read it; a
  // constant keeps them from re-rendering on every tab change.
  const inboxPage = useMemo(
    () => (
      <ReplayMask>
        <InboxScreen
          initialTab={inboxInitialTab}
          onBack={backToFeed}
          activeScreen="messages"
          setActiveScreen={setActiveScreen}
          onBountyAccepted={refreshFeed} // Refresh feed when a bounty is accepted
        />
      </ReplayMask>
    ),
    [inboxInitialTab, backToFeed, setActiveScreen, refreshFeed]
  )
  // The Post tab is preloaded like every other neighbour, so it slides in
  // fully rendered instead of mounting the whole composer after the slide.
  // It only becomes `isActive` once the pager comes to rest on it (that is
  // when activeScreen commits): until then CreateBountyFlow is inert (no
  // funnel analytics, back handler or status-bar tint), so sitting beside
  // Home, or being swiped past, logs nothing.
  const postIsActive = activeScreen === 'postings'
  const postPage = useMemo(
    () => (
      <NeedHelpScreen
        activeScreen="postings"
        setActiveScreen={setActiveScreen}
        onBountyPosted={refreshFeed} // Refresh feed when a new bounty is posted
        setShowBottomNav={setShowBottomNav}
        isActive={postIsActive}
      />
    ),
    [setActiveScreen, refreshFeed, postIsActive]
  )
  const pageFor = (key: string): React.ReactNode => {
    switch (key) {
      case 'wallet': return walletPage
      case 'profile': return profilePage
      case 'messages': return inboxPage
      case 'postings': return postPage
      default: return null
    }
  }
  // Remember the visible tab so a cold start can reopen it (see
  // lib/storage/last-screen.ts and the root gate in app/index.tsx). Saved on
  // every switch and again when the app leaves the foreground, so the
  // restore window counts from when the user actually left.
  const activeScreenRef = useRef(activeScreen)
  activeScreenRef.current = activeScreen
  useEffect(() => {
    if (!currentUserId || activeScreen === 'admin') return
    void saveLastScreen(currentUserId, activeScreen)
  }, [activeScreen, currentUserId])
  useEffect(() => {
    if (!currentUserId) return
    const sub = AppState.addEventListener('change', next => {
      if ((next === 'background' || next === 'inactive') && activeScreenRef.current !== 'admin') {
        void saveLastScreen(currentUserId, activeScreenRef.current)
      }
    })
    return () => sub.remove()
  }, [currentUserId])

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

        <TabPagerContext.Provider value={tabPager}>
          <GestureDetector gesture={pagerGesture}>
            <Animated.ScrollView
              ref={pagerRef}
              style={StyleSheet.absoluteFill}
              onLayout={onPagerLayout}
              horizontal
              pagingEnabled
              scrollEnabled={swipeEnabled}
              contentOffset={initialPagerOffset}
              showsHorizontalScrollIndicator={false}
              directionalLockEnabled
              decelerationRate="fast"
              disableIntervalMomentum
              overScrollMode="never"
              // The pager must never claim taps meant for the tabs inside it
              // (e.g. a Post CTA while its keyboard is up), and must not
              // compete with the tabs' own lists for status-bar scroll-to-top.
              keyboardShouldPersistTaps="always"
              scrollsToTop={false}
              scrollEventThrottle={16}
              onScroll={onPagerScrollEvent}
              onScrollBeginDrag={onPagerScrollBeginDrag}
              onScrollEndDrag={onPagerScrollEndDrag}
              onMomentumScrollEnd={onPagerSettled}
            >
              {swipeOrder.map(key => (
                <PagerPage key={key} width={pageWidth} height={pagerSize.height}>
                  {/* BountyFeed is always mounted to preserve scroll
                      position/cached data; the others mount on first visit
                      or once they neighbour the current tab. */}
                  {key === 'bounty' ? feedPage : mountedTabs.has(key) ? pageFor(key) : null}
                </PagerPage>
              ))}
            </Animated.ScrollView>
          </GestureDetector>
        </TabPagerContext.Provider>

        {/* A tab outside the swipe order (Profile while the Admin tab has
            taken its place in the bar) shows over the pager instead. */}
        {activeIdx === -1 && activeScreen !== 'admin' && (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.background }]}>
            {pageFor(activeScreen)}
          </View>
        )}

        {showBottomNav && (
          <MainTabBar activeScreen={barScreen} onNavigate={handleNavigate} showAdmin={showAdminTab} onBountyTabRepress={handleBountyTabRepress} unreadMessageCount={unreadMessageCount} />
        )}

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
