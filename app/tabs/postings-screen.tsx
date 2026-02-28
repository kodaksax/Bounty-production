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
import { useValidUserId } from '../../hooks/useValidUserId'
// Render In Progress tab using the same expandable card as My Postings
import { MyPostingExpandable } from "../../components/my-posting-expandable"
import { OfflineStatusBadge } from '../../components/offline-status-badge'
import { EmptyState } from '../../components/ui/empty-state'
import { ApplicantCardSkeleton, PostingsListSkeleton } from '../../components/ui/skeleton-loaders'
import { WalletBalanceButton } from '../../components/ui/wallet-balance-button'
import { useAuthContext } from '../../hooks/use-auth-context'
import { useAcceptRequest } from '../../hooks/useAcceptRequest'
import { useBountyForm } from '../../hooks/useBountyForm'
import { useRejectRequest } from '../../hooks/useRejectRequest'
import { useWallet } from '../../lib/wallet-context'



import { colors } from '../../lib/theme';
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
  const rawUserId = useValidUserId()
  const currentUserId = rawUserId ?? undefined
  const router = useRouter()
  
  const [activeTab, setActiveTab] = useState("new")
  const [showArchivedBounties, setShowArchivedBounties] = useState(false)
  // Always use guided multi-step flow on New tab
  const [showMultiStepFlow, setShowMultiStepFlow] = useState(true)
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
  const BOTTOM_ACTIONS_HEIGHT = 64 // compact height to free more scroll space
  const HEADER_TOP_OFFSET = 55 // how far the header is visually pulled up
  const STICKY_BOTTOM_EXTRA = 44 // extra height used by chips/title in sticky bar
  const BOTTOM_NAV_OFFSET = 60// height of BottomNav + gap so sticky actions sit fully above it
  const { balance, deposit, createEscrow, refundEscrow } = useWallet()
  const [workTypeFilter, setWorkTypeFilter] = useState<'all' | 'online' | 'in_person'>('all')
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

  // ---- Bounty form state and handlers (extracted to useBountyForm) ----
  // Manages form field values, validation, submission (including escrow creation),
  // confirmation card visibility, and related UX state (loading, success, error).
  const {
    formData,
    setFormData,
    showConfirmationCard,
    setShowConfirmationCard,
    showAddBountyAmount,
    setShowAddBountyAmount,
    showAddMoney,
    setShowAddMoney,
    isSubmitting,
    postSuccess,
    validationError,
    setValidationError,
    postButtonRef,
    lowBalanceAnim,
    otherSelected,
    AMOUNT_PRESETS,
    handleChooseAmount,
    handleAddBountyAmount,
    handleShowConfirmation,
    handlePostBounty,
  } = useBountyForm({
    currentUserId,
    balance,
    createEscrow,
    isEmailVerified,
    onBountyPosted,
    setActiveScreen,
    setMyBounties,
    onError: setError,
  })

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

  const tabs = [
    { id: "new", label: "New" },
    { id: "inProgress", label: "In Progress" },
    { id: "myPostings", label: "My Postings" },
    { id: "requests", label: "Requests" },
  ]

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
  }, [postSuccess, loadMyBounties, loadInProgress, currentUserId]) // Re-fetch after a successful post

  // ANNOTATION: The Supabase real-time subscriptions have been removed.
  // To re-implement real-time updates, use WebSockets or Server-Sent Events (SSE).
  // The component now fetches data when it loads or after a new bounty is posted.

  // ---- Accept/Reject request handlers (extracted to hooks) ----
  const { handleAcceptRequest } = useAcceptRequest({
    currentUserId,
    balance,
    bountyRequests,
    myBounties,
    setBountyRequests,
    setMyBounties,
    setInProgressBounties,
    setIsLoading,
    setError,
    setShowAddMoney,
    loadMyBounties,
    loadInProgress,
    loadRequestsForMyBounties,
    onBountyAccepted,
    setActiveScreen,
  })

  const { handleRejectRequest } = useRejectRequest({
    setBountyRequests,
    setIsLoading,
    setError,
  })

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
      <View className="flex-1 bg-background-secondary">
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
              backgroundColor: colors.background.secondary, // emerald-600
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
          <View className="px-4 mb-4 bg-background-secondary">
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
            <View className="mx-4 mb-4 p-3 bg-primary-500/70 rounded-lg">
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
                      colors={[colors.primary[500]]}
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
                      colors={[colors.primary[500]]}
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
                      colors={[colors.primary[500]]}
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
            className="absolute left-0 right-0 bottom-0 bg-background-secondary/95 border-t border-emerald-500/30"
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
