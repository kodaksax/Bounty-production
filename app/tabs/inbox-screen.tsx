"use client"

import { MaterialIcons } from "@expo/vector-icons"
import { BrandingLogo } from "components/ui/branding-logo"
import { useRouter } from "expo-router"
import { analyticsService } from "lib/services/analytics-service"
import { withdrawApplication } from "lib/services/application-withdrawal"
import type { BountyRequestWithDetails } from "lib/services/bounty-request-service"
import { bountyRequestService } from "lib/services/bounty-request-service"
import { bountyService } from "lib/services/bounty-service"
import { bountyPaymentsService } from "lib/services/bounty-payments-service"
import type { Bounty } from "lib/services/database.types"
import { isPhase2Bounty, isV3Bounty } from "lib/utils/payment-architecture"
import { isBountyDeadlinePassed } from "lib/utils/schedule-utils"
import * as React from "react"
import { useEffect, useMemo, useRef, useState } from "react"
import { Alert, FlatList, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { ApplicantCard } from "../../components/applicant-card"
import { ArchivedBountiesScreen } from "../../components/archived-bounties-screen"
import { EditPostingModal } from "../../components/edit-posting-modal"
import { getBottomNavContentPadding } from "../../lib/constants/navigation"
import { useValidUserId } from '../../hooks/useValidUserId'
import { ROUTES } from '../../lib/routes'
import { supabase } from '../../lib/supabase'
import { OfflineStatusBadge } from '../../components/offline-status-badge'
import { BountyWorkflowGuide } from '../../components/ui/bounty-workflow-guide'
import { EmptyState } from '../../components/ui/empty-state'
import { ApplicantCardSkeleton, PostingsListSkeleton } from '../../components/ui/skeleton-loaders'
import { WalletBalanceButton } from '../../components/ui/wallet-balance-button'
import { useAcceptFunding } from '../../hooks/useAcceptFunding'
import { useAcceptRequest } from '../../hooks/useAcceptRequest'
import { AcceptFundingGate } from '../../components/accept-funding-gate'
import type { BountyListRow, InProgressStatusFilter, MyPostingsStatusFilter } from '../../hooks/useBountyStatusFilters'
import {
  IN_PROGRESS_FILTERS,
  IN_PROGRESS_FILTER_LABELS,
  MY_POSTINGS_FILTERS,
  MY_POSTINGS_FILTER_LABELS,
  toBountyListRows,
  useBountyStatusFilters,
} from '../../hooks/useBountyStatusFilters'
import { BountySectionHeader } from '../../components/ui/bounty-section-header'
import { useRejectRequest } from '../../hooks/useRejectRequest'
import { getBountyFundingRequirement } from '../../lib/services/bounty-funding-service'
import { useAuthContext } from '../../hooks/use-auth-context'
import { useWallet } from '../../lib/wallet-context'
import { useAppThemeContext } from '../../lib/themes/AppThemeContext'
import type { AppTheme } from '../../lib/themes/types'
// Reuse the exact same expandable row used by the Activity (Postings) screen so
// the Inbox renders Work / Posts / Requests with identical look-and-feel.
import { MyPostingRow } from './postings-screen'

interface InboxScreenProps {
  onBack?: () => void
  initialTab?: string
  activeScreen: string
  setActiveScreen: (screen: string) => void
  onBountyAccepted?: (bountyId?: string | number) => void // Callback when a bounty is accepted
}

/**
 * InboxScreen — the "Inbox" bottom-nav tab.
 *
 * Renders the Work (In Progress), Posts (My Postings) and Requests content that
 * previously lived only on the Activity tab. The messaging inbox implementation
 * still lives in `messenger-screen.tsx` and is intentionally left untouched.
 */
export function InboxScreen({ onBack, initialTab, activeScreen, setActiveScreen, onBountyAccepted }: InboxScreenProps) {
  const rawUserId = useValidUserId()
  const currentUserId = rawUserId ?? undefined
  const router = useRouter()

  // Only Work / Posts / Requests exist here — anything else (e.g. the Activity
  // tab's "new" flow) falls back to Work.
  const [activeTab, setActiveTab] = useState(
    initialTab && ["inProgress", "myPostings", "requests"].includes(initialTab) ? initialTab : "inProgress"
  )
  const [showArchivedBounties, setShowArchivedBounties] = useState(false)
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

  const insets = useSafeAreaInsets()
  const HEADER_TOP_OFFSET = 55 // how far the header is visually pulled up
  const { refundEscrow, refreshFromApi } = useWallet()
  const { session: walletSession } = useAuthContext()
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
  // Expanded rows map for My Postings list
  const [expandedMap, setExpandedMap] = useState<Record<string, boolean>>({})
  // When true we should not toggle rows on press (prevents taps firing after a scroll/drag)
  const [isListScrolling, setIsListScrolling] = useState(false)
  // Refs for lists so we can scroll items into view when expanded
  const inProgressListRef = useRef<any>(null)
  const myPostingsListRef = useRef<any>(null)
  // Bounty ids with a delete/refund in flight — blocks repeat taps from
  // re-entering the refund and firing duplicate escrow events.
  const deletingBountyIdsRef = useRef<Set<string>>(new Set())

  // Per-item native refs so we can measure exact layout relative to the list
  const itemRefs = useRef<Record<string, any>>({})
  // Pending scroll request (set when expanding an item, cleared after measuring)
  const pendingScrollRef = useRef<{ list: 'inProgress' | 'myPostings'; key: string } | null>(null)

  // Scroll helper: toggle expanded state then measure the item's position and scroll to exact offset
  const handleToggleAndScroll = (list: 'inProgress' | 'myPostings', bountyId: string | number) => {
    const key = String(bountyId)
    // Toggle expansion first
    setExpandedMap((prev) => {
      const next = { ...prev, [key]: !prev[key] }
      return next
    })

    // If we're collapsing, no need to scroll
    const willExpand = !expandedMap[key]

    if (!willExpand) return
    // Mark pending scroll — we'll measure and scroll when the expanded content calls back
    pendingScrollRef.current = { list, key }
  }

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
      // Filter out archived and deleted bounties from My Postings view
      const activeBounties = mine.filter(b => b.status !== 'archived' && b.status !== 'deleted')
      setMyBounties(activeBounties)
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
        // Filter out archived and deleted bounties from in-progress view
        if (b && !map.has(String(b.id)) && b.status !== 'archived' && b.status !== 'deleted') {
          map.set(String(b.id), b)
        }
      }
      setInProgressBounties(Array.from(map.values()))
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

  const tabs = [
    { id: "inProgress", label: "In Progress", shortLabel: "Work", icon: "play-circle-outline" },
    { id: "myPostings", label: "My Postings", shortLabel: "Posts", icon: "assignment" },
    { id: "requests", label: "Requests", shortLabel: "Requests", icon: "people-outline" },
  ] as const

  // Count of unreviewed (pending) requests — drives the badge on the Requests tab
  const pendingRequestCount = React.useMemo(
    () => bountyRequests.filter((r) => r.status === 'pending').length,
    [bountyRequests]
  )

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
      .channel(`inbox-requests:${currentUserId}`)
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

  // ---- Accept/Reject request handlers (extracted to hooks) ----
  // Owns the pay-at-accept gate. Rendered as a full-screen early return below,
  // so the poster can never be looking at an "in progress" list while a
  // payment sheet is open.
  // Pull the authoritative balance the moment a pay-at-accept acceptance
  // charges the poster. `force` because the server just debited us: a recent
  // optimistic top-up (very likely here — the poster may have just topped up
  // inside the funding gate) would otherwise keep the pre-charge figure on
  // screen. `silent` so the wallet updates in place instead of blanking.
  const refreshWalletBalance = React.useCallback(async () => {
    const token = walletSession?.access_token
    if (!token) return
    await refreshFromApi(token, { silent: true, force: true })
  }, [walletSession?.access_token, refreshFromApi])

  const { gate: acceptFundingGate, ensureFunded, handleAcceptFailure } = useAcceptFunding()

  const { handleAcceptRequest } = useAcceptRequest({
    currentUserId,
    bountyRequests,
    myBounties,
    setBountyRequests,
    setMyBounties,
    setInProgressBounties,
    setIsLoading,
    setError,
    loadMyBounties,
    loadInProgress,
    loadRequestsForMyBounties,
    onBountyAccepted,
    setActiveScreen,
    ensureFunded,
    refreshWallet: refreshWalletBalance,
    handleAcceptFailure,
  })

  const { handleRejectRequest } = useRejectRequest({
    setBountyRequests,
    setIsLoading,
    setError,
  })

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

      // Fallback: show server-provided error message if available, else generic
      const msg = (err && (err.message || String(err))) || 'Failed to save changes'
      Alert.alert('Error', msg)
      console.error('Error saving bounty edit:', err)
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
              // Process refund FIRST for paid bounties before any other operations.
              //
              // ...but only when there is actually something to refund. Under
              // pay-at-accept an OPEN bounty has normally never been funded —
              // the poster is charged when they select a hunter, not at post —
              // so the old unconditional refund would fail on a bounty that was
              // never debited and then hit the `return` below, making the
              // posting undeletable. Before this flow existed, an open paid
              // bounty always had escrow, so the situation could not arise.
              //
              // Asked of the SERVER rather than inferred from funding_mode: an
              // escrow can exist on an open at_accept bounty (e.g. one created
              // by an older build), and refusing to refund that would strand
              // real money. getBountyFundingRequirement reports already_funded
              // from the canonical wallet_transactions row, and its documented
              // fallback when the RPC is unavailable is already_funded=true —
              // i.e. attempt the refund exactly as this code always has.
              const needsRefund =
                bounty && !bounty.is_for_honor && bounty.amount > 0 && bounty.status === 'open'
                  ? (await getBountyFundingRequirement(bounty.id)).alreadyFunded
                  : false

              if (needsRefund) {
                const useV2 = isPhase2Bounty(bounty)
                const useV3 = isV3Bounty(bounty)
                try {
                  await analyticsService.trackEvent('payment_architecture_routed', {
                    bountyId: String(bounty.id),
                    version: useV3 ? 3 : useV2 ? 2 : 1,
                    context: 'cancel',
                  })
                } catch {
                  /* analytics is best-effort */
                }
                try {
                  if (useV2 || useV3) {
                    // Stripe-native escrow: cancels the PaymentIntent or v3 auth.
                    // Only terminal states are safe to treat as a successful refund.
                    const cancelResult = await bountyPaymentsService.cancelBountyPayment(String(bounty.id))
                    if (cancelResult.status !== 'canceled' && cancelResult.status !== 'refunded') {
                      throw new Error(`Escrow cancellation is still pending (${cancelResult.status})`)
                    }
                  } else {
                    // refundEscrow signals failure by returning false, not by
                    // throwing — so the boolean must be checked or a failed
                    // refund would still delete the bounty and lose the money.
                    const refunded = await refundEscrow(bounty.id, bounty.title, 100) // 100% refund for unaccepted bounties
                    if (!refunded) {
                      throw new Error('Escrow refund did not complete')
                    }
                  }
                  try {
                    await analyticsService.trackEvent('escrow_refunded', {
                      bountyId: String(bounty.id),
                      architecture: useV3 ? 'v3' : useV2 ? 'v2' : 'v1',
                      amount: bounty.amount,
                    })
                  } catch {
                    /* analytics is best-effort */
                  }
                } catch (refundError) {
                  console.error('Error refunding escrow:', refundError);
                  try {
                    await analyticsService.trackEvent('payment_failed', {
                      bountyId: String(bounty.id),
                      architecture: useV3 ? 'v3' : useV2 ? 'v2' : 'v1',
                      stage: 'cancel',
                    })
                  } catch {
                    /* analytics is best-effort */
                  }
                  Alert.alert(
                    'Refund Failed',
                    'Could not refund escrowed funds. Please contact support before deleting.',
                    [{ text: 'OK' }]
                  );
                  return; // Don't proceed with deletion if refund fails
                }
              }

              // Delete from API first (no optimistic update before API call)
              const success = await bountyService.delete(bounty.id)

              if (!success) {
                throw new Error("Failed to delete bounty")
              }

              // Update UI only after successful deletion
              setMyBounties((prev) => prev.filter((b) => b.id !== bounty.id))

              // Refresh to ensure consistency
              await loadMyBounties()
            } catch (err: any) {
              // Error handling - no rollback needed since we didn't optimistically update
              setError(err.message || "Failed to delete posting")
              Alert.alert('Error', err.message || 'Failed to delete bounty. Please try again.')
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

  const handleWithdrawApplication = async (bountyId: number | string) => {
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
              Alert.alert("Error", err.message || "Failed to withdraw application")
            }
          },
        },
      ],
      { cancelable: true }
    )
  }

  // ---- Optimized FlatList callbacks ----
  // Memoized keyExtractor functions
  // Rows are either a section header or a bounty; ids are namespaced by
  // toBountyListRows so a header can never collide with a bounty id.
  const keyExtractorRow = React.useCallback((item: BountyListRow) => item.id, []);
  const keyExtractorRequest = React.useCallback((item: BountyRequestWithDetails) => item.id.toString(), []);

  // NOTE: Do NOT provide getItemLayout for expandable / variable-height rows.
  // MyPostingExpandable rows can change height when expanded/collapsed, so passing
  // a fixed getItemLayout would break virtualization and scroll offsets.
  // Only use getItemLayout for truly fixed-height items like ApplicantCard.

  const getItemLayoutRequest = React.useCallback((_data: any, index: number) => ({
    length: 120, // Approximate applicant card height
    offset: 120 * index,
    index,
  }), []);

  // Memoized render functions for better performance
  const renderMyPostingItem = React.useCallback(({ item: row }: { item: BountyListRow; index: number }) => {
    if (row.kind === 'section') {
      return <BountySectionHeader label={row.label} count={row.count} group={row.group} />
    }
    const bounty = row.bounty
    return (
    <View
      ref={(r) => { if (r) itemRefs.current[String(bounty.id)] = r }}
      collapsable={false}
    >
      <MyPostingRow
        bounty={bounty}
        currentUserId={currentUserId}
        expanded={!!expandedMap[String(bounty.id)]}
        onToggle={() => handleToggleAndScroll('myPostings', bounty.id)}
        onEdit={bounty.status === 'open' && !bounty.accepted_by && !isBountyDeadlinePassed(bounty) && !bountiesWithPendingRequestsSet.has(String(bounty.id)) ? () => handleEditBounty(bounty) : undefined}
        onDelete={bounty.status === 'open' && !bounty.accepted_by ? () => handleDeleteBounty(bounty) : undefined}
        onDiscard={bounty.status === 'cancelled' ? () => handleDiscardCancelledBounty(bounty) : undefined}
        onGoToReview={(id: string) => { /* legacy route removed - modal only */ }}
        onGoToPayout={(id: string) => router.push({ pathname: '/postings/[bountyId]/payout', params: { bountyId: id } })}
        variant={'owner'}
        isListScrolling={isListScrolling}
        onRefresh={refreshAll}
        applicationCount={applicationCounts.get(String(bounty.id)) ?? 0}
      />
    </View>
    )
  }, [currentUserId, expandedMap, isListScrolling, router, handleEditBounty, handleDeleteBounty, handleDiscardCancelledBounty, refreshAll, bountiesWithPendingRequestsSet, applicationCounts]);

  const renderInProgressItem = React.useCallback(({ item: row }: { item: BountyListRow; index: number }) => {
    if (row.kind === 'section') {
      return <BountySectionHeader label={row.label} count={row.count} group={row.group} />
    }
    const bounty = row.bounty
    return (
    <View
      ref={(r) => { if (r) itemRefs.current[String(bounty.id)] = r }}
      collapsable={false}
    >
      <MyPostingRow
        bounty={bounty}
        currentUserId={currentUserId}
        expanded={!!expandedMap[String(bounty.id)]}
        onToggle={() => handleToggleAndScroll('inProgress', bounty.id)}
        onWithdrawApplication={() => handleWithdrawApplication(bounty.id)}
        onGoToReview={(id: string) => { /* legacy route removed - modal only */ }}
        onGoToPayout={(id: string) => router.push({ pathname: '/in-progress/[bountyId]/hunter/payout', params: { bountyId: id } })}
        variant={'hunter'}
        isListScrolling={isListScrolling}
        onRefresh={refreshAll}
      />
    </View>
    )
  }, [currentUserId, expandedMap, isListScrolling, router, refreshAll]);

  // Memoized styles that must be called unconditionally (before any early returns)
  const containerPaddingTop = useMemo(() => ({ paddingTop: Math.max(0, headerHeight - (HEADER_TOP_OFFSET - 12)) }), [headerHeight])
  const listContentPadding = useMemo(
    () => ({ paddingBottom: getBottomNavContentPadding(insets.bottom, 16) }),
    [insets.bottom]
  )

  // Filter chips select on the status a card *displays*, not on bounty.status —
  // see hooks/useBountyStatusFilters for why those differ.
  const {
    displayedInProgress,
    displayedMyPostings,
    inProgressSections,
    myPostingsSections,
    inProgressReviewCount,
    myPostingsReviewCount,
    inProgressAttentionCount,
    myPostingsAttentionCount,
  } = useBountyStatusFilters({
    currentUserId,
    myBounties,
    inProgressBounties,
    hunterRequests,
    statusFilterInProgress,
    statusFilterMyPostings,
    applicationCounts,
  })

  // Section headers are interleaved into the same FlatList as the cards — see
  // toBountyListRows for why these lists aren't SectionLists.
  const inProgressRows = React.useMemo(
    () => toBountyListRows(inProgressSections, displayedInProgress),
    [inProgressSections, displayedInProgress]
  )
  const myPostingsRows = React.useMemo(
    () => toBountyListRows(myPostingsSections, displayedMyPostings),
    [myPostingsSections, displayedMyPostings]
  )

  // Badges count everything actually blocked on this user, not just submitted
  // work: a poster with applications waiting has something to do even though
  // nothing has been submitted for review yet.
  const getTabBadgeCount = React.useCallback((tabId: string) => {
    if (tabId === 'requests') return pendingRequestCount
    if (tabId === 'inProgress') return inProgressAttentionCount
    if (tabId === 'myPostings') return myPostingsAttentionCount
    return 0
  }, [inProgressAttentionCount, myPostingsAttentionCount, pendingRequestCount])

  const renderRequestItem = React.useCallback(({ item: request }: { item: BountyRequestWithDetails }) => (
    <ApplicantCard
      request={request}
      onAccept={handleAcceptRequest}
      onReject={handleRejectRequest}
      // Ensure returning from profile restores this screen to the Requests tab
      // reliably by directing BountyApp to open messages + requests.
      referrerOverride={`${ROUTES.TABS.BOUNTY_APP}?screen=messages&initialTab=requests`}
    />
  ), [handleAcceptRequest, handleRejectRequest]);

  if (showArchivedBounties) {
    return <ArchivedBountiesScreen onBack={() => setShowArchivedBounties(false)} />
  }

  // The pay-at-accept gate takes over the whole screen while it is open. It is
  // only ever active for a bounty that was posted unfunded and still needs
  // escrow — every legacy bounty resolves it instantly and invisibly.
  if (acceptFundingGate.active) {
    return <AcceptFundingGate gate={acceptFundingGate} />
  }

  return (
    <View className="flex-1" style={{ backgroundColor: theme.background }}>
        {/* Fixed Header (overlay) - measured height to align content under tabs */}
        <View
          onLayout={(e) => setHeaderHeight(e.nativeEvent.layout.height)}
          style={[
            {
              position: "absolute",
              top: -55,
              left: 0,
              right: 0,
              zIndex: 20,
              backgroundColor: theme.background,
              paddingTop: insets.top,
            },
            showShadow
              ? {
                shadowColor: "#000",
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.2,
                shadowRadius: 6,
                elevation: 6,
              }
              : null,
          ]}
        >
          {/* Header */}
          <View className="flex-row justify-between items-center px-4">
            {/* Left: logo aligned like messenger (no back icon) */}
            <View className="flex-row items-center" style={styles.translateY2}>
              <BrandingLogo size="medium" />
            </View>

            {/* Right: Wallet balance pill and bookmark (inline) */}
            <View className="flex-row items-center" style={styles.translateY2}>
              {/* Balance pill sits to the left, bookmark to the right */}
              <WalletBalanceButton onPress={() => setActiveScreen('wallet')} />
              <TouchableOpacity
                className="ml-3 p-2 touch-target-min"
                onPress={() => setShowArchivedBounties(true)}
                accessibilityRole="button"
                accessibilityLabel="View archived bounties"
                accessibilityHint="Opens a list of your archived bounties"
              >
                <MaterialIcons
                  name="bookmark"
                  size={20}
                  color={theme.text}
                  accessibilityElementsHidden={true}
                />
              </TouchableOpacity>
            </View>
          </View>

          {/* Offline status badge */}
          <View className="px-4 mb-2">
            <OfflineStatusBadge />
          </View>

          {/* Title (centered below header) */}
          <View className="px-4">
            <Text style={[styles.titleText, { color: theme.text }]} className="font-bold tracking-wide uppercase text-center w-full">
              {activeTab === "inProgress"
                ? "In Progress"
                : activeTab === "requests"
                  ? "Bounty Requests"
                  : "My Postings"}
            </Text>
          </View>


          {/* Tabs - Segmented Control Style */}
          <View className="px-4 mb-4" style={{ backgroundColor: theme.background }}>
            <View className="flex-row items-center rounded-full p-1 border" style={{ backgroundColor: theme.surfaceSecondary, borderColor: theme.border }}>
              {tabs.map((tab) => {
                const isActive = activeTab === tab.id
                const badgeCount = getTabBadgeCount(tab.id)
                return (
                  <TouchableOpacity
                    key={tab.id}
                    onPress={() => setActiveTab(tab.id)}
                    activeOpacity={0.85}
                    className="flex-1 py-2 mx-0.5 rounded-full items-center justify-center touch-target-min"
                    style={{
                      backgroundColor: isActive ? theme.surface : 'transparent',
                      shadowColor: isActive ? '#000' : 'transparent',
                      shadowOffset: { width: 0, height: isActive ? 2 : 0 },
                      shadowOpacity: isActive ? 0.12 : 0,
                      shadowRadius: isActive ? 3 : 0,
                      elevation: isActive ? 2 : 0,
                    }}
                    accessibilityRole="tab"
                    accessibilityLabel={
                      badgeCount > 0
                        ? `${tab.label}, ${badgeCount} need attention`
                        : tab.label
                    }
                    accessibilityState={{ selected: isActive }}
                    accessibilityHint={`Switch to ${tab.label} tab`}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <MaterialIcons
                        name={tab.icon as keyof typeof MaterialIcons.glyphMap}
                        size={14}
                        color={isActive ? theme.primary : theme.textDisabled}
                        accessibilityElementsHidden={true}
                      />
                      <Text
                        className="text-xs font-semibold tracking-wide ml-1"
                        style={{ color: isActive ? theme.primary : theme.textDisabled }}
                        numberOfLines={1}
                      >
                        {tab.shortLabel.toUpperCase()}
                      </Text>
                      {badgeCount > 0 && (
                        <View
                          style={{
                            marginLeft: 4,
                            backgroundColor: isActive ? '#dc2626' : '#ef4444',
                            borderRadius: 8,
                            minWidth: 16,
                            height: 16,
                            alignItems: 'center',
                            justifyContent: 'center',
                            paddingHorizontal: 3,
                          }}
                        >
                          <Text style={{ color: '#fff', fontSize: 9, fontWeight: '700', lineHeight: 12 }}>
                            {badgeCount > 99 ? '99+' : badgeCount}
                          </Text>
                        </View>
                      )}
                    </View>
                  </TouchableOpacity>
                )
              })}
            </View>
          </View>
        </View>

        {/* Scrollable Content Area - starts under visible bottom of header */}
        <View className="flex-1" style={containerPaddingTop}>
          {/* Error message */}
          {error && (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{error}</Text>
                <TouchableOpacity style={styles.errorCloseButton} onPress={() => setError(null)}>
                  <Text style={styles.errorCloseText}>✕</Text>
                </TouchableOpacity>
              </View>
          )}

          <View className="flex-1 px-4">
            {activeTab === "inProgress" ? (
              <FlatList
                ref={inProgressListRef}
                data={inProgressRows}
                keyExtractor={keyExtractorRow}
                extraData={{ inProgressBounties, expandedMap }}
                ListHeaderComponent={(
                  <View>
                    <BountyWorkflowGuide variant="hunter-inprogress" />
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      className="mb-1"
                    >
                      <View className="flex-row gap-1.5">
                      {IN_PROGRESS_FILTERS.map((f) => {
                        const label = IN_PROGRESS_FILTER_LABELS[f]
                        const selected = statusFilterInProgress === f
                        const count = f === 'review' ? inProgressReviewCount : 0
                          return (
                          <TouchableOpacity
                            key={f}
                            onPress={() => setStatusFilterInProgress(f)}
                            className="px-2 py-1.5 rounded-full border flex-row items-center"
                            style={{ backgroundColor: selected ? theme.surfaceSecondary : theme.surface, borderColor: selected ? theme.primaryLight : theme.border }}
                            accessibilityRole="button"
                            accessibilityLabel={f === 'review' ? `Filter by work you submitted for review${count > 0 ? `, ${count} item${count === 1 ? '' : 's'}` : ''}` : `Filter by ${label} work`}
                            accessibilityState={{ selected }}
                            accessibilityHint={selected ? 'Currently active filter' : f === 'review' ? "Tap to show only work you submitted that is awaiting the poster's review" : `Tap to show only ${label} work`}
                          >
                            <Text className="text-xs" style={{ fontWeight: selected ? '500' : 'normal', color: selected ? theme.text : theme.textSecondary }}>{label}</Text>
                            {f === 'review' && count > 0 && (
                              <View className="ml-1 px-1 rounded-full bg-amber-400 min-w-[16px] items-center">
                                <Text className="text-[10px] font-bold text-[#111827]">{count > 99 ? "99+" : count}</Text>
                              </View>
                            )}
                          </TouchableOpacity>
                        )
                      })}
                      </View>
                    </ScrollView>
                  </View>
                )}
                renderItem={renderInProgressItem}
                ListEmptyComponent={
                  isLoading.inProgress ? (
                    <View className="px-4 py-6">
                      <PostingsListSkeleton count={3} />
                    </View>
                  ) : error ? (
                    <EmptyState
                      icon="cloud-off"
                      title="Unable to Load"
                      description="Check your internet connection and try again"
                      actionLabel="Try Again"
                      onAction={loadInProgress}
                    />
                  ) : (
                    <EmptyState
                      icon="work-outline"
                      title="Track Every Bounty You Accept"
                      description="This is your work hub. Once you accept a bounty, it lands here so you can follow it from kickoff to payout."
                      size="lg"
                      features={[
                        { icon: 'play-circle-outline', label: 'Active work' },
                        { icon: 'check-circle-outline', label: 'Completed work' },
                        { icon: 'archive', label: 'Archived work' },
                        { icon: 'cancel', label: 'Canceled work' },
                      ]}
                      actionLabel="Find Bounties"
                      onAction={() => setActiveScreen('bounty')}
                      footnote="Browse nearby or online bounties to get started."
                    />
                  )
                }
                refreshControl={
                  <RefreshControl
                    refreshing={isRefreshing}
                    onRefresh={refreshAll}
                    tintColor={theme.text}
                    colors={['#059669']}
                  />
                }
                contentContainerStyle={listContentPadding}
                showsVerticalScrollIndicator={false}
                onScroll={(e) => {
                  const y = e.nativeEvent.contentOffset.y || 0
                  if (y > 2 && !showShadow) setShowShadow(true)
                  else if (y <= 2 && showShadow) setShowShadow(false)
                }}
                onScrollBeginDrag={() => setIsListScrolling(true)}
                onScrollEndDrag={() => setTimeout(() => setIsListScrolling(false), 50)}
                onMomentumScrollEnd={() => setIsListScrolling(false)}
                scrollEventThrottle={16}
                // Performance optimizations
                removeClippedSubviews={true}
                maxToRenderPerBatch={5}
                windowSize={5}
                initialNumToRender={5}
              />
            ) : activeTab === "requests" ? (
              <FlatList
                data={bountyRequests}
                keyExtractor={keyExtractorRequest}
                getItemLayout={getItemLayoutRequest}
                renderItem={renderRequestItem}
                ListHeaderComponent={<BountyWorkflowGuide variant="poster-requests" />}
                ListEmptyComponent={
                  isLoading.requests ? (
                    <View className="px-4 py-6">
                      {Array.from({ length: 3 }).map((_, i) => (
                        <ApplicantCardSkeleton key={i} />
                      ))}
                    </View>
                  ) : error ? (
                    <EmptyState
                      icon="cloud-off"
                      title="Unable to Load"
                      description="Check your internet connection and try again"
                      actionLabel="Try Again"
                      onAction={loadRequestsForMyBounties.bind(null, myBounties)}
                    />
                  ) : (
                    <EmptyState
                      icon="mark-email-read"
                      tone="success"
                      title="You're All Caught Up"
                      description="No pending requests right now. Anything that needs your attention — like a bounty application or invitation — will show up here automatically."
                      size="lg"
                      footnote="New requests appear instantly — no need to refresh."
                    />
                  )
                }
                refreshControl={
                  <RefreshControl
                    refreshing={isRefreshing}
                    onRefresh={refreshAll}
                    tintColor={theme.text}
                    colors={['#059669']}
                  />
                }
                contentContainerStyle={listContentPadding}
                showsVerticalScrollIndicator={false}
                onScroll={(e) => {
                  const y = e.nativeEvent.contentOffset.y || 0
                  if (y > 2 && !showShadow) setShowShadow(true)
                  else if (y <= 2 && showShadow) setShowShadow(false)
                }}
                scrollEventThrottle={16}
                // Performance optimizations
                removeClippedSubviews={true}
                maxToRenderPerBatch={5}
                windowSize={5}
                initialNumToRender={5}
              />
            ) : (
              <FlatList
                ref={myPostingsListRef}
                data={myPostingsRows}
                keyExtractor={keyExtractorRow}
                extraData={{ myBounties, expandedMap }}
                ListHeaderComponent={(
                  <View>
                    <BountyWorkflowGuide variant="poster-postings" />
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      className="mb-1"
                    >
                      <View className="flex-row gap-1.5">
                      {MY_POSTINGS_FILTERS.map((f) => {
                        const label = MY_POSTINGS_FILTER_LABELS[f]
                        const selected = statusFilterMyPostings === f
                        const count = f === 'review' ? myPostingsReviewCount : 0
                          return (
                          <TouchableOpacity
                            key={f}
                            onPress={() => setStatusFilterMyPostings(f)}
                            className="px-2 py-1.5 rounded-full border flex-row items-center"
                            style={{ backgroundColor: selected ? theme.surfaceSecondary : theme.surface, borderColor: selected ? theme.primaryLight : theme.border }}
                            accessibilityRole="button"
                            accessibilityLabel={f === 'review' ? `Filter by postings with work awaiting your review${count > 0 ? `, ${count} item${count === 1 ? '' : 's'}` : ''}` : `Filter by ${label} postings`}
                            accessibilityState={{ selected }}
                            accessibilityHint={selected ? 'Currently active filter' : f === 'review' ? 'Tap to show only postings where a hunter submitted work for your review' : `Tap to show only ${label} bounties`}
                          >
                            <Text className="text-xs" style={{ fontWeight: selected ? '500' : 'normal', color: selected ? theme.text : theme.textSecondary }}>{label}</Text>
                            {f === 'review' && count > 0 && (
                              <View className="ml-1 px-1 rounded-full bg-amber-400 min-w-[16px] items-center">
                                <Text className="text-[10px] font-bold text-[#111827]">{count > 99 ? "99+" : count}</Text>
                              </View>
                            )}
                          </TouchableOpacity>
                        )
                      })}
                      </View>
                    </ScrollView>
                  </View>
                )}
                renderItem={renderMyPostingItem}
                ListEmptyComponent={
                  isLoading.myBounties ? (
                    <View className="px-4 py-6">
                      <PostingsListSkeleton count={3} />
                    </View>
                  ) : error ? (
                    <EmptyState
                      icon="cloud-off"
                      title="Unable to Load"
                      description="Check your internet connection and try again"
                      actionLabel="Try Again"
                      onAction={loadMyBounties}
                    />
                  ) : (
                    <EmptyState
                      icon="post-add"
                      title="Every Bounty You've Posted, In One Place"
                      description="This is where you'll manage everything you post — from the first applicant to the final payout."
                      size="lg"
                      features={[
                        { icon: 'person-search', label: 'Monitor applicants' },
                        { icon: 'trending-up', label: 'Manage progress' },
                        { icon: 'forum', label: 'Communicate with hunters' },
                        { icon: 'task-alt', label: 'Track completed work' },
                      ]}
                      actionLabel="Post a Bounty"
                      // Creating a bounty lives on the Post tab.
                      onAction={() => setActiveScreen('postings')}
                    />
                  )
                }
                refreshControl={
                  <RefreshControl
                    refreshing={isRefreshing}
                    onRefresh={refreshAll}
                    tintColor={theme.text}
                    colors={['#059669']}
                  />
                }
                contentContainerStyle={listContentPadding}
                showsVerticalScrollIndicator={false}
                onScroll={(e) => {
                  const y = e.nativeEvent.contentOffset.y || 0
                  if (y > 2 && !showShadow) setShowShadow(true)
                  else if (y <= 2 && showShadow) setShowShadow(false)
                }}
                scrollEventThrottle={16}
                // Performance optimizations
                removeClippedSubviews={true}
                maxToRenderPerBatch={5}
                windowSize={5}
                initialNumToRender={5}
              />
            )}
          </View>
        </View>

        {/* Bottom navigation is provided by the app container (BountyApp) */}

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

function makeStyles(theme: AppTheme) {
  return StyleSheet.create({
    translateY2: { transform: [{ translateY: 2 }] },
    titleText: { fontSize: 20, color: theme.text },
    errorBox: { marginHorizontal: 16, marginBottom: 16, padding: 12, backgroundColor: 'rgba(239,68,68,0.45)', borderRadius: 8 },
    errorText: { color: theme.text, fontSize: 14 },
    errorCloseButton: { position: 'absolute', right: 8, top: 8, padding: 8 },
    errorCloseText: { color: theme.text, fontSize: 16 },
  });
}
