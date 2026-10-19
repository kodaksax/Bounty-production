"use client"

import { getUserFriendlyError } from '../../lib/utils/error-messages'
import { saveStructuredBountyEdit } from '../../lib/services/bounty-requirements-service';
import { useFocusEffect, useRouter } from "expo-router"
import { discardApplication, withdrawApplication } from "lib/services/application-withdrawal"
import type { BountyRequestWithDetails } from "lib/services/bounty-request-service"
import { bountyRequestService } from "lib/services/bounty-request-service"
import { bountyService } from "lib/services/bounty-service"
import type { Bounty } from "lib/services/database.types"
import type { Conversation } from "lib/types"
import type { BountyLifecycleState } from "lib/utils/bounty-lifecycle"
import {
  filterManagementBounties,
  markBountyRemovedLocally,
} from "lib/utils/bounty-visibility"
import {
  filterHunterHiddenBounties,
  hideBountyForHunter,
  loadHunterHiddenBountyIds,
} from "lib/utils/hunter-hidden-bounties"
import { isBountyDeadlinePassed } from "lib/utils/schedule-utils"
import * as React from "react"
import { useEffect, useMemo, useRef, useState } from "react"
import { Alert, FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from "react-native"
// Gesture-handler's ScrollView so the filter chips claim horizontal drags
// before the tab shell's swipe-between-tabs pan (app/tabs/bounty-app.tsx).
import { Gesture, GestureDetector, ScrollView } from "react-native-gesture-handler"
import Reanimated, { Easing, interpolateColor, runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated"
import type { SharedValue } from "react-native-reanimated"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { useTabPager } from "../../components/ui/tab-pager"
import { defaultInboxSegment, inboxSegmentForLink } from '../../lib/navigation/bounty-app-tab'
import { BrandingLogo } from "../../components/ui/branding-logo"
import { BountyConversationRow, type InboxPerson } from "../../components/bounty-inbox/thread-list-row"
import { NotNearbyToggle } from "../../components/not-nearby-toggle"
import { formatApplicantDistance, partitionApplicantsByDistance } from "lib/utils/applicant-distance"
import { EditPostingModal } from "../../components/edit-posting-modal"
import { getBottomNavContentPadding } from "../../lib/constants/navigation"
import { useConversations } from '../../hooks/useConversations'
import { findPairConversation } from '../../hooks/useBountyThread'
import { useValidUserId } from '../../hooks/useValidUserId'
import { supabase } from '../../lib/supabase'
import { uniqueRealtimeTopic } from '../../lib/utils/realtime-topic'
import { OfflineStatusBadge } from '../../components/offline-status-badge'
import { EmptyState } from '../../components/ui/empty-state'
import { PostingsListSkeleton } from '../../components/ui/skeleton-loaders'
import { useApplicantListViewed } from '../../hooks/useApplicantListViewed'
import type { InProgressStatusFilter, MyPostingsStatusFilter } from '../../hooks/useBountyStatusFilters'
import {
  IN_PROGRESS_FILTERS,
  IN_PROGRESS_FILTER_LABELS,
  MY_POSTINGS_FILTERS,
  MY_POSTINGS_FILTER_LABELS,
  useBountyStatusFilters,
} from '../../hooks/useBountyStatusFilters'
import { BountyRefundFailedError, cancelAndRefundBounty } from '../../lib/services/bounty-cancel-refund'
import { describeBountyUpdateError, toBountyUpdateError } from '../../lib/services/bounty-update-error'
import { useWallet } from '../../lib/wallet-context'
import { useAppThemeContext } from '../../lib/themes/AppThemeContext'
import type { AppTheme } from '../../lib/themes/types'
import { hapticFeedback } from '../../lib/haptic-feedback'

interface InboxScreenProps {
  onBack?: () => void
  initialTab?: string
  activeScreen: string
  setActiveScreen: (screen: string) => void
  onBountyAccepted?: (bountyId?: string | number) => void // Callback when a bounty is accepted
}

/**
 * InboxScreen — the "My Bounties" bottom-nav tab.
 *
 * Two top tabs, both laid out as a DM inbox: My Work (bounties this user
 * applied to / is working, as the hunter) and My Bounties (bounties they
 * posted, as the poster). Each row opens a bounty thread
 * (app/tabs/bounty-thread/[bountyId].tsx) where the workflow plays out as
 * interactive cards between ordinary messages. Applications that used to sit
 * in a separate Requests tab now arrive as rows in My Bounties.
 *
 * The general messaging inbox still lives in `messenger-screen.tsx` and is
 * reached from the header's chat icon.
 */
// My Work / My Bounties. Old deep links still resolve: "requests" (the
// retired Requests tab) opens My Bounties, where applications now live. With
// no link (or an unknown value) the Inbox starts on My Work and, once the
// poster's own bounties load, moves to My Bounties if any is open — see
// defaultInboxSegment (SBA-10).
function segmentForInitialTab(initialTab: string | undefined): InboxTab {
  return inboxSegmentForLink(initialTab) ?? "inProgress"
}

export function InboxScreen({ onBack, initialTab, activeScreen, setActiveScreen, onBountyAccepted }: InboxScreenProps) {
  const rawUserId = useValidUserId()
  const currentUserId = rawUserId ?? undefined
  const router = useRouter()

  const [activeTab, setActiveTab] = useState<InboxTab>(segmentForInitialTab(initialTab))
  // Once anything has chosen the segment — a link, a tap, a swipe, or the
  // default below — the default never moves it again.
  const segmentDecidedRef = useRef(inboxSegmentForLink(initialTab) !== null)
  // Which user's posted bounties `myBounties` holds. The default waits for
  // this rather than for the loading flag, which the signed-out branch clears
  // before the user id resolves.
  const [myBountiesLoadedFor, setMyBountiesLoadedFor] = useState<string | null>(null)
  const [headerHeight, setHeaderHeight] = useState(0)
  const [showShadow, setShowShadow] = useState(false)

  // State for Supabase data
  const [myBounties, setMyBounties] = useState<Bounty[]>([])
  const [inProgressBounties, setInProgressBounties] = useState<Bounty[]>([])
  const [bountyRequests, setBountyRequests] = useState<BountyRequestWithDetails[]>([])
  const [isLoading, setIsLoading] = useState({
    myBounties: true,
    inProgress: true,
    requests: true,
  })
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Bounty ids this hunter hid from their own In Progress list via the
  // "Hide"/"Remove from List" card actions. Persisted per-user (see
  // lib/utils/hunter-hidden-bounties.ts) so a hidden card stays hidden across
  // tab switches and app restarts instead of resetting on remount — see
  // issue #779 (InboxScreen unmounts entirely when this tab loses focus).
  const [hunterHiddenBountyIds, setHunterHiddenBountyIds] = useState<Set<string>>(new Set())

  const insets = useSafeAreaInsets()
  const HEADER_TOP_OFFSET = 55 // how far the header is visually pulled up
  const { conversations, refresh: refreshConversations } = useConversations()
  const { refundEscrow } = useWallet()
  const { theme } = useAppThemeContext()
  const styles = useMemo(() => makeStyles(theme), [theme])
  // Filter chip state for each tab; kept separate so toggling one doesn't affect the other.
  // Every chip other than 'all' selects a single displayed badge — see
  // hooks/useBountyStatusFilters.
  const [statusFilterInProgress, setStatusFilterInProgress] = useState<InProgressStatusFilter>('all')
  const [statusFilterMyPostings, setStatusFilterMyPostings] = useState<MyPostingsStatusFilter>('all')
  // Keep the hunter's requests so we can filter In Progress by request status (applied/accepted/rejected)
  const [hunterRequests, setHunterRequests] = useState<BountyRequestWithDetails[]>([])
  // Edit/Delete state
  const [showEditModal, setShowEditModal] = useState(false)
  const [editingBounty, setEditingBounty] = useState<Bounty | null>(null)
  // Bounty ids with a delete/refund in flight — blocks repeat taps from
  // re-entering the refund and firing duplicate escrow events.
  const deletingBountyIdsRef = useRef<Set<string>>(new Set())

  // ---- Data Loaders ----
  const loadRequestsForMyBounties = React.useCallback(async (bounties: Bounty[]) => {
    try {
      if (!bounties?.length) {
        setBountyRequests([])
        setIsLoading((prev) => ({ ...prev, requests: false }))
        return
      }
      // Only load requests for bounties that are currently OPEN.
      // Once a bounty is accepted (in_progress) we should no longer show its requests in the Requests tab.
      const openBounties = bounties.filter(b => b.status === 'open')
      if (openBounties.length === 0) {
        setBountyRequests([])
        setIsLoading((prev) => ({ ...prev, requests: false }))
        return
      }
      setIsLoading((prev) => ({ ...prev, requests: true }))
      // Batch fetch requests for all open bounties — only pending so the Requests tab
      // surfaces only unreviewed applications (accepted/rejected ones are handled elsewhere).
      const ids = openBounties.map(b => String(b.id))
      const requests = await bountyRequestService.getAllWithDetailsBatch(ids, { status: 'pending', page: 1, pageSize: 200 })
      setBountyRequests(requests)
    } catch (e: any) {
      console.error('Error loading bounty requests:', e)
      setError('Failed to load bounty requests')
    } finally {
      setIsLoading((prev) => ({ ...prev, requests: false }))
    }
  }, [])

  const loadMyBounties = React.useCallback(async () => {
    // Guard: don't load if no valid user
    if (!currentUserId) {
      // Immediately clear loading flags and empty data to avoid stuck skeletons
      setIsLoading((prev) => ({ ...prev, myBounties: false, requests: false }))
      setMyBounties([])
      setBountyRequests([])
      return
    }

    try {
      setIsLoading((prev) => ({ ...prev, myBounties: true }))
      setError(null) // Clear previous error
      const mine = await bountyService.getByUserId(currentUserId)
      // One shared lifecycle filter (see lib/utils/bounty-visibility) rather
      // than an inline status check, re-applied on EVERY load: it also drops
      // bounties this client just removed, so a query that raced the mutation
      // cannot put them back when the screen remounts after a tab switch.
      const activeBounties = filterManagementBounties(mine)
      setMyBounties(activeBounties)
      setMyBountiesLoadedFor(currentUserId)
      setIsLoading((prev) => ({ ...prev, myBounties: false }))
      // Load related requests
      await loadRequestsForMyBounties(activeBounties)
    } catch (e: any) {
      console.error('Error loading my bounties:', e)
      setError('Failed to load your bounties')
      setIsLoading((prev) => ({ ...prev, myBounties: false }))
    }
  }, [loadRequestsForMyBounties, currentUserId])

  const loadInProgress = React.useCallback(async () => {
    // Guard: don't load if no valid user
    if (!currentUserId) {
      // Immediately clear loading flags and empty data to avoid stuck skeletons
      setIsLoading((prev) => ({ ...prev, inProgress: false }))
      setInProgressBounties([])
      return
    }

    try {
      setIsLoading((prev) => ({ ...prev, inProgress: true }))
      setError(null) // Clear previous error
      // Show bounties that the current user has applied for (pending/accepted/rejected/etc.)
      // Include rejected requests so we can surface a 'Rejected' badge and provide a discard action.
      const requests = await bountyRequestService.getAllWithDetails({ userId: currentUserId })
      const relevant = requests // keep all statuses (pending, accepted, rejected)
      // Keep requests so we can filter by request.status in the UI
      setHunterRequests(relevant)
      // Map to unique bounties
      const map = new Map<string, Bounty>()
      for (const r of relevant) {
        const b = r?.bounty as Bounty | undefined
        if (b && !map.has(String(b.id))) map.set(String(b.id), b)
      }
      setInProgressBounties(filterManagementBounties(Array.from(map.values())))
    } catch (e: any) {
      console.error('Error loading applied bounties for In Progress:', e)
      setError('Failed to load your applied bounties')
    } finally {
      setIsLoading((prev) => ({ ...prev, inProgress: false }))
    }
  }, [currentUserId])

  // Combined refresh for both hunter and poster views
  const refreshAll = React.useCallback(async () => {
    setIsRefreshing(true)
    try {
      await Promise.all([loadMyBounties(), loadInProgress()])
    } finally {
      setIsRefreshing(false)
    }
  }, [loadMyBounties, loadInProgress])

  // Unreviewed applications per posting. An open bounty with applications is
  // the poster's most common "needs your attention" state and cannot be seen
  // from the bounty row alone, so the grouping needs it explicitly.
  const applicationCounts = React.useMemo(() => {
    const counts = new Map<string, number>()
    for (const r of bountyRequests) {
      if (r.status !== 'pending') continue
      const key = String(r.bounty_id)
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return counts
  }, [bountyRequests])

  // Fetch data from the API
  useEffect(() => {
    // Only load data if we have a valid authenticated user
    if (!currentUserId) {
      // Immediately clear loading flags and empty data arrays to avoid stuck skeletons
      setIsLoading({ myBounties: false, inProgress: false, requests: false })
      setMyBounties([])
      setInProgressBounties([])
      setBountyRequests([])
      return
    }

    setError(null)
    // Load in parallel
    loadMyBounties()
    loadInProgress()
  }, [loadMyBounties, loadInProgress, currentUserId])

  // Load this hunter's persisted "hidden from In Progress" ids so a card
  // dismissed via "Hide"/"Remove from List" on a previous visit — or before
  // an app restart — stays off the list on this load too, not just the one
  // where it was hidden.
  useEffect(() => {
    let active = true
    if (!currentUserId) {
      setHunterHiddenBountyIds(new Set())
      return
    }
    loadHunterHiddenBountyIds(currentUserId).then((ids) => {
      if (active) setHunterHiddenBountyIds(ids)
    })
    return () => {
      active = false
    }
  }, [currentUserId])

  // Realtime applicant counts: a single list-level subscription (not one per
  // row — see MyPostingExpandable's completion-status subscriptions for why
  // that doesn't scale) covering bounty_requests for all of this poster's
  // currently-open bounties. Rebuilds only when the actual set of open
  // bounty ids changes, not on every myBounties re-render.
  const myBountiesRef = useRef<Bounty[]>(myBounties)
  useEffect(() => {
    myBountiesRef.current = myBounties
  }, [myBounties])

  const openBountyIdsKey = React.useMemo(
    () => myBounties.filter((b) => b.status === 'open').map((b) => String(b.id)).sort().join(','),
    [myBounties]
  )

  useEffect(() => {
    const ids = openBountyIdsKey ? openBountyIdsKey.split(',') : []
    if (!currentUserId || ids.length === 0) return

    const channel = supabase
      .channel(uniqueRealtimeTopic(`inbox-requests:${currentUserId}`))
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'bounty_requests', filter: `bounty_id=in.(${ids.join(',')})` },
        () => {
          loadRequestsForMyBounties(myBountiesRef.current)
        }
      )
      .subscribe()

    return () => {
      try {
        supabase.removeChannel(channel)
      } catch {
        // best-effort cleanup
      }
    }
  }, [openBountyIdsKey, currentUserId, loadRequestsForMyBounties])

  // Applicants are now reviewed from My Bounties.
  useApplicantListViewed(bountyRequests, activeTab === 'myPostings', isLoading.requests)

  // Set of bounty IDs that have at least one pending hunter application.
  // Used to prevent the poster from editing bounty terms after a hunter has applied.
  const bountiesWithPendingRequestsSet = React.useMemo(() => {
    const pendingBountyIds = new Set<string>()
    bountyRequests.forEach((r) => {
      if (r.status === 'pending') pendingBountyIds.add(String(r.bounty_id))
    })
    return pendingBountyIds
  }, [bountyRequests])

  const handleEditBounty = React.useCallback((bounty: Bounty) => {
    if (bountiesWithPendingRequestsSet.has(String(bounty.id))) {
      Alert.alert(
        "Cannot Edit Posting",
        "This bounty already has hunters who have applied. You cannot change the terms after someone has applied.",
        [{ text: "OK" }]
      )
      return
    }
    setEditingBounty(bounty)
    setShowEditModal(true)
  }, [bountiesWithPendingRequestsSet])

  const handleSaveEdit = async (updates: Partial<Bounty>) => {
    if (updates.requirements_payload !== undefined) {
      if (!editingBounty) throw new Error('No posting selected')
      const updated = await saveStructuredBountyEdit(editingBounty.id, updates)
      setMyBounties((prev) => prev.map((b) => (b.id === editingBounty.id ? updated : b)))
      setShowEditModal(false)
      setEditingBounty(null)
      return
    }
    if (!editingBounty) return

    try {
      // Re-validate pending applications to avoid a race where someone
      // applied while the poster was editing the bounty.
      try {
        const pending = await bountyRequestService.getAll({ bountyId: editingBounty.id, status: 'pending' })
        if (pending && pending.length > 0) {
          Alert.alert(
            "Cannot Edit Posting",
            "A hunter applied while you were editing. You cannot change the terms after someone has applied.",
            [{ text: "OK" }]
          )
          return
        }
      } catch (checkErr) {
        // If we cannot verify (likely network or service error), block the update to be safe.
        console.error('Failed to re-check pending requests before save:', checkErr)
        Alert.alert(
          'Cannot Edit Posting',
          "We couldn't verify whether any new applications arrived while you were editing. Please check your internet connection, review the bounty's current status, and then try saving again."
        )
        return
      }

      // Optimistic update after revalidation
      const optimisticBounty = { ...editingBounty, ...updates }
      setMyBounties((prev) =>
        prev.map((b) => (b.id === editingBounty.id ? optimisticBounty : b))
      )

      // API call
      const updated = await bountyService.update(editingBounty.id, updates)

      if (!updated) {
        throw new Error("Failed to update bounty")
      }

      // Update with actual response
      setMyBounties((prev) =>
        prev.map((b) => (b.id === editingBounty.id ? updated : b))
      )

      setShowEditModal(false)
      setEditingBounty(null)
    } catch (err: any) {
      // Rollback optimistic update
      setMyBounties((prev) =>
        prev.map((b) => (b.id === editingBounty.id ? editingBounty : b))
      )

      // Attempt to detect whether the failure was due to a pending application
      // (server-side 409). If so, surface a clear message to the poster.
      try {
        const pendingAfter = await bountyRequestService.getAll({ bountyId: editingBounty.id, status: 'pending' })
        if (pendingAfter && pendingAfter.length > 0) {
          Alert.alert(
            'Cannot Edit Posting',
            'A hunter applied while you were saving. Your changes were not saved. You cannot change terms after an application has been submitted.',
            [{ text: 'OK' }]
          )
          return
        }
      } catch (checkErr) {
        console.error('Failed to re-check pending requests after save failure:', checkErr)
      }

      // Hand the server's reason, in plain words, back to the edit modal so
      // it shows inline with the poster's edits intact (SBA-10).
      console.error('Error saving bounty edit:', err)
      throw toBountyUpdateError(err)
    }
  }

  const handleDeleteBounty = React.useCallback((bounty: Bounty) => {
    Alert.alert(
      "Delete Posting",
      "Delete this posting? This can't be undone.",
      [
        {
          text: "Cancel",
          style: "cancel",
        },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            const deleteKey = String(bounty.id)
            if (deletingBountyIdsRef.current.has(deleteKey)) return
            deletingBountyIdsRef.current.add(deleteKey)
            try {
              // Refund FIRST (when anything is held), then delete — the one
              // path shared with the bounty screen's "Cancel and refund".
              try {
                await cancelAndRefundBounty(bounty, { refundEscrow })
              } catch (cancelError) {
                if (cancelError instanceof BountyRefundFailedError) {
                  Alert.alert(
                    'Refund Failed',
                    'Could not refund escrowed funds. Please contact support before deleting.',
                    [{ text: 'OK' }]
                  );
                  return; // Don't proceed with deletion if refund fails
                }
                throw cancelError
              }

              // Update UI only after successful deletion. The registry mark
              // makes the removal survive the reload below (and any query that
              // was already in flight against the pre-delete row).
              markBountyRemovedLocally(bounty.id)
              setMyBounties((prev) => prev.filter((b) => b.id !== bounty.id))

              // Refresh to ensure consistency
              await loadMyBounties()
            } catch (err: any) {
              // Error handling - no rollback needed since we didn't optimistically update.
              // The raw service message can be a PostgREST/Supabase string, so
              // it is classified before it reaches the user.
              const friendly = getUserFriendlyError(err)
              setError(friendly.message)
              Alert.alert(friendly.title, friendly.message)
            } finally {
              deletingBountyIdsRef.current.delete(deleteKey)
            }
          },
        },
      ],
      { cancelable: true }
    )
  }, [refundEscrow, loadMyBounties])

  // Discard a cancelled bounty: soft-removes it from the active My Postings list
  // by transitioning its status to "deleted". The bounty remains visible in History.
  const handleDiscardCancelledBounty = React.useCallback((bounty: Bounty) => {
    Alert.alert(
      'Discard Cancelled Bounty',
      'Remove this cancelled bounty from your postings? It will still be visible in your history.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: async () => {
            try {
              const updated = await bountyService.update(bounty.id, { status: 'deleted' })
              if (!updated) throw new Error('Failed to discard bounty')
              markBountyRemovedLocally(bounty.id)
              setMyBounties((prev) => prev.filter((b) => b.id !== bounty.id))
              await loadMyBounties()
            } catch (err: any) {
              setError(err?.message || 'Failed to discard bounty')
              Alert.alert('Error', err?.message || 'Failed to discard bounty. Please try again.')
            }
          },
        },
      ],
      { cancelable: true },
    )
  }, [loadMyBounties])

  // Hunter-only "Hide"/"Remove from List" on a completed bounty card (see
  // MyPostingExpandable's variant="hunter" branch). Persists the hide (so it
  // survives remount/app-restart — issue #779) before removing the row from
  // local state; if the write throws, the card's own try/catch surfaces the
  // error and leaves the card in place instead of hiding something that was
  // never actually recorded.
  const handleHideInProgressBounty = React.useCallback(async (bounty: Bounty) => {
    await hideBountyForHunter(currentUserId, bounty.id)
    const key = String(bounty.id)
    setHunterHiddenBountyIds((prev) => {
      const next = new Set(prev)
      next.add(key)
      return next
    })
    setInProgressBounties((prev) => prev.filter((b) => String(b.id) !== key))
  }, [currentUserId])

  const handleWithdrawApplication = async (bountyId: number | string, requestStatus?: string | null) => {
    if (requestStatus === 'rejected') {
      Alert.alert(
        "Discard Application",
        "Remove this rejected application from your list? This can't be undone.",
        [
          {
            text: "Cancel",
            style: "cancel",
          },
          {
            text: "Discard",
            style: "destructive",
            onPress: async () => {
              try {
                await discardApplication({
                  bountyId,
                  currentUserId,
                  surface: 'inbox',
                })
                // Discard records a per-hunter hide (the row itself is kept for
                // request-outcome metrics), so drop it from the list here.
                const key = String(bountyId)
                setHunterHiddenBountyIds((prev) => new Set(prev).add(key))
              } catch (err: any) {
                console.error("Error discarding application:", err)
                const friendly = getUserFriendlyError(err)
                Alert.alert(friendly.title, friendly.message)
              }
            },
          },
        ],
        { cancelable: true }
      )
      return
    }

    Alert.alert(
      "Withdraw Application",
      "Are you sure you want to withdraw your application for this bounty?",
      [
        {
          text: "Cancel",
          style: "cancel",
        },
        {
          text: "Withdraw",
          style: "destructive",
          onPress: async () => {
            try {
              // Deletes the pending request and emits `application_withdrawn`
              // only on a confirmed success — see lib/services/application-withdrawal.ts.
              await withdrawApplication({
                bountyId,
                currentUserId,
                surface: 'inbox',
              })

              try {
                // Reload from the source so the card only disappears when the
                // row is really gone, never on an optimistic local filter.
                await loadInProgress()
              } catch (refreshError) {
                console.warn('Failed to refresh in-progress bounties after withdrawal:', refreshError)
              }

              Alert.alert("Success", "Your application has been withdrawn.")
            } catch (err: any) {
              console.error("Error withdrawing application:", err)
              const friendly = getUserFriendlyError(err)
              Alert.alert(friendly.title, friendly.message)
            }
          },
        },
      ],
      { cancelable: true }
    )
  }

  // ---- Thread rows ----
  // Returning from a thread (where the user may have hired, submitted, paid…)
  // must not leave the inbox showing the old state.
  const firstFocusRef = useRef(true)
  useFocusEffect(
    React.useCallback(() => {
      if (firstFocusRef.current) {
        firstFocusRef.current = false
        return
      }
      refreshAll()
      refreshConversations().catch(() => {})
    }, [refreshAll, refreshConversations])
  )

  const handleRefresh = React.useCallback(async () => {
    await Promise.all([refreshAll(), refreshConversations().catch(() => null)])
  }, [refreshAll, refreshConversations])

  const openThread = React.useCallback(
    (bountyId: string | number, role: 'hunter' | 'poster', withId?: string | null) => {
      router.push({
        pathname: '/tabs/bounty-thread/[bountyId]',
        params: withId ? { bountyId: String(bountyId), role, with: String(withId) } : { bountyId: String(bountyId), role },
      } as never)
    },
    [router]
  )

  const handleArchiveBounty = React.useCallback((bounty: Bounty) => {
    Alert.alert(
      'Archive Bounty',
      'Archive this bounty so it is hidden from active listings but retained in your history?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Archive',
          onPress: async () => {
            try {
              const updated = await bountyService.update(String(bounty.id), { status: 'archived' })
              if (!updated) throw new Error('Failed to archive bounty')
              await loadMyBounties()
            } catch (err) {
              console.error('Error archiving bounty:', err)
              Alert.alert('Error', describeBountyUpdateError(err))
            }
          },
        },
      ]
    )
  }, [loadMyBounties])

  // Bounties this hunter locally hid from In Progress (see
  // lib/utils/hunter-hidden-bounties.ts) — re-applied on every render so a
  // hide persisted before this mount (or before an app restart) still takes
  // effect, exactly like filterManagementBounties above for archived/deleted.
  const visibleInProgressBounties = React.useMemo(
    () => filterHunterHiddenBounties(inProgressBounties, hunterHiddenBountyIds),
    [inProgressBounties, hunterHiddenBountyIds]
  )

  // Filter chips select on the status a card *displays*, not on bounty.status —
  // see hooks/useBountyStatusFilters for why those differ.
  const {
    getLifecycle,
    displayedInProgress,
    displayedMyPostings,
    inProgressReviewCount,
    myPostingsReviewCount,
    inProgressAttentionCount,
    myPostingsAttentionCount,
  } = useBountyStatusFilters({
    currentUserId,
    myBounties,
    inProgressBounties: visibleInProgressBounties,
    hunterRequests,
    statusFilterInProgress,
    statusFilterMyPostings,
    applicationCounts,
  })

  const requestStatusByBounty = React.useMemo(() => {
    const m = new Map<string, string>()
    for (const r of hunterRequests) m.set(String(r?.bounty?.id ?? r?.bounty_id), r.status)
    return m
  }, [hunterRequests])

  const applicantsByBounty = React.useMemo(() => {
    const m = new Map<string, BountyRequestWithDetails[]>()
    for (const r of bountyRequests) {
      if (r.status !== 'pending') continue
      const key = String(r.bounty_id)
      const list = m.get(key)
      if (list) list.push(r)
      else m.set(key, [r])
    }
    return m
  }, [bountyRequests])

  const workRows: InboxRow[] = React.useMemo(() => {
    const rows = displayedInProgress.map((b): InboxRow => {
      const lifecycle = getLifecycle(b, 'hunter')
      const posterId = String(b.poster_id || b.user_id || '')
      const conv = findPairConversation(conversations, currentUserId, posterId, String(b.id))
      return {
        key: `work:${b.id}`,
        bounty: b,
        role: 'hunter',
        lifecycle,
        person: posterId ? { id: posterId, name: (b as any).username ?? null, avatar: (b as any).poster_avatar ?? null } : null,
        conversation: conv,
        application: null,
        activityAt: conv?.updatedAt ?? b.created_at,
      }
    })
    return sortInboxRows(rows)
  }, [displayedInProgress, getLifecycle, conversations, currentUserId])

  // One row per person, like a DM inbox: each pending applicant on an open
  // bounty is their own conversation; a hired bounty is the conversation with
  // its hunter; an open bounty nobody has applied to yet gets a single row.
  //
  // SBA-02: a bounty's applicants stay together, nearest first, placed by the
  // bounty's latest applicant activity. Applications flagged is_far (over 50
  // miles from an in-person job) go under "Not nearby (N)" at the bottom.
  const { bountyRows, notNearbyRows } = React.useMemo(() => {
    const rows: InboxRow[] = []
    const farRows: InboxRow[] = []
    for (const b of displayedMyPostings) {
      const lifecycle = getLifecycle(b, 'owner')
      const applicants = b.status === 'open' ? applicantsByBounty.get(String(b.id)) ?? [] : []
      if (applicants.length > 0) {
        const toRows = (list: BountyRequestWithDetails[]): InboxRow[] => {
          const built = list.map((a, i): InboxRow => {
            const hunterId = String(a.hunter_id)
            const conv = findPairConversation(conversations, currentUserId, hunterId, String(b.id))
            return {
              key: `bounty:${b.id}:${hunterId}`,
              bounty: b,
              role: 'poster',
              lifecycle,
              person: { id: hunterId, name: a.profile?.username ?? null, avatar: a.profile?.avatar ?? null },
              conversation: conv,
              application: a,
              activityAt: [conv?.updatedAt, a.created_at].filter(Boolean).sort().pop() ?? null,
              sortIndex: i,
            }
          })
          const latest = built.map(r => r.activityAt).filter(Boolean).sort().pop() ?? null
          return built.map(r => ({ ...r, sortAt: latest }))
        }
        const { nearby, notNearby } = partitionApplicantsByDistance(applicants)
        rows.push(...toRows(nearby))
        farRows.push(...toRows(notNearby))
        continue
      }
      const hunterId = b.accepted_by ? String(b.accepted_by) : null
      const conv = hunterId ? findPairConversation(conversations, currentUserId, hunterId, String(b.id)) : null
      rows.push({
        key: `bounty:${b.id}`,
        bounty: b,
        role: 'poster',
        lifecycle,
        person: hunterId ? { id: hunterId } : null,
        conversation: conv,
        application: null,
        activityAt: conv?.updatedAt ?? b.created_at,
      })
    }
    return { bountyRows: sortInboxRows(rows), notNearbyRows: sortInboxRows(farRows) }
  }, [displayedMyPostings, getLifecycle, applicantsByBounty, conversations, currentUserId])

  const [showNotNearby, setShowNotNearby] = useState(false)
  const toggleNotNearby = React.useCallback(() => setShowNotNearby(v => !v), [])
  const myBountiesListData: InboxListItem[] = React.useMemo(() => {
    if (notNearbyRows.length === 0) return bountyRows
    const toggle: NotNearbyListItem = {
      kind: 'notNearby',
      key: '__not-nearby__',
      count: notNearbyRows.length,
      expanded: showNotNearby,
    }
    return [...bountyRows, toggle, ...(showNotNearby ? notNearbyRows : [])]
  }, [bountyRows, notNearbyRows, showNotNearby])

  // Badges count everything actually blocked on this user — for a poster that
  // includes applications waiting on a decision.
  const tabBadge = (tabId: InboxTab) =>
    tabId === 'inProgress' ? inProgressAttentionCount : myPostingsAttentionCount

  const handleRowLongPress = React.useCallback((row: InboxRow) => {
    const b = row.bounty
    const buttons: { text: string; style?: 'cancel' | 'destructive'; onPress?: () => void }[] = []
    if (row.role === 'hunter') {
      const reqStatus = requestStatusByBounty.get(String(b.id))
      if (b.status === 'open' && reqStatus === 'pending') {
        buttons.push({ text: 'Withdraw application', style: 'destructive', onPress: () => handleWithdrawApplication(b.id, reqStatus) })
      } else if (row.lifecycle.status === 'rejected') {
        buttons.push({ text: 'Discard', style: 'destructive', onPress: () => handleWithdrawApplication(b.id, 'rejected') })
      } else if (row.lifecycle.group === 'past') {
        buttons.push({
          text: 'Hide from list',
          style: 'destructive',
          onPress: () => {
            handleHideInProgressBounty(b).catch(() => Alert.alert('Error', 'Failed to hide bounty. Please try again.'))
          },
        })
      }
    } else {
      const canEdit =
        b.status === 'open' && !b.accepted_by && !isBountyDeadlinePassed(b) && !bountiesWithPendingRequestsSet.has(String(b.id))
      if (canEdit) buttons.push({ text: 'Edit posting', onPress: () => handleEditBounty(b) })
      if (b.status === 'open' && !b.accepted_by) buttons.push({ text: 'Delete posting', style: 'destructive', onPress: () => handleDeleteBounty(b) })
      if (b.status === 'cancelled') buttons.push({ text: 'Discard', style: 'destructive', onPress: () => handleDiscardCancelledBounty(b) })
      if (b.status === 'completed') buttons.push({ text: 'Archive', onPress: () => handleArchiveBounty(b) })
    }
    if (buttons.length === 0) return
    Alert.alert(b.title, undefined, [...buttons, { text: 'Cancel', style: 'cancel' }])
  }, [requestStatusByBounty, bountiesWithPendingRequestsSet, handleEditBounty, handleDeleteBounty, handleDiscardCancelledBounty, handleArchiveBounty, handleHideInProgressBounty, handleWithdrawApplication])

  // Full-width line between conversations.
  const RowSeparator = React.useCallback(() => <View style={styles.rowSeparator} />, [styles])

  const renderRow = React.useCallback(({ item }: { item: InboxListItem }) => {
    if (isNotNearbyItem(item)) {
      return <NotNearbyToggle count={item.count} expanded={item.expanded} onToggle={toggleNotNearby} />
    }
    const row = item
    const b = row.bounty
    const conv = row.conversation
    const app = row.application
    const preview = conv?.lastMessage
      ? conv.lastMessage
      : app
        ? app.message?.trim() || 'Applied to your bounty'
        : row.lifecycle.explanation || row.lifecycle.headline
    return (
      <BountyConversationRow
        person={row.person}
        bountyTitle={b.title}
        status={row.lifecycle.status}
        preview={preview}
        timeIso={row.activityAt}
        unread={conv?.unread ?? 0}
        // An application waiting on the poster is their move even though the
        // bounty-level lifecycle is shared by every applicant row.
        yourTurn={app ? true : row.lifecycle.needsAttention}
        distanceLabel={app ? formatApplicantDistance(app.distance_mi) : null}
        onPress={() => openThread(b.id, row.role, row.role === 'poster' ? row.person?.id ?? null : null)}
        onLongPress={() => handleRowLongPress(row)}
        // Same rule as the long-press "Delete posting" option.
        onDelete={
          row.role === 'poster' && b.status === 'open' && !b.accepted_by
            ? () => handleDeleteBounty(b)
            : undefined
        }
      />
    )
  }, [openThread, handleRowLongPress, handleDeleteBounty, toggleNotNearby])

  const listContentPadding = useMemo(
    () => ({ paddingBottom: getBottomNavContentPadding(insets.bottom, 16) }),
    [insets.bottom]
  )

  // ── Swipe between My Work and My Bounties ────────────────────────────
  // Both lists stay mounted side by side and slide on the UI thread, driven
  // by `segmentProgress` (0 = My Work, 1 = My Bounties, fractional
  // mid-swipe). The segment pill tracks the same value, so it follows the
  // finger. activeTab — the filter chips, the applicants-viewed analytics —
  // only commits once a swipe settles, so no React work runs mid-slide.
  const segmentProgress = useSharedValue(activeTab === 'inProgress' ? 0 : 1)
  const segmentBase = useSharedValue(activeTab === 'inProgress' ? 0 : 1)
  const segmentSettling = useSharedValue(false)
  const segmentIgnoreDrag = useSharedValue(false)
  const [pagerWidth, setPagerWidth] = useState(0)
  const pagerWidthSV = useSharedValue(0)
  const [segmentWidth, setSegmentWidth] = useState(0)

  const selectSegment = React.useCallback((tab: InboxTab) => {
    segmentDecidedRef.current = true
    setActiveTab(tab)
    segmentBase.value = tab === 'inProgress' ? 0 : 1
    segmentSettling.value = true
    segmentProgress.value = withTiming(
      tab === 'inProgress' ? 0 : 1,
      { duration: 240, easing: Easing.out(Easing.cubic) },
      finished => {
        'worklet'
        if (finished) segmentSettling.value = false
      }
    )
  }, [segmentBase, segmentSettling, segmentProgress])

  // A link that asks for a segment while the Inbox is already mounted (the
  // tab shell keeps it mounted once visited, and preloads it beside Wallet)
  // arrives as a new initialTab: slide to that segment.
  const appliedInitialTabRef = useRef(initialTab)
  useEffect(() => {
    if (appliedInitialTabRef.current === initialTab) return
    appliedInitialTabRef.current = initialTab
    if (initialTab !== undefined) selectSegment(segmentForInitialTab(initialTab))
  }, [initialTab, selectSegment])

  // No link chose a segment: open on My Bounties for a poster with an open
  // bounty, where its applications are (SBA-10). Decided once, as soon as
  // this user's own bounties have loaded, and without a slide — it is where
  // the Inbox starts, not a move the user made.
  useEffect(() => {
    if (segmentDecidedRef.current || !currentUserId || myBountiesLoadedFor !== currentUserId) return
    segmentDecidedRef.current = true
    if (defaultInboxSegment(myBounties) !== 'myPostings') return
    setActiveTab('myPostings')
    segmentBase.value = 1
    segmentProgress.value = 1
  }, [currentUserId, myBountiesLoadedFor, myBounties, segmentBase, segmentProgress])

  const commitSegment = React.useCallback((index: number) => {
    segmentDecidedRef.current = true
    setActiveTab(index === 0 ? 'inProgress' : 'myPostings')
  }, [])

  const segmentHaptic = React.useCallback(() => hapticFeedback.selection(), [])

  // Only claims a drag towards the other segment. The tab shell's native
  // pager (app/tabs/bounty-app.tsx) is made to wait for this pan to fail
  // before it scrolls, so this wins that direction; the other direction
  // fails within 10pt and the pager takes the swipe — left off My Bounties
  // goes on to the Wallet tab. Rebuilt only when activeTab commits, never
  // mid-drag.
  const tabPagerGesture = useTabPager()?.gesture ?? null
  const onWork = activeTab === 'inProgress'
  const segmentGesture = useMemo(() => {
    const pan = Gesture.Pan()
      .activeOffsetX(onWork ? [-15, 100000] : [-100000, 15])
      .failOffsetX(onWork ? [-100000, 10] : [-10, 100000])
      .failOffsetY([-15, 15])
      .onStart(() => {
        'worklet'
        segmentIgnoreDrag.value = segmentSettling.value || pagerWidthSV.value === 0
      })
      .onUpdate(e => {
        'worklet'
        if (segmentIgnoreDrag.value) return
        const next = segmentBase.value - e.translationX / pagerWidthSV.value
        segmentProgress.value = Math.min(1, Math.max(0, next))
      })
      .onEnd(e => {
        'worklet'
        if (segmentIgnoreDrag.value) return
        const width = pagerWidthSV.value
        const base = segmentBase.value
        const target = base === 0 ? 1 : 0
        // Towards the other segment = left from My Work, right from My Bounties.
        const towards = base === 0 ? -1 : 1
        const fast = Math.abs(e.velocityX) > 500
        const commit = fast
          ? Math.sign(e.velocityX) === towards
          : Math.abs(e.translationX) > width * 0.3
        if (commit) {
          segmentBase.value = target
          runOnJS(segmentHaptic)()
        }
        segmentSettling.value = true
        segmentProgress.value = withSpring(
          segmentBase.value,
          { velocity: -e.velocityX / width, damping: 30, stiffness: 300, overshootClamping: true },
          finished => {
            'worklet'
            if (!finished) return
            segmentSettling.value = false
            if (commit) runOnJS(commitSegment)(target)
          }
        )
      })
    return tabPagerGesture ? pan.blocksExternalGesture(tabPagerGesture) : pan
  }, [onWork, tabPagerGesture, segmentIgnoreDrag, segmentSettling, pagerWidthSV, segmentBase, segmentProgress, segmentHaptic, commitSegment])

  const segmentPillStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: segmentProgress.value * ((segmentWidth - 8) / 2) }],
  }))

  const isWork = activeTab === 'inProgress'
  const filters = isWork ? IN_PROGRESS_FILTERS : MY_POSTINGS_FILTERS
  const selectedFilter = isWork ? statusFilterInProgress : statusFilterMyPostings
  const reviewCount = isWork ? inProgressReviewCount : myPostingsReviewCount

  const renderList = (tab: InboxTab) => (
        <FlatList
          data={tab === 'inProgress' ? workRows : myBountiesListData}
          keyExtractor={keyExtractorRow}
          renderItem={renderRow}
          ItemSeparatorComponent={RowSeparator}
          style={{ flex: 1 }}
          contentContainerStyle={[styles.listContent, listContentPadding]}
          ListEmptyComponent={
            (tab === 'inProgress' ? isLoading.inProgress : isLoading.myBounties) ? (
              <PostingsListSkeleton count={3} />
            ) : error ? (
              <EmptyState
                icon="cloud-off"
                title="Unable to Load"
                description="Check your internet connection and try again"
                actionLabel="Try Again"
                onAction={handleRefresh}
              />
            ) : tab === 'inProgress' ? (
              <EmptyState
                icon="work-outline"
                title={statusFilterInProgress === 'all' ? 'No work yet' : 'Nothing here'}
                description={
                  statusFilterInProgress === 'all'
                    ? 'Apply to a bounty and your conversation with the poster lands here — from application to payout.'
                    : 'No bounties match this filter right now.'
                }
                size="lg"
                actionLabel={statusFilterInProgress === 'all' ? 'Find Bounties' : undefined}
                onAction={statusFilterInProgress === 'all' ? () => setActiveScreen('bounty') : undefined}
              />
            ) : (
              <EmptyState
                icon="post-add"
                title={statusFilterMyPostings === 'all' ? 'No bounties posted yet' : 'Nothing here'}
                description={
                  statusFilterMyPostings === 'all'
                    ? 'Post a bounty and every applicant shows up here as a conversation you can hire from.'
                    : 'No bounties match this filter right now.'
                }
                size="lg"
                actionLabel={statusFilterMyPostings === 'all' ? 'Post a Bounty' : undefined}
                onAction={statusFilterMyPostings === 'all' ? () => setActiveScreen('postings') : undefined}
              />
            )
          }
          refreshControl={
            <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={theme.text} colors={['#008E2A']} />
          }
          showsVerticalScrollIndicator={false}
          onScroll={(e) => {
            // Only the list on screen drives the header shadow.
            if (tab !== activeTab) return
            const y = e.nativeEvent.contentOffset.y || 0
            if (y > 2 && !showShadow) setShowShadow(true)
            else if (y <= 2 && showShadow) setShowShadow(false)
          }}
          scrollEventThrottle={16}
          removeClippedSubviews={false}
          initialNumToRender={6}
          windowSize={7}
        />
  )

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      {/* Header */}
      {/* Fixed header overlay, pulled up like the other tabs; its measured
          height pads the list below. */}
      <View
        onLayout={(e) => setHeaderHeight(e.nativeEvent.layout.height)}
        style={[styles.header, { top: -HEADER_TOP_OFFSET, paddingTop: insets.top }, showShadow && styles.headerShadow]}
      >
        <View style={styles.headerRow}>
          <BrandingLogo size="medium" />
        </View>

        <View style={{ paddingHorizontal: 16 }}>
          <OfflineStatusBadge />
        </View>

        {/* One fixed title; the segment below says which list is showing. */}
        <Text style={styles.bigTitle} accessibilityRole="header">
          Inbox
        </Text>

        {/* My Work / My Bounties. The green pill is one view sliding under
            both buttons with segmentProgress, so it follows a swipe. */}
        <View
          style={styles.segment}
          accessibilityRole="tablist"
          onLayout={(e) => setSegmentWidth(e.nativeEvent.layout.width)}
        >
          {segmentWidth > 0 && (
            <Reanimated.View
              pointerEvents="none"
              style={[styles.segmentPill, { width: (segmentWidth - 8) / 2 }, segmentPillStyle]}
            />
          )}
          {INBOX_TABS.map((tab, index) => {
            const active = activeTab === tab.id
            const badge = tabBadge(tab.id)
            return (
              <TouchableOpacity
                key={tab.id}
                onPress={() => {
                  if (active) return
                  hapticFeedback.selection()
                  selectSegment(tab.id)
                }}
                activeOpacity={0.85}
                style={styles.segmentBtn}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                accessibilityLabel={badge > 0 ? `${tab.label}, ${badge} need your attention` : tab.label}
              >
                <SegmentLabel
                  label={tab.label}
                  index={index}
                  progress={segmentProgress}
                  activeColor="#fff"
                  inactiveColor={theme.textSecondary}
                  style={styles.segmentText}
                />
                {badge > 0 && (
                  <View style={[styles.segmentBadge, active && styles.segmentBadgeActive]}>
                    <Text style={styles.segmentBadgeText}>{badge > 99 ? '99+' : badge}</Text>
                  </View>
                )}
              </TouchableOpacity>
            )
          })}
        </View>

        {/* Filter chips */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {filters.map(f => {
            const label = isWork
              ? IN_PROGRESS_FILTER_LABELS[f as InProgressStatusFilter]
              : MY_POSTINGS_FILTER_LABELS[f as MyPostingsStatusFilter]
            const selected = selectedFilter === f
            const count = f === 'review' ? reviewCount : 0
            return (
              <TouchableOpacity
                key={f}
                onPress={() => {
                  hapticFeedback.selection()
                  if (isWork) setStatusFilterInProgress(f as InProgressStatusFilter)
                  else setStatusFilterMyPostings(f as MyPostingsStatusFilter)
                }}
                style={[styles.chip, selected && styles.chipSelected]}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={`Filter: ${label}${count > 0 ? `, ${count} waiting` : ''}`}
              >
                <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
                {count > 0 && (
                  <View style={styles.chipCount}>
                    <Text style={styles.chipCountText}>{count > 99 ? '99+' : count}</Text>
                  </View>
                )}
              </TouchableOpacity>
            )
          })}
        </ScrollView>
      </View>

      <View style={{ flex: 1, paddingTop: Math.max(0, headerHeight - (HEADER_TOP_OFFSET - 12)) }}>
      {error && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.errorCloseButton} onPress={() => setError(null)} accessibilityLabel="Dismiss error">
            <Text style={styles.errorCloseText}>✕</Text>
          </TouchableOpacity>
        </View>
      )}

      <GestureDetector gesture={segmentGesture}>
        <View
          style={{ flex: 1, overflow: 'hidden' }}
          onLayout={(e) => {
            const w = e.nativeEvent.layout.width
            setPagerWidth(w)
            pagerWidthSV.value = w
          }}
        >
          {pagerWidth > 0 &&
            INBOX_TABS.map((tab, index) => (
              <SegmentPage key={tab.id} index={index} progress={segmentProgress} width={pagerWidth}>
                {renderList(tab.id)}
              </SegmentPage>
            ))}
        </View>
      </GestureDetector>
      </View>

      {/* Edit Posting Modal */}
      {editingBounty && (
        <EditPostingModal
          key={editingBounty.id}
          visible={showEditModal}
          bounty={editingBounty}
          onClose={() => {
            setShowEditModal(false)
            setEditingBounty(null)
          }}
          onSave={handleSaveEdit}
        />
      )}
    </View>
  )
}

export default InboxScreen;

// One segment's list, slid by segmentProgress: at (index - progress) pager
// widths, so the active list sits at 0 and the other parks beside it.
function SegmentPage({
  index,
  progress,
  width,
  children,
}: {
  index: number
  progress: SharedValue<number>
  width: number
  children: React.ReactNode
}) {
  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: (index - progress.value) * width }],
  }))
  return <Reanimated.View style={[StyleSheet.absoluteFill, style]}>{children}</Reanimated.View>
}

// Segment label whose colour blends with segmentProgress, so it brightens
// as the pill slides under it rather than flipping at the end.
function SegmentLabel({
  label,
  index,
  progress,
  activeColor,
  inactiveColor,
  style,
}: {
  label: string
  index: number
  progress: SharedValue<number>
  activeColor: string
  inactiveColor: string
  style: object
}) {
  const colorStyle = useAnimatedStyle(() => ({
    color: interpolateColor(Math.abs(index - progress.value), [0, 1], [activeColor, inactiveColor]),
  }))
  return (
    <Reanimated.Text style={[style, colorStyle]} numberOfLines={1}>
      {label}
    </Reanimated.Text>
  )
}

type InboxTab = 'inProgress' | 'myPostings'

const INBOX_TABS: { id: InboxTab; label: string }[] = [
  { id: 'inProgress', label: 'My Work' },
  { id: 'myPostings', label: 'My Bounties' },
]

interface InboxRow {
  key: string
  bounty: Bounty
  role: 'hunter' | 'poster'
  lifecycle: BountyLifecycleState
  /** The person on the other side; null for an open bounty with no applicants. */
  person: InboxPerson | null
  conversation: Conversation | null
  /** Poster side: the pending application this row is about. */
  application: BountyRequestWithDetails | null
  activityAt: string | null
  /** Overrides activityAt for ordering: a bounty's applicants share their latest activity. */
  sortAt?: string | null
  /** Order within rows sharing sortAt (applicants: nearest first). */
  sortIndex?: number
}

/** The "Not nearby (N)" divider at the bottom of My Bounties (SBA-02). */
interface NotNearbyListItem {
  kind: 'notNearby'
  key: string
  count: number
  expanded: boolean
}

type InboxListItem = InboxRow | NotNearbyListItem

function isNotNearbyItem(item: InboxListItem): item is NotNearbyListItem {
  return (item as NotNearbyListItem).kind === 'notNearby'
}

const GROUP_RANK: Record<string, number> = { attention: 0, active: 1, waiting: 2, past: 3 }

/** Whose-move first, then most recent activity — the way a DM inbox reads. */
function sortInboxRows(rows: InboxRow[]): InboxRow[] {
  return [...rows].sort((a, b) => {
    const g = (GROUP_RANK[a.lifecycle.group] ?? 9) - (GROUP_RANK[b.lifecycle.group] ?? 9)
    if (g !== 0) return g
    const t =
      new Date(b.sortAt ?? b.activityAt ?? 0).getTime() - new Date(a.sortAt ?? a.activityAt ?? 0).getTime()
    if (t !== 0) return t
    return (a.sortIndex ?? 0) - (b.sortIndex ?? 0)
  })
}

const keyExtractorRow = (row: InboxListItem) => row.key

function makeStyles(theme: AppTheme) {
  return StyleSheet.create({
    header: {
      position: 'absolute',
      left: 0,
      right: 0,
      backgroundColor: theme.background,
      zIndex: 20,
      paddingBottom: 10,
    },
    headerShadow: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: theme.isDark ? 0.35 : 0.08,
      shadowRadius: 6,
      elevation: 6,
    },
    headerRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 16,
    },
    // The centred, letter-spaced uppercase title every Bounty tab uses.
    bigTitle: {
      color: theme.text,
      fontSize: 20,
      fontWeight: '700',
      letterSpacing: 1.5,
      textTransform: 'uppercase',
      textAlign: 'center',
      paddingHorizontal: 16,
      marginTop: 2,
      marginBottom: 12,
    },
    segment: {
      flexDirection: 'row',
      marginHorizontal: 16,
      padding: 4,
      borderRadius: 999,
      backgroundColor: theme.surfaceSecondary,
      borderWidth: 1,
      borderColor: theme.border,
    },
    segmentBtn: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      minHeight: 44,
      borderRadius: 999,
    },
    // The active tab's fill — the brand action green with its glow, the same
    // treatment as Bounty's primary Button — as one pill that slides between
    // the two buttons.
    segmentPill: {
      position: 'absolute',
      top: 4,
      bottom: 4,
      left: 4,
      borderRadius: 999,
      backgroundColor: theme.primary,
      ...theme.shadows.brand,
      shadowOpacity: 0.35,
      shadowRadius: 8,
    },
    segmentText: {
      color: theme.textSecondary,
      fontSize: 13,
      fontWeight: '700',
      letterSpacing: 0.6,
      textTransform: 'uppercase',
    },
    segmentBadge: {
      minWidth: 18,
      height: 18,
      paddingHorizontal: 4,
      borderRadius: 9,
      backgroundColor: theme.error,
      alignItems: 'center',
      justifyContent: 'center',
    },
    segmentBadgeActive: {
      borderWidth: 1.5,
      borderColor: '#fff',
    },
    segmentBadgeText: {
      color: '#fff',
      fontSize: 10,
      fontWeight: '800',
    },
    chips: {
      gap: 8,
      paddingHorizontal: 16,
      paddingTop: 14,
    },
    // Metrics from the shared FilterChip (44pt target, bordered pill); the
    // selected chip is filled in the action green instead of black.
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 14,
      minHeight: 40,
      borderRadius: 999,
      backgroundColor: theme.surfaceSecondary,
      borderWidth: 1,
      borderColor: theme.border,
    },
    chipSelected: {
      backgroundColor: theme.primary,
      borderColor: theme.primary,
    },
    chipText: {
      color: theme.text,
      fontSize: 14,
      fontWeight: '600',
    },
    chipTextSelected: {
      color: '#fff',
      fontWeight: '700',
    },
    chipCount: {
      minWidth: 18,
      height: 18,
      paddingHorizontal: 4,
      borderRadius: 9,
      backgroundColor: '#f59e0b',
      alignItems: 'center',
      justifyContent: 'center',
    },
    chipCountText: {
      color: '#22262C',
      fontSize: 10,
      fontWeight: '800',
    },
    // Rows carry their own horizontal padding, as in Messages.
    listContent: {
      paddingTop: 4,
    },
    rowSeparator: {
      height: 1,
      backgroundColor: theme.textDisabled,
      opacity: 0.6,
    },
    errorBox: { marginHorizontal: 16, marginBottom: 8, padding: 12, backgroundColor: 'rgba(239,68,68,0.45)', borderRadius: 8 },
    errorText: { color: theme.text, fontSize: 14 },
    errorCloseButton: { position: 'absolute', right: 8, top: 8, padding: 8 },
    errorCloseText: { color: theme.text, fontSize: 16 },
  });
}
