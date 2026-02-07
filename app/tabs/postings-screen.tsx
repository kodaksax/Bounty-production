"use client"

import { MaterialIcons } from "@expo/vector-icons"
// DateTimePicker removed from inline usage; dedicated screen handles picking
import { CreateBountyFlow } from "app/screens/CreateBounty"
import { BrandingLogo } from "components/ui/branding-logo"
import { useRouter } from "expo-router"
import type { BountyRequestWithDetails } from "lib/services/bounty-request-service"
import { bountyRequestService } from "lib/services/bounty-request-service"
import { bountyService } from "lib/services/bounty-service"
import type { Bounty } from "lib/services/database.types"
import { cn } from "lib/utils"
import { CURRENT_USER_ID, getCurrentUserId } from "lib/utils/data-utils"
import { logger } from 'lib/utils/error-logger'
import * as React from "react"
import { useEffect, useRef, useState } from "react"
import { ActivityIndicator, Alert, Animated, FlatList, Keyboard, RefreshControl, ScrollView, Text, TouchableOpacity, TouchableWithoutFeedback, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { AddBountyAmountScreen } from "../../components/add-bounty-amount-screen"
import { AddMoneyScreen } from "../../components/add-money-screen"
import { ApplicantCard } from "../../components/applicant-card"
import { ArchivedBountiesScreen } from "../../components/archived-bounties-screen"
import { BountyConfirmationCard } from "../../components/bounty-confirmation-card"
import { EditPostingModal } from "../../components/edit-posting-modal"
// Render In Progress tab using the same expandable card as My Postings
import { MyPostingExpandable } from "../../components/my-posting-expandable"
import { OfflineStatusBadge } from '../../components/offline-status-badge'
import { EmptyState } from '../../components/ui/empty-state'
import { ApplicantCardSkeleton, PostingsListSkeleton } from '../../components/ui/skeleton-loaders'
import { WalletBalanceButton } from '../../components/ui/wallet-balance-button'
import { useAuthContext } from '../../hooks/use-auth-context'
import { useWallet } from '../../lib/wallet-context'

// Removed unused StyleSheet (styles) to satisfy eslint no-unused-vars



interface PostingsScreenProps {
  onBack?: () => void
  activeScreen: string
  setActiveScreen: (screen: string) => void
  onBountyPosted?: () => void // Callback when a bounty is successfully posted
  onBountyAccepted?: (bountyId?: string | number) => void // Callback when a bounty is accepted
  setShowBottomNav?: (show: boolean) => void
}

// Top-level stable row component to avoid remounting during parent state updates
type MyPostingRowProps = {
  bounty: Bounty
  currentUserId?: string
  expanded: boolean
  onToggle: () => void
  onEdit?: () => void
  onDelete?: () => void
  onWithdrawApplication?: () => void
  onGoToReview: (id: string) => void
  onGoToPayout: (id: string) => void
  variant?: 'owner' | 'hunter'
  isListScrolling?: boolean
  onExpandedLayout?: () => void
  onRefresh?: () => void
}

export const MyPostingRow: React.FC<MyPostingRowProps> = React.memo(function MyPostingRow({ bounty, currentUserId, expanded, onToggle, onEdit, onDelete, onWithdrawApplication, onGoToReview, onGoToPayout, variant, isListScrolling, onExpandedLayout, onRefresh }) {
  return (
    <MyPostingExpandable
      bounty={bounty}
      currentUserId={currentUserId}
      expanded={expanded}
      onToggle={onToggle}
      onEdit={onEdit}
      onDelete={onDelete}
      onWithdrawApplication={onWithdrawApplication}
      onGoToReview={onGoToReview}
      onGoToPayout={onGoToPayout}
      variant={variant}
      isListScrolling={isListScrolling}
      onExpandedLayout={onExpandedLayout}
      onRefresh={onRefresh}
    />
  )
})

export function PostingsScreen({ onBack, activeScreen, setActiveScreen, onBountyPosted, onBountyAccepted, setShowBottomNav }: PostingsScreenProps) {
  const { isEmailVerified } = useAuthContext()
  const currentUserId = getCurrentUserId()
  const router = useRouter()
  
  const [activeTab, setActiveTab] = useState("new")
  const [showArchivedBounties, setShowArchivedBounties] = useState(false)
  const [showAddBountyAmount, setShowAddBountyAmount] = useState(false)
  const [showConfirmationCard, setShowConfirmationCard] = useState(false)
  // Always use guided multi-step flow on New tab
  const [showMultiStepFlow, setShowMultiStepFlow] = useState(true)
  const [headerHeight, setHeaderHeight] = useState(0)
  const [showShadow, setShowShadow] = useState(false)
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    location: "",
    amount: 0,
    timeline: "",
    skills: "",
    isForHonor: false,
    workType: 'in_person' as 'online' | 'in_person',
    isTimeSensitive: false,
    deadline: '',
  attachments: [] as { id: string; name: string; uri: string; mimeType?: string; size?: number; status?: 'pending' | 'uploading' | 'uploaded' | 'failed'; progress?: number; remoteUri?: string }[],
  })

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
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [postSuccess, setPostSuccess] = useState(false)
  const postButtonRef = useRef<any>(null)

  const insets = useSafeAreaInsets()
  const BOTTOM_ACTIONS_HEIGHT = 64 // compact height to free more scroll space
  const HEADER_TOP_OFFSET = 55 // how far the header is visually pulled up
  const STICKY_BOTTOM_EXTRA = 44 // extra height used by chips/title in sticky bar
  const BOTTOM_NAV_OFFSET = 60// height of BottomNav + gap so sticky actions sit fully above it
  const AMOUNT_PRESETS = [5, 10, 25, 50, 100]
  const { balance, deposit, createEscrow, refundEscrow } = useWallet()
  const [showAddMoney, setShowAddMoney] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)
  const otherSelected = formData.amount !== 0 && !AMOUNT_PRESETS.includes(formData.amount)
  const [workTypeFilter, setWorkTypeFilter] = useState<'all' | 'online' | 'in_person'>('all')
  // Animation refs
  const lowBalanceAnim = useRef(new Animated.Value(0)).current
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
  
  // Deadline now simple text entry; dedicated screen removed

  // ---- Data Loaders (refreshed after post and when opening screen) ----
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
      const requestsPromises = openBounties.map((b) => bountyRequestService.getAllWithDetails({ bountyId: b.id }))
      const requestsArrays = await Promise.all(requestsPromises)
      setBountyRequests(requestsArrays.flat())
    } catch (e: any) {
      console.error('Error loading bounty requests:', e)
      setError('Failed to load bounty requests')
    } finally {
      setIsLoading((prev) => ({ ...prev, requests: false }))
    }
  }, [])

  const loadMyBounties = React.useCallback(async () => {
    // Guard: don't load if no valid user (including sentinel/fallback user IDs)
    if (!currentUserId || currentUserId === CURRENT_USER_ID) {
      // Immediately clear loading flags and empty data to avoid stuck skeletons
      setIsLoading((prev) => ({ ...prev, myBounties: false, requests: false }))
      setMyBounties([])
      setBountyRequests([])
      return
    }
    
    try {
      setIsLoading((prev) => ({ ...prev, myBounties: true }))
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
    // Guard: don't load if no valid user (including sentinel/fallback user IDs)
    if (!currentUserId || currentUserId === CURRENT_USER_ID) {
      // Immediately clear loading flags and empty data to avoid stuck skeletons
      setIsLoading((prev) => ({ ...prev, inProgress: false }))
      setInProgressBounties([])
      return
    }
    
    try {
      setIsLoading((prev) => ({ ...prev, inProgress: true }))
      // Show bounties that the current user has applied for (pending/accepted/etc.)
      const requests = await bountyRequestService.getAllWithDetails({ userId: currentUserId })
      // Only include bounties where the user's request isn't rejected
      const relevant = requests.filter(r => r.status !== 'rejected')
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

  const handleChooseAmount = (val: number) => {
    setFormData((prev) => ({ ...prev, amount: val, isForHonor: false }))
  }

  const tabs = [
    { id: "new", label: "New" },
    { id: "inProgress", label: "In Progress" },
    { id: "myPostings", label: "My Postings" },
    { id: "requests", label: "Requests" },
  ]

  // Fetch data from the API
  useEffect(() => {
    // Only load data if we have a valid authenticated user (including sentinel/fallback user IDs)
    if (!currentUserId || currentUserId === CURRENT_USER_ID) {
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
  }, [postSuccess, loadMyBounties, loadInProgress, currentUserId]) // Re-fetch after a successful post

  // ANNOTATION: The Supabase real-time subscriptions have been removed.
  // To re-implement real-time updates, you would need to use a technology
  // like WebSockets or Server-Sent Events (SSE) with your Hostinger backend.
  // The component now fetches data when it loads or after a new bounty is posted.

  const handleAddBountyAmount = (amount: number, isForHonor: boolean) => {
    setFormData((prev) => ({
      ...prev,
      amount,
      isForHonor,
    }))
    setShowAddBountyAmount(false)
  }

  // Show confirmation card instead of directly posting
  const handleShowConfirmation = () => {
    // Email verification gate: Block posting if email is not verified
    if (!isEmailVerified) {
      Alert.alert(
        'Email verification required',
        "Please verify your email to post bounties. We've sent a verification link to your inbox.",
        [
          { text: 'OK', style: 'default' }
        ]
      )
      return
    }
    setShowConfirmationCard(true)
  }

  // Handle the actual bounty posting after confirmation
  const handlePostBounty = async () => {
    // Email verification gate: Double-check before submitting
    if (!isEmailVerified) {
      Alert.alert(
        'Email verification required',
        "Please verify your email to post bounties. We've sent a verification link to your inbox.",
        [
          { text: 'OK', style: 'default' }
        ]
      )
      return
    }
    
    try {
      setIsSubmitting(true)
      setError(null)

      // Validate balance BEFORE posting bounty for paid bounties
      if (!formData.isForHonor && formData.amount > 0) {
        if (balance < formData.amount) {
          Alert.alert(
            'Insufficient Balance',
            'You do not have enough balance to post this bounty. Please add funds to your wallet.',
            [{ text: 'OK' }]
          )
          setIsSubmitting(false)
          return; // Don't post the bounty at all
        }
      }

      // Prepare bounty data
    const bountyData: Omit<Bounty, "id" | "created_at"> & { attachments_json?: string } = {
  title: formData.title,
  description: formData.description,
  amount: formData.isForHonor ? 0 : formData.amount,
  is_for_honor: formData.isForHonor,
  location: formData.workType === 'in_person' ? formData.location : '',
  timeline: formData.timeline,
  skills_required: formData.skills,
    poster_id: currentUserId,
  status: "open", // Ensure this matches the expected type
  work_type: formData.workType,
  is_time_sensitive: formData.isTimeSensitive,
  deadline: formData.isTimeSensitive ? formData.deadline : undefined,
    // Persist attachments_json if any attachments have finished uploading or have a remoteUri
    attachments_json: (() => {
      const uploaded = formData.attachments.filter(a => (a as any).remoteUri || a.status === 'uploaded')
      return uploaded.length ? JSON.stringify(uploaded) : undefined
    })(),

      }



      // Debug: log exact payload being sent to create
      try {
        logger.info('[PostingsScreen] Creating bounty with payload:', { payload: bountyData })
      } catch (e) {
        logger.warning('[PostingsScreen] Creating bounty - could not stringify payload', { error: (e as any)?.message })
      }

      // Create the bounty using our service
      const bounty = await bountyService.create(bountyData)

      if (!bounty) {
        throw new Error("Failed to create bounty. The server returned an empty response.")
      }

      // Create escrow for paid bounties (funds are held when bounty is posted)
      if (bounty && !bounty.is_for_honor && bounty.amount > 0) {
        try {
          await createEscrow(
            bounty.id,
            bounty.amount,
            bounty.title,
            currentUserId
          )
        } catch (escrowError) {
          console.error('Error creating escrow:', escrowError)
          // If escrow creation fails, delete the bounty to maintain consistency
          await bountyService.delete(bounty.id)
          Alert.alert(
            'Escrow Failed',
            'Failed to create escrow for this bounty. The bounty has been removed.',
            [{ text: 'OK' }]
          )
          setIsSubmitting(false)
          return; // Don't add to UI state
        }
      }

      // Important: Update local state with the new bounty
      if (bounty) {
        setMyBounties((prevBounties) => [bounty, ...prevBounties])

  // Set success state to trigger animations and UI updates
  setPostSuccess(true)

  // Notify parent to refresh public feed
  onBountyPosted?.()

        // Reset form
        setFormData({
          title: "",
          description: "",
          location: "",
          amount: 0,
          timeline: "",
          skills: "",
          isForHonor: false,
          workType: 'in_person',
          isTimeSensitive: false,
          deadline: '',
          attachments: [],
        })

        // Close confirmation card
        setShowConfirmationCard(false)

        // Navigate to the main bounty feed so the new bounty is visible
        setActiveScreen?.('bounty')

        // Reset success state after a delay
        setTimeout(() => {
          setPostSuccess(false)
        }, 3000)
      }
    } catch (err: any) {
      console.error("Error posting bounty:", err)
      const msg = err instanceof Error ? err.message : (err?.message || 'Failed to post bounty')
      setError(msg)
      setShowConfirmationCard(false)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleAcceptRequest = async (requestId: string | number) => {
    try {
      // Show quick-refresh UI for list transitions
      setIsLoading((prev) => ({ ...prev, requests: true, myBounties: true, inProgress: true }))

      // Find the request to get bounty and profile info
      const request = bountyRequests.find(req => String(req.id) === String(requestId))
      if (!request) {
        throw new Error("Request not found")
      }

      // Prepare identifiers and hunter id early for optimistic UI updates
      const hunterIdForConv = (request as any).hunter_id || (request as any).user_id
      const resolvedBountyId = (request.bounty as any)?.id ?? (request as any)?.bounty_id

      // Optimistically remove all requests for this bounty so UI moves immediately
      if (resolvedBountyId != null) {
        setBountyRequests((prev) => prev.filter(req => String(req.bounty_id) !== String(resolvedBountyId)))
      } else {
        // If we don't know bounty id, at least remove the single request
        setBountyRequests((prev) => prev.filter(req => String(req.id) !== String(requestId)))
      }

      // Optimistically update My Postings to in_progress
      setMyBounties((prev) =>
        prev.map((b) =>
          String(b.id) === String(resolvedBountyId)
            ? { ...b, status: 'in_progress' as const, accepted_by: hunterIdForConv }
            : b
        )
      )

      // If current user is the accepted hunter, optimistically add to In Progress list
      if (String(hunterIdForConv) === String(currentUserId)) {
        const newBounty = (request.bounty as Bounty) ?? ({ id: resolvedBountyId, title: (request.bounty as any)?.title || '', status: 'in_progress' } as unknown as Bounty)
        setInProgressBounties((prev) => {
          if (resolvedBountyId != null && prev.some(pb => String(pb.id) === String(resolvedBountyId))) return prev
          return [newBounty, ...prev]
        })
      }

      // Check if poster has sufficient balance for paid bounties
      if (request.bounty && !request.bounty.is_for_honor && request.bounty.amount > 0) {
        if (balance < request.bounty.amount) {
          Alert.alert(
            'Insufficient Balance',
            `You need $${request.bounty.amount.toFixed(2)} to accept this request. Your current balance is $${balance.toFixed(2)}.\n\nWould you like to add money to your wallet?`,
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Add Money', onPress: () => setShowAddMoney(true) }
            ]
          )
          return
        }
      }

  // ANNOTATION: This API call should be transactional on your backend.
  const result = await bountyRequestService.acceptRequest(requestId)

      if (!result) {
        // If accept failed server-side, inform the user and reload lists to reflect server state
        console.error('Accept request failed for', requestId)
        Alert.alert('Accept Failed', 'Failed to accept the request on the server. The UI may be out of sync; please refresh.')
        // Reload lists to attempt to restore correct state
        await Promise.allSettled([loadMyBounties(), loadInProgress(), loadRequestsForMyBounties(myBounties)])
        return
      }

      // Update bounty status to in_progress and set accepted_by
      // Prefer the full bounty object id, but fall back to the canonical bounty_id
      const bountyId = (request.bounty as any)?.id ?? (request as any)?.bounty_id

      // If we don't have the full bounty object available on the request, fetch it
      let bountyObj: Bounty | null = (request.bounty as unknown as Bounty) ?? null
      if (!bountyObj && bountyId != null) {
        try {
          const fetched = await bountyService.getById(bountyId)
          if (fetched) bountyObj = fetched
        } catch (fetchErr) {
          console.error('Accept: failed to fetch bounty details', fetchErr)
          // continue: we still attempt update using bountyId, and skip escrow if bounty data missing
        }
      }
  if (bountyId != null) {
        try {
          // Avoid passing null/undefined/NaN to the service. Pass the raw id so
          // the service can decide whether it's a numeric or string id.
          // (bountyService.update accepts a number in TS but handles API paths at runtime.)
          // Use any cast to avoid TypeScript complaints while preserving runtime safety.
          // If your backend expects numeric ids, ensure bounties are stored as numbers.
          // We intentionally do not coerce to Number() here to avoid NaN.
          // Only update the status on the server; the `accepted_by` column may not exist
          // in all deployments (causes PGRST204). Keep `accepted_by` locally for UI only.
          const updated = await (bountyService as any).update(bountyId, {
            status: 'in_progress',
          })
          if (!updated) {
            console.error('bountyService.update returned null for', bountyId, 'updates:', { status: 'in_progress' })
            // Diagnostic: fetch server bounty and log its current state
            try {
              await bountyService.getById(bountyId)
              Alert.alert('Server update failed', `Failed to update bounty ${String(bountyId)}.`)
            } catch (srvErr) {
              console.error('Diagnostic: failed to fetch server bounty after update failure', srvErr)
              Alert.alert('Server update failed', `Failed to update bounty ${String(bountyId)} and failed to fetch server state.`)
            }
          }
        } catch (statusError) {
          console.error('Error updating bounty status:', statusError)
          // Continue with the flow even if status update fails
        }
      }

      // Remove all competing requests for this bounty (cleanup)
      const competingRequests = bountyRequests.filter(
        req => String(req.bounty_id) === String(request.bounty_id) && String(req.id) !== String(requestId)
      )

      if (competingRequests.length > 0) {
        try {
          await Promise.all(
            competingRequests.map(req => bountyRequestService.delete((req.id as any)))
          )
        } catch (cleanupError) {
          console.error('Error cleaning up competing requests:', cleanupError)
          // Continue even if cleanup fails
        }
      }

      // Note: Wallet escrow was already created when the bounty was posted (funds deducted from poster's balance).
      // The ESCROW_HOLD outbox event for Stripe PaymentIntent creation happens in acceptBounty() service.
      // No additional escrow creation needed during request acceptance.

      // Auto-create a conversation for coordination (use bountyId as context)
        try {
        // Use Supabase RPC to create conversation via SECURITY DEFINER function
        // This avoids RLS rejections from client-side inserts.
        const { navigationIntent } = await import('lib/services/navigation-intent')
        const { logClientError, logClientInfo } = await import('lib/services/monitoring')
        const { supabase } = await import('lib/supabase')

        try {
          const participantIds = [currentUserId, String(hunterIdForConv)]
          const convName = request.profile?.username || (bountyObj as any)?.title || 'Conversation'
          const { data, error } = await supabase.rpc('rpc_create_conversation', { p_participant_ids: participantIds, p_bounty_id: String(bountyId), p_name: convName })
          if (error) throw error
          const convId = (data as any) ?? null

          if (convId) {
            // send initial message via supabase function or messages table
            try {
              // Use supabase-messaging sendMessage to persist message
              const supabaseMessaging = await import('lib/services/supabase-messaging')
              await supabaseMessaging.sendMessage(convId, `Welcome! You've been selected for: "${(bountyObj as any)?.title || ''}". Let's coordinate the details.`, currentUserId)
            } catch (msgErr) {
              logClientError('Failed to send initial message via supabase messaging', { err: msgErr, convId, bountyId })
            }

            try { await navigationIntent.setPendingConversationId(String(convId)) } catch {}
            logClientInfo('Supabase RPC conversation created', { convId, bountyId })
          }
        } catch (rpcErr: any) {
          // If RPC failed, fallback to local conversation and log error
          logClientError('Error creating conversation via rpc_create_conversation', { error: rpcErr })
          throw rpcErr
        }
      } catch (convError) {
        console.error('Error creating supabase conversation:', convError)
        // If creating the conversation in Supabase fails (for example RLS denies
        // the insert), fall back to the local persistent layer so the user still
        // has a conversation to coordinate in the app.
        try {
          const { messageService } = await import('lib/services/message-service')
          const { navigationIntent } = await import('lib/services/navigation-intent')
          const { logClientError } = await import('lib/services/monitoring')

          const localConv = await messageService.getOrCreateConversation(
            [hunterIdForConv],
            request.profile?.username || 'Hunter',
            String(bountyId)
          )

          // Send initial local message (best-effort)
          try {
            await messageService.sendMessage(
              localConv.id,
              `Welcome! You've been selected for: "${(bountyObj as any)?.title || ''}". Let's coordinate the details.`,
              currentUserId
            )
          } catch (localMsgErr) {
            logClientError('Failed to send initial local message', { err: localMsgErr, localConvId: localConv.id })
          }

          try { await navigationIntent.setPendingConversationId(localConv.id) } catch { /* best-effort */ }
        } catch (fallbackErr) {
          console.error('Fallback to local conversation also failed:', fallbackErr)
          try {
            const { logClientError } = await import('lib/services/monitoring')
            logClientError('Fallback to local conversation failed', { err: fallbackErr })
          } catch {}
        }
      }

      // Update local state - remove all requests for this bounty since it's now in progress
      setBountyRequests((prev) => prev.filter(req => req.bounty_id !== request.bounty_id))

      // Update bounty in local state (normalize ID comparison using resolved bountyId)
      setMyBounties((prev) =>
        prev.map((b) =>
          String(b.id) === String(bountyId)
            ? { ...b, status: 'in_progress' as const, accepted_by: hunterIdForConv }
            : b
        )
      )

      // If the current user is the accepted hunter, optimistically add the bounty to In Progress list
      if (String(hunterIdForConv) === String(currentUserId)) {
        // If the request includes a full bounty object, use it; otherwise insert a minimal placeholder
        const newBounty = (request.bounty as Bounty) ?? ({ id: bountyId, title: (request.bounty as any)?.title || '', status: 'in_progress' } as unknown as Bounty)
        setInProgressBounties((prev) => {
          if (prev.some(pb => String(pb.id) === String(bountyId))) return prev
          return [newBounty, ...prev]
        })
      }

      // Reload data to ensure consistency across tabs (quick refresh for user)
      await Promise.allSettled([loadMyBounties(), loadInProgress()])

      // Notify parent that a bounty was accepted so higher-level feeds can refresh
      try {
        if (typeof onBountyAccepted === 'function') {
          onBountyAccepted(bountyId ?? request.bounty_id)
        }
      } catch (notifyErr) {
        console.error('Error calling onBountyAccepted callback:', notifyErr)
      }

      // Send notification to hunter about acceptance
      try {
        const API_BASE = process.env.EXPO_PUBLIC_API_BASE_URL || 'http://localhost:3001'
        await fetch(`${API_BASE}/api/notifications`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            user_id: hunterIdForConv,
            type: 'acceptance',
            title: 'Bounty Application Accepted!',
            body: `Your application for "${bountyObj?.title || (request.bounty as any)?.title || 'the bounty'}" has been accepted!`,
            data: {
              bountyId: bountyId,
              posterId: currentUserId,
              ...((bountyObj?.amount || (request.bounty as any)?.amount) && { amount: (bountyObj?.amount ?? (request.bounty as any)?.amount) }),
            }
          })
        })
      } catch (notifError) {
        console.error('Failed to send acceptance notification:', notifError)
        // Don't block the flow if notification fails
      }

      // Show escrow instructions if it's a paid bounty
      if (request.bounty && !request.bounty.is_for_honor && request.bounty.amount > 0) {
        Alert.alert(
          'Request Accepted',
          `You've accepted ${request.profile?.username || 'the hunter'} for "${request.bounty.title}".\n\n💰 Escrow: $${request.bounty.amount.toFixed(2)} has been secured and will be held until completion.\n💬 A conversation has been created to coordinate.`,
          [
            { text: 'View Conversation', onPress: () => setActiveScreen('create') },
            { text: 'OK' }
          ]
        )
      } else {
        Alert.alert(
          'Request Accepted',
          `You've accepted ${request.profile?.username || 'the hunter'} for "${request.bounty.title}".\n\n💬 A conversation has been created to coordinate.`,
          [
            { text: 'View Conversation', onPress: () => setActiveScreen('create') },
            { text: 'OK' }
          ]
        )
      }
    } catch (err: any) {
      console.error("Error accepting request:", err)
      setError(err.message || "Failed to accept request")
    }
    finally {
      setIsLoading((prev) => ({ ...prev, requests: false, myBounties: false, inProgress: false }))
    }
  }

  const handleRejectRequest = async (requestId: string | number) => {
    try {
      // Show quick-refresh indicator for requests
      setIsLoading((prev) => ({ ...prev, requests: true }))

      // Delete the request entirely (user asked rejected requests be deleted)
      const deleted = await bountyRequestService.delete(requestId)

      if (!deleted) {
        throw new Error("Failed to delete rejected request")
      }

      // Update local state - remove the rejected request from the list
      setBountyRequests((prev) => prev.filter((req) => String(req.id) !== String(requestId)))

      // Show confirmation toast
      Alert.alert('Request Rejected', 'The request has been rejected and removed.', [{ text: 'OK' }])
    } catch (err: any) {
      console.error("Error rejecting request:", err)
      setError(err.message || "Failed to reject request")
    } finally {
      setIsLoading((prev) => ({ ...prev, requests: false }))
    }
  }

  const handleEditBounty = React.useCallback((bounty: Bounty) => {
    setEditingBounty(bounty)
    setShowEditModal(true)
  }, [])

  const handleSaveEdit = async (updates: Partial<Bounty>) => {
    if (!editingBounty) return

    try {
      // Optimistic update
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
      throw err
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
            try {
              // Process refund FIRST for paid bounties before any other operations
              if (bounty && !bounty.is_for_honor && bounty.amount > 0 && bounty.status === 'open') {
                try {
                  await refundEscrow(bounty.id, bounty.title, 100); // 100% refund for unaccepted bounties
                } catch (refundError) {
                  console.error('Error refunding escrow:', refundError);
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
            }
          },
        },
      ],
      { cancelable: true }
    )
  }, [refundEscrow, loadMyBounties])

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
              // Get the bounty request for this bounty and current user
              const requests = await bountyRequestService.getAll({
                bountyId: String(bountyId),
                userId: currentUserId,
              })

              if (requests.length === 0) {
                throw new Error("No application found for this bounty")
              }

              const request = requests[0]

              // Delete the bounty request
              const success = await bountyRequestService.delete(request.id)

              if (!success) {
                throw new Error("Failed to withdraw application")
              }

              // Remove from in-progress list
              setInProgressBounties((prev) => prev.filter((b) => b.id !== bountyId))

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

  let alternateScreen: React.ReactNode = null

  if (showArchivedBounties) {
    alternateScreen = (
      <ArchivedBountiesScreen onBack={() => setShowArchivedBounties(false)} />
    )
  } else if (showAddBountyAmount) {
    alternateScreen = (
      <AddBountyAmountScreen
        onBack={() => setShowAddBountyAmount(false)}
        onAddAmount={handleAddBountyAmount}
        initialAmount={formData.amount}
      />
    )
  } else if (showAddMoney) {
    alternateScreen = (
      <AddMoneyScreen
        onBack={() => setShowAddMoney(false)}
        onAddMoney={(amt: number) => {
          deposit(amt)
          setShowAddMoney(false)
        }}
      />
    )
  }
  // Local row component to encapsulate expansion state per item
  // NOTE: MyPostingRow is defined as a top-level component below to avoid recreating
  // the component type on every render. See bottom of file for the stable component.


  // Using shared MyPostingExpandable for consistent look-and-feel; no extra helpers needed here

  // ---- Optimized FlatList callbacks ----
  // Memoized keyExtractor functions
  const keyExtractorBounty = React.useCallback((item: Bounty) => item.id.toString(), []);
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
  const renderMyPostingItem = React.useCallback(({ item: bounty, index }: { item: Bounty; index: number }) => (
    <View
      ref={(r) => { if (r) itemRefs.current[String(bounty.id)] = r }}
      collapsable={false}
    >
      <MyPostingRow
        bounty={bounty}
        currentUserId={currentUserId}
        expanded={!!expandedMap[String(bounty.id)]}
        onToggle={() => handleToggleAndScroll('myPostings', bounty.id)}
        onEdit={bounty.status === 'open' ? () => handleEditBounty(bounty) : undefined}
        onDelete={bounty.status === 'open' ? () => handleDeleteBounty(bounty) : undefined}
        onGoToReview={(id: string) => router.push({ pathname: '/postings/[bountyId]/review-and-verify', params: { bountyId: id } })}
        onGoToPayout={(id: string) => router.push({ pathname: '/postings/[bountyId]/payout', params: { bountyId: id } })}
        variant={'owner'}
        isListScrolling={isListScrolling}
        onRefresh={refreshAll}
      />
    </View>
  ), [currentUserId, expandedMap, isListScrolling, router, handleEditBounty, handleDeleteBounty, refreshAll]);

  const renderInProgressItem = React.useCallback(({ item: bounty, index }: { item: Bounty; index: number }) => (
    <View
      ref={(r) => { if (r) itemRefs.current[String(bounty.id)] = r }}
      collapsable={false}
    >
      <MyPostingRow
        bounty={bounty}
        currentUserId={currentUserId}
        expanded={!!expandedMap[String(bounty.id)]}
        onToggle={() => handleToggleAndScroll('inProgress', bounty.id)}
        onWithdrawApplication={bounty.status === 'open' ? () => handleWithdrawApplication(bounty.id) : undefined}
        onGoToReview={(id: string) => router.push({ pathname: '/in-progress/[bountyId]/hunter/review-and-verify', params: { bountyId: id } })}
        onGoToPayout={(id: string) => router.push({ pathname: '/in-progress/[bountyId]/hunter/payout', params: { bountyId: id } })}
        variant={'hunter'}
        isListScrolling={isListScrolling}
        onRefresh={refreshAll}
      />
    </View>
  ), [currentUserId, expandedMap, isListScrolling, router, refreshAll]);

  const renderRequestItem = React.useCallback(({ item: request }: { item: BountyRequestWithDetails }) => (
    <ApplicantCard
      request={request}
      onAccept={handleAcceptRequest}
      onReject={handleRejectRequest}
    />
  ), [handleAcceptRequest, handleRejectRequest]);

  if (alternateScreen) {
    return alternateScreen
  }

  return (
    <TouchableWithoutFeedback onPress={() => Keyboard.dismiss()}>
      <View className="flex-1 bg-emerald-600">
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
              backgroundColor: "#059669", // emerald-600
              paddingTop: insets.top, // ensure content starts right under the status bar safe area
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
            <View className="flex-row items-center" style={{ transform: [{ translateY: 2 }] }}>
              <BrandingLogo size="medium" />
            </View>

            {/* Right: Wallet balance pill and bookmark (inline) */}
            <View className="flex-row items-center" style={{ transform: [{ translateY: 2 }] }}>
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
                  color="#ffffff"
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
            <Text style={{ fontSize: 20 }} className="text-white font-bold tracking-wide uppercase text-center w-full">
              {activeTab === "inProgress"
                ? "In Progress"
                : activeTab === "requests"
                  ? "Bounty Requests"
                  : activeTab === "myPostings"
                    ? "My Postings"
                    : "Bounty Posting"}
            </Text>
          </View>


          {/* Tabs - Segmented Control Style */}
          <View className="px-4 mb-4 bg-emerald-600">
            <View className="flex-row items-center rounded-full bg-emerald-700/40 p-1 border border-emerald-500/30">
              {tabs.map((tab, idx) => {
                const isActive = activeTab === tab.id
                return (
                  <TouchableOpacity
                    key={tab.id}
                    onPress={() => setActiveTab(tab.id)}
                    activeOpacity={0.85}
                    className={cn(
                      "flex-1 py-2 mx-0.5 rounded-full items-center justify-center touch-target-min",
                      isActive ? "bg-white" : "bg-transparent"
                    )}
                    style={{
                      shadowColor: isActive ? '#000' : 'transparent',
                      shadowOffset: { width: 0, height: isActive ? 2 : 0 },
                      shadowOpacity: isActive ? 0.12 : 0,
                      shadowRadius: isActive ? 3 : 0,
                      elevation: isActive ? 2 : 0,
                    }}
                    accessibilityRole="tab"
                    accessibilityLabel={tab.label}
                    accessibilityState={{ selected: isActive }}
                    accessibilityHint={`Switch to ${tab.label} tab`}
                  >
                    <Text
                      className={cn(
                        "text-xs font-semibold tracking-wide",
                        isActive ? "text-emerald-700" : "text-emerald-200/70"
                      )}
                      numberOfLines={1}
                    >
                      {tab.label.toUpperCase()}
                    </Text>
                  </TouchableOpacity>
                )
              })}
            </View>
          </View>
        </View>

  {/* Scrollable Content Area - starts under visible bottom of header */}
  <View className="flex-1" style={{ paddingTop: Math.max(0, headerHeight - (HEADER_TOP_OFFSET - 12)) }}>
          {/* Error message */}
          {error && (
            <View className="mx-4 mb-4 p-3 bg-red-500/70 rounded-lg">
              <Text style={{ color: 'white', fontSize: 14 }}>{error}</Text>
              <TouchableOpacity style={{ position: 'absolute', right: 8, top: 8, padding: 8 }} onPress={() => setError(null)}>
                <Text style={{ color: 'white', fontSize: 16 }}>✕</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Success message */}
          {postSuccess && (
            <View className="mx-4 mb-4 p-3 bg-emerald-500/70 rounded-lg">
              <Text className="text-white text-sm">Bounty posted successfully!</Text>
            </View>
          )}

          <View className="flex-1 px-4">
            {activeTab === "new" ? (
              <View className="flex-1">
                <CreateBountyFlow
                  onComplete={(bountyId) => {
                    // After creation, go to main feed and refresh publicly visible list
                    setShowBottomNav?.(true)
                    setActiveScreen('bounty')
                    onBountyPosted?.()
                  }}
                  onCancel={() => {
                    // Exit flow: return to postings tabs, show nav, and reset to step 1 by remounting
                    setShowBottomNav?.(true)
                    setActiveTab('myPostings')
                    // force remount when user returns to New tab by toggling state
                    setShowMultiStepFlow(false)
                    setTimeout(() => setShowMultiStepFlow(true), 0)
                  }}
                  onStepChange={() => {
                    // Keep BottomNav visible on all steps
                    setShowBottomNav?.(true)
                  }}
                />
              </View>
            ) : (
              activeTab === "inProgress" ? (
                <FlatList
                  ref={inProgressListRef}
                  data={inProgressBounties.filter(b => workTypeFilter==='all' || b.work_type === workTypeFilter)}
                  keyExtractor={keyExtractorBounty}
                  extraData={{ inProgressBounties, expandedMap }}
                  ListHeaderComponent={(
                    <View className="flex-row gap-2 mb-1">
                      {(['all','online','in_person'] as const).map(f => {
                        const label = f === 'all' ? 'All' : f === 'online' ? 'Online' : 'In Person'
                        const selected = workTypeFilter === f
                        return (
                          <TouchableOpacity 
                            key={f} 
                            onPress={() => setWorkTypeFilter(f)} 
                            className={cn('px-3 py-1.5 rounded-full border', selected ? 'bg-emerald-400/30 border-emerald-300' : 'bg-emerald-800/40 border-emerald-600')}
                            accessibilityRole="button"
                            accessibilityLabel={`Filter by ${label} work in progress`}
                            accessibilityState={{ selected }}
                            accessibilityHint={selected ? 'Currently active filter' : `Tap to show only ${label} work`}
                          >
                            <Text className={cn('text-xs', selected ? 'text-white font-medium' : 'text-emerald-200')}>{label}</Text>
                          </TouchableOpacity>
                        )
                      })}
                    </View>
                  )}
                  renderItem={renderInProgressItem}
                  ListEmptyComponent={
                    isLoading.inProgress ? (
                      <View className="px-4 py-6">
                        <PostingsListSkeleton count={3} />
                      </View>
                    ) : (
                      <EmptyState
                        icon="work-outline"
                        title="No Active Work Yet"
                        description="Ready to start earning? Browse available bounties and accept one to begin!"
                        actionLabel="Browse Bounties"
                        onAction={() => setActiveScreen('bounty')}
                      />
                    )
                  }
                  refreshControl={
                    <RefreshControl
                      refreshing={isRefreshing}
                      onRefresh={refreshAll}
                      tintColor="#ffffff"
                      colors={['#10b981']}
                    />
                  }
                  contentContainerStyle={{ paddingBottom: BOTTOM_NAV_OFFSET + Math.max(insets.bottom, 12) + 16 }}
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
                  ListEmptyComponent={
                    isLoading.requests ? (
                      <View className="px-4 py-6">
                        {Array.from({ length: 3 }).map((_, i) => (
                          <ApplicantCardSkeleton key={i} />
                        ))}
                      </View>
                    ) : (
                      <EmptyState
                        icon="inbox"
                        title="No Applications Yet"
                        description="When hunters apply to your bounties, you'll review and accept them here. Post a bounty to get started!"
                        actionLabel="Post a Bounty"
                        onAction={() => setActiveTab('new')}
                      />
                    )
                  }
                  refreshControl={
                    <RefreshControl
                      refreshing={isRefreshing}
                      onRefresh={refreshAll}
                      tintColor="#ffffff"
                      colors={['#10b981']}
                    />
                  }
                  contentContainerStyle={{ paddingBottom: BOTTOM_NAV_OFFSET + Math.max(insets.bottom, 12) + 16 }}
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
              ) : activeTab === "myPostings" ? (
                <FlatList
                  ref={myPostingsListRef}
                  data={myBounties.filter(b => workTypeFilter==='all' || b.work_type === workTypeFilter)}
                  keyExtractor={keyExtractorBounty}
                  extraData={{ myBounties, expandedMap }}
                  ListHeaderComponent={(
                    <View className="flex-row gap-2 mb-1">
                      {(['all','online','in_person'] as const).map(f => {
                        const label = f === 'all' ? 'All' : f === 'online' ? 'Online' : 'In Person'
                        const selected = workTypeFilter === f
                        return (
                          <TouchableOpacity 
                            key={f} 
                            onPress={() => setWorkTypeFilter(f)} 
                            className={cn('px-3 py-1.5 rounded-full border', selected ? 'bg-emerald-400/30 border-emerald-300' : 'bg-emerald-800/40 border-emerald-600')}
                            accessibilityRole="button"
                            accessibilityLabel={`Filter by ${label} postings`}
                            accessibilityState={{ selected }}
                            accessibilityHint={selected ? 'Currently active filter' : `Tap to show only ${label} bounties`}
                          >
                            <Text className={cn('text-xs', selected ? 'text-white font-medium' : 'text-emerald-200')}>{label}</Text>
                          </TouchableOpacity>
                        )
                      })}
                    </View>
                  )}
                  renderItem={renderMyPostingItem}
                  ListEmptyComponent={
                    isLoading.myBounties ? (
                      <View className="px-4 py-6">
                        <PostingsListSkeleton count={3} />
                      </View>
                    ) : (
                      <EmptyState
                        icon="add-box"
                        title="No Postings Yet"
                        description="You haven't posted any bounties yet. Create your first bounty to get started!"
                        actionLabel="Create Your First Bounty"
                        onAction={() => setActiveTab('new')}
                      />
                    )
                  }
                  refreshControl={
                    <RefreshControl
                      refreshing={isRefreshing}
                      onRefresh={refreshAll}
                      tintColor="#ffffff"
                      colors={['#10b981']}
                    />
                  }
                  contentContainerStyle={{ paddingBottom: BOTTOM_NAV_OFFSET + Math.max(insets.bottom, 12) + 16 }}
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
                <View className="flex items-center justify-center h-full">
                  <Text className="text-emerald-200 text-center">Content will appear here</Text>
                </View>
              ))}
          </View>
        </View>

        {/* Sticky Bottom Actions - iPhone optimized with safe area inset */}
        {activeTab === "new" && !showMultiStepFlow && (
          <View
            className="absolute left-0 right-0 bottom-0 bg-emerald-600/95 border-t border-emerald-500/30"
            style={{
              paddingHorizontal: 12,
              paddingTop: 8,
              // Ensure internal content has breathing room above device inset
              paddingBottom: Math.max(insets.bottom, 12),
              // Reserve more space for the chip row + CTA
              minHeight: BOTTOM_ACTIONS_HEIGHT + STICKY_BOTTOM_EXTRA,
              // Position above BottomNav instead of underneath it
              bottom: BOTTOM_NAV_OFFSET
            }}
          >
            {/* Amount header row */}
            <View className="flex-row items-center justify-between mb-2 px-2">
              <Text className="text-white text-base font-medium">Bounty Amount</Text>
              <Text className="text-emerald-200 text-sm">Current Balance: ${balance.toFixed(2)}</Text>
            </View>

            {/* Preset amount chips + dynamic Other chip (horizontal scroll to keep fixed height) */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 8 }} style={{ height: 48 }}>
              <View className="flex-row items-center gap-3 mb-0">
              {AMOUNT_PRESETS.map((amt) => {
                const selected = formData.amount === amt && !formData.isForHonor;
                const lowBalance = !formData.isForHonor && formData.amount === amt && formData.amount > balance;
                return (
                  <TouchableOpacity
                    key={amt}
                    onPress={() => handleChooseAmount(amt)}
                    className={cn(
                      "px-4 py-2 rounded-full border",
                      selected
                        ? lowBalance
                          ? "bg-amber-400/90 border-amber-200"
                          : "bg-emerald-300 text-emerald-900 border-emerald-200"
                        : "bg-emerald-900/40 border-emerald-500/40",
                    )}
                  >
                    <Text
                      className={cn(
                        "font-medium",
                        selected
                          ? lowBalance
                            ? "text-amber-950"
                            : "text-emerald-900"
                          : "text-emerald-100"
                      )}
                    >
                      ${amt}
                    </Text>
                  </TouchableOpacity>
                );
              })}
              {/* Other chip: only shows custom amount label when otherSelected is true */}
              {(() => {
                const lowBalance = !formData.isForHonor && formData.amount > balance;
                const highlight = otherSelected || lowBalance;
                const displayLabel = otherSelected ? `$${formData.amount}` : 'Other…';
                return (
                  <TouchableOpacity
                    onPress={() => setShowAddBountyAmount(true)}
                    className={cn(
                      "px-4 py-2 rounded-full border",
                      highlight
                        ? lowBalance
                          ? "bg-amber-400/90 border-amber-200"
                          : "bg-emerald-300 border-emerald-200"
                        : "bg-emerald-900/40 border-emerald-500/40"
                    )}
                  >
                    <Text
                      className={cn(
                        "font-medium",
                        highlight
                          ? lowBalance
                            ? "text-amber-950"
                            : "text-emerald-900"
                          : "text-emerald-100"
                      )}
                    >
                      {displayLabel}
                    </Text>
                  </TouchableOpacity>
                );
              })()}
              </View>
            </ScrollView>
            {validationError && (
              <View className="mx-2 mb-2 p-2 bg-red-500/70 rounded-md">
                <Text className="text-white text-xs">{validationError}</Text>
              </View>
            )}
            {formData.isTimeSensitive && !formData.deadline && !validationError && (
              <View className="mx-2 mb-2 p-2 bg-amber-500/20 border border-amber-400/40 rounded-md">
                <Text className="text-amber-200 text-[11px]">Enter a deadline (date/time or phrase) to mark this as urgent.</Text>
              </View>
            )}
            {(() => {
              const baseMissing = !formData.title || !formData.description || !(formData.amount > 0 || formData.isForHonor)
              const locationMissing = formData.workType === 'in_person' && !formData.location
              const deadlineMissing = formData.isTimeSensitive && !formData.deadline
              const requiredMissing = baseMissing || locationMissing || deadlineMissing
              const lowBalance = !formData.isForHonor && formData.amount > balance
              const label = lowBalance ? "LOW BALANCE • Tap to Deposit" : "Post Bounty"
              const handlePress = () => {
                if (lowBalance) { setShowAddMoney(true); return }
                if (requiredMissing) { 
                  let msg = 'Missing required:'
                  if (baseMissing) msg += ' Title, Description, Amount/For Honor;'
                  if (locationMissing) msg += ' Location;'
                  if (deadlineMissing) msg += ' Deadline;'
                  setValidationError(msg.trim()); 
                  return 
                }
                setValidationError(null)
                handleShowConfirmation()
              }
              const shakeTranslate = lowBalanceAnim.interpolate({
                inputRange: [-1, 1],
                outputRange: [-6, 6],
              })
              return (
                <Animated.View style={{ transform: [{ translateX: shakeTranslate }] }}>
                  <TouchableOpacity
                    ref={postButtonRef}
                    onPress={handlePress}
                    className={cn(
                      "self-center w-full px-8 py-4 rounded-2xl border",
                      lowBalance ? "border-amber-400 bg-amber-500/25" : "border-emerald-300/50 bg-emerald-700/30",
                      requiredMissing && !lowBalance ? "border-red-400/70" : ""
                    )}
                    activeOpacity={0.85}
                  >
                    <View className="flex-row items-center justify-center gap-2">
                      {isSubmitting && !lowBalance && <ActivityIndicator size="small" color="white" />}
                      <Text className={cn("font-semibold tracking-wide", lowBalance ? "text-amber-200" : "text-white")}>{label}</Text>
                    </View>
                  </TouchableOpacity>
                </Animated.View>
              )
            })()}
          </View>
        )}

  {/* Bottom navigation is provided by the app container (BountyApp) */}

      {/* Confirmation Card */}
      {showConfirmationCard && (
        <View className="fixed inset-0 z-50">
          <BountyConfirmationCard
            bountyData={{
              title: formData.title,
              description: formData.description,
              amount: formData.amount,
              isForHonor: formData.isForHonor,
              location: formData.location,
              workType: formData.workType,
              isTimeSensitive: formData.isTimeSensitive,
              deadline: formData.isTimeSensitive ? formData.deadline : undefined,
            }}
            onConfirm={handlePostBounty}
            onCancel={() => setShowConfirmationCard(false)}
          />
        </View>
      )}
      {/* Deadline screen removed; using inline text input */}

      {/* Multi-Step flow is rendered inline above for the New tab */}

      {/* Edit Posting Modal */}
      {editingBounty && (
        <EditPostingModal
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
    </TouchableWithoutFeedback>
  )
}

export default PostingsScreen;
