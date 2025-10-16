"use client"

import { MaterialIcons } from "@expo/vector-icons"
// DateTimePicker removed from inline usage; dedicated screen handles picking
import { CreateBountyFlow } from "app/screens/CreateBounty"
import { useRouter } from "expo-router"
import type { BountyRequestWithDetails } from "lib/services/bounty-request-service"
import { bountyRequestService } from "lib/services/bounty-request-service"
import { bountyService } from "lib/services/bounty-service"
import type { Bounty } from "lib/services/database.types"
import { cn } from "lib/utils"
import { getCurrentUserId } from "lib/utils/data-utils"
import * as React from "react"
import { useEffect, useRef, useState } from "react"
import { ActivityIndicator, Alert, Animated, Easing, FlatList, Keyboard, ScrollView, Text, TouchableOpacity, TouchableWithoutFeedback, View } from "react-native"
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
import { useAuthContext } from '../../hooks/use-auth-context'
import { useWallet } from '../../lib/wallet-context'

// Removed unused StyleSheet (styles) to satisfy eslint no-unused-vars



interface PostingsScreenProps {
  onBack?: () => void
  activeScreen: string
  setActiveScreen: (screen: string) => void
  onBountyPosted?: () => void // Callback when a bounty is successfully posted
  setShowBottomNav?: (show: boolean) => void
}

export function PostingsScreen({ onBack, activeScreen, setActiveScreen, onBountyPosted, setShowBottomNav }: PostingsScreenProps) {
  const { session, isEmailVerified } = useAuthContext()
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
  // Total reserved space at the bottom so ScrollView can scroll content above sticky bar
  const STICKY_TOTAL_HEIGHT = BOTTOM_NAV_OFFSET + (BOTTOM_ACTIONS_HEIGHT + STICKY_BOTTOM_EXTRA) + Math.max(insets.bottom, 12) + 16
  const { balance, deposit, createEscrow } = useWallet()
  const [showAddMoney, setShowAddMoney] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)
  const otherSelected = formData.amount !== 0 && !AMOUNT_PRESETS.includes(formData.amount)
  const [workTypeFilter, setWorkTypeFilter] = useState<'all' | 'online' | 'in_person'>('all')
  // Animation refs
  const lowBalanceAnim = useRef(new Animated.Value(0)).current
  const prevLowBalance = useRef(false)
  // Edit/Delete state
  const [showEditModal, setShowEditModal] = useState(false)
  const [editingBounty, setEditingBounty] = useState<Bounty | null>(null)
  // Expanded rows map for My Postings list
  const [expandedMap, setExpandedMap] = useState<Record<string, boolean>>({})

  // Ensure BottomNav is visible while on Postings screen and during create steps
  useEffect(() => {
    setShowBottomNav?.(true)
  }, [setShowBottomNav])

  // Derived lowBalance (current) for animation trigger context (only for new tab)
  const currentLowBalance = React.useMemo(() => !formData.isForHonor && formData.amount > balance, [formData.isForHonor, formData.amount, balance])

  useEffect(() => {
    if (activeTab !== 'new') return
    // Trigger once when transitioning from not low -> low
    if (!prevLowBalance.current && currentLowBalance) {
      // Run a shake sequence
      lowBalanceAnim.setValue(0)
      const sequence = [
        Animated.timing(lowBalanceAnim, { toValue: 1, duration: 50, useNativeDriver: true, easing: Easing.linear }),
        Animated.timing(lowBalanceAnim, { toValue: -1, duration: 50, useNativeDriver: true, easing: Easing.linear }),
        Animated.timing(lowBalanceAnim, { toValue: 1, duration: 50, useNativeDriver: true, easing: Easing.linear }),
        Animated.timing(lowBalanceAnim, { toValue: -1, duration: 50, useNativeDriver: true, easing: Easing.linear }),
        Animated.timing(lowBalanceAnim, { toValue: 0, duration: 40, useNativeDriver: true, easing: Easing.out(Easing.ease) }),
      ]
      Animated.sequence(sequence).start()
    }
    prevLowBalance.current = currentLowBalance
  }, [currentLowBalance, activeTab, lowBalanceAnim])
  // Deadline now simple text entry; dedicated screen removed

  // ---- Data Loaders (refreshed after post and when opening screen) ----
  const loadRequestsForMyBounties = React.useCallback(async (bounties: Bounty[]) => {
    try {
      if (!bounties?.length) {
        setBountyRequests([])
        setIsLoading((prev) => ({ ...prev, requests: false }))
        return
      }
      setIsLoading((prev) => ({ ...prev, requests: true }))
      const requestsPromises = bounties.map((b) => bountyRequestService.getAllWithDetails({ bountyId: b.id }))
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
    try {
      setIsLoading((prev) => ({ ...prev, myBounties: true }))
      const mine = await bountyService.getByUserId(currentUserId)
      setMyBounties(mine)
      setIsLoading((prev) => ({ ...prev, myBounties: false }))
      // Load related requests
      await loadRequestsForMyBounties(mine)
    } catch (e: any) {
      console.error('Error loading my bounties:', e)
      setError('Failed to load your bounties')
      setIsLoading((prev) => ({ ...prev, myBounties: false }))
    }
  }, [loadRequestsForMyBounties, currentUserId])

  const loadInProgress = React.useCallback(async () => {
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
        if (b && !map.has(String(b.id))) map.set(String(b.id), b)
      }
      setInProgressBounties(Array.from(map.values()))
    } catch (e: any) {
      console.error('Error loading applied bounties for In Progress:', e)
      setError('Failed to load your applied bounties')
    } finally {
      setIsLoading((prev) => ({ ...prev, inProgress: false }))
    }
  }, [currentUserId])

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
    setError(null)
    // Load in parallel
    loadMyBounties()
    loadInProgress()
  }, [postSuccess, loadMyBounties, loadInProgress]) // Re-fetch after a successful post

  // ANNOTATION: The Supabase real-time subscriptions have been removed.
  // To re-implement real-time updates, you would need to use a technology
  // like WebSockets or Server-Sent Events (SSE) with your Hostinger backend.
  // The component now fetches data when it loads or after a new bounty is posted.

  // Accept a simple object shape coming from RN TextInput onChangeText handlers
  const handleInputChange = (e: { target: { name: string; value: string } }) => {
    const { name, value } = e.target
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }))
  }

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

      // Prepare bounty data
    const bountyData: Omit<Bounty, "id" | "created_at"> & { attachments_json?: string } = {
  title: formData.title,
  description: formData.description,
  amount: formData.isForHonor ? 0 : formData.amount,
  is_for_honor: formData.isForHonor,
  location: formData.workType === 'in_person' ? formData.location : '',
  timeline: formData.timeline,
  skills_required: formData.skills,
  user_id: currentUserId, // Use authenticated user ID
  status: "open", // Ensure this matches the expected type
  work_type: formData.workType,
  is_time_sensitive: formData.isTimeSensitive,
  deadline: formData.isTimeSensitive ? formData.deadline : undefined,
  attachments_json: formData.attachments.filter(a => a.status === 'uploaded').length ? JSON.stringify(formData.attachments.filter(a => a.status === 'uploaded')) : undefined,

      }

      // Create the bounty using our service
      const bounty = await bountyService.create(bountyData)

      if (!bounty) {
        throw new Error("Failed to create bounty. The server returned an empty response.")
      }

      console.log("Bounty posted successfully:", bounty)

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

  const handleAcceptRequest = async (requestId: number) => {
    try {
      // Find the request to get bounty and profile info
      const request = bountyRequests.find(req => req.id === requestId)
      if (!request) {
        throw new Error("Request not found")
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
        throw new Error("Failed to accept request")
      }

      // Create escrow transaction for paid bounties
      if (request.bounty && !request.bounty.is_for_honor && request.bounty.amount > 0) {
        try {
          await createEscrow(
            Number(request.bounty.id),
            request.bounty.amount,
            request.bounty.title,
            currentUserId
          )
          console.log('✅ Escrow created for bounty:', request.bounty.id)
        } catch (escrowError) {
          console.error('Error creating escrow:', escrowError)
          Alert.alert(
            'Escrow Creation Failed',
            'Failed to create escrow transaction. The request has been accepted but funds were not secured. Please contact support.',
            [{ text: 'OK' }]
          )
        }
      }

      // Auto-create a conversation for coordination
      try {
        const { messageService } = await import('lib/services/message-service')
        const conversation = await messageService.getOrCreateConversation(
          [request.user_id],
          request.profile?.username || 'Hunter',
          request.bounty?.id?.toString()
        )
        
        // Send initial message with bounty context
        await messageService.sendMessage(
          conversation.id,
          `Welcome! You've been selected for: "${request.bounty?.title}". Let's coordinate the details.`,
          currentUserId
        )

        console.log('✅ Conversation created for accepted request:', conversation.id)
      } catch (convError) {
        console.error('Error creating conversation:', convError)
        // Don't fail the whole operation if conversation creation fails
      }

      // Update local state
      setBountyRequests((prev) => prev.map((req) => (req.id === requestId ? { ...req, status: "accepted" } : req)))

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
  }

  const handleRejectRequest = async (requestId: number) => {
    try {
      const rejectedRequest = await bountyRequestService.rejectRequest(requestId)

      if (!rejectedRequest) {
        throw new Error("Failed to reject request")
      }

      // Update local state
      setBountyRequests((prev) => prev.map((req) => (req.id === requestId ? { ...req, status: "rejected" } : req)))
    } catch (err: any) {
      console.error("Error rejecting request:", err)
      setError(err.message || "Failed to reject request")
    }
  }

  const handleEditBounty = (bounty: Bounty) => {
    setEditingBounty(bounty)
    setShowEditModal(true)
  }

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

  const handleDeleteBounty = (bounty: Bounty) => {
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
              // Optimistic update
              setMyBounties((prev) => prev.filter((b) => b.id !== bounty.id))

              // API call
              const success = await bountyService.delete(bounty.id)

              if (!success) {
                throw new Error("Failed to delete bounty")
              }

              // Refresh to ensure consistency
              await loadMyBounties()
            } catch (err: any) {
              // Rollback on error
              setMyBounties((prev) => [...prev, bounty])
              setError(err.message || "Failed to delete posting")
            }
          },
        },
      ],
      { cancelable: true }
    )
  }

  if (showArchivedBounties) {
    return <ArchivedBountiesScreen onBack={() => setShowArchivedBounties(false)} />
  }

  if (showAddBountyAmount) {
    return (
      <AddBountyAmountScreen
        onBack={() => setShowAddBountyAmount(false)}
        onAddAmount={handleAddBountyAmount}
        initialAmount={formData.amount}
      />
    )
  }
  if (showAddMoney) {
    return <AddMoneyScreen onBack={() => setShowAddMoney(false)} onAddMoney={(amt: number)=>{ deposit(amt); setShowAddMoney(false) }} />
  }
  // Local row component to encapsulate expansion state per item
  const MyPostingRow: React.FC<{ bounty: Bounty; currentUserId?: string; expanded: boolean; onToggle: () => void; onEdit?: () => void; onDelete?: () => void; onGoToReview: (id: string) => void; onGoToPayout: (id: string) => void; variant?: 'owner' | 'hunter' }> = ({ bounty, currentUserId, expanded, onToggle, onEdit, onDelete, onGoToReview, onGoToPayout, variant }) => {
    return (
      <MyPostingExpandable
        bounty={bounty}
        currentUserId={currentUserId}
        expanded={expanded}
        onToggle={onToggle}
        onEdit={onEdit}
        onDelete={onDelete}
        onGoToReview={onGoToReview}
        onGoToPayout={onGoToPayout}
        variant={variant}
      />
    )
  }


  // Using shared MyPostingExpandable for consistent look-and-feel; no extra helpers needed here

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
            {/* Left: icon + title aligned like messenger (no back icon) */}
            <View className="flex-row items-center gap-2">
              <MaterialIcons 
                name="gps-fixed" 
                size={24} 
                color="#ffffff" 
                accessibilityElementsHidden={true}
              />
              <Text 
                className="text-lg font-bold tracking-wider text-white"
                accessibilityRole="header"
              >
                BOUNTY
              </Text>
            </View>

            {/* Right: $40 placeholder and bookmark below it */}
            <View className="flex items-end">
              <Text 
                className="text-white font-medium"
                accessibilityLabel={`Account balance: $${balance.toFixed(2)}`}
              >
                $ {balance.toFixed(2)}
              </Text>
              <TouchableOpacity 
                className="mt-1 text-white p-2 touch-target-min" 
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
            <Text className="text-white text-xl font-bold tracking-wide uppercase text-center w-full">
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
            <View className="mx-4 mb-4 p-3 bg-red-500/70 rounded-lg text-white text-sm">
              {error}
              <TouchableOpacity className="float-right text-white p-2 touch-target-min" onPress={() => setError(null)}>
                ✕
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
                  data={inProgressBounties.filter(b => workTypeFilter==='all' || b.work_type === workTypeFilter)}
                  keyExtractor={(item) => item.id.toString()}
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
                  renderItem={({ item: bounty }) => (
                    <MyPostingRow
                      bounty={bounty}
                      currentUserId={currentUserId}
                      expanded={!!expandedMap[String(bounty.id)]}
                      onToggle={() => setExpandedMap((prev) => ({ ...prev, [String(bounty.id)]: !prev[String(bounty.id)] }))}
                      // For hunter view, route to hunter-specific flows when applicable
                      onGoToReview={(id: string) => router.push({ pathname: '/in-progress/[bountyId]/hunter/review-and-verify', params: { bountyId: id } })}
                      onGoToPayout={(id: string) => router.push({ pathname: '/in-progress/[bountyId]/hunter/payout', params: { bountyId: id } })}
                      variant={'hunter'}
                    />
                  )}
                  ListEmptyComponent={
                    isLoading.inProgress ? (
                      <View className="flex justify-center items-center py-10"><ActivityIndicator size="large" color="white" /></View>
                    ) : (
                      <View className="text-center py-10 text-emerald-200"><Text>No applied bounties yet</Text></View>
                    )
                  }
                  contentContainerStyle={{ paddingBottom: BOTTOM_NAV_OFFSET + Math.max(insets.bottom, 12) + 16 }}
                  showsVerticalScrollIndicator={false}
                  onScroll={(e) => {
                    const y = e.nativeEvent.contentOffset.y || 0
                    if (y > 2 && !showShadow) setShowShadow(true)
                    else if (y <= 2 && showShadow) setShowShadow(false)
                  }}
                  scrollEventThrottle={16}
                />
              ) : activeTab === "requests" ? (
                <FlatList
                  data={bountyRequests}
                  keyExtractor={(item) => item.id.toString()}
                  renderItem={({ item: request }) => (
                    <ApplicantCard
                      request={request}
                      onAccept={handleAcceptRequest}
                      onReject={handleRejectRequest}
                      onRequestMoreInfo={(requestId) => {
                        // Open conversation to request more info
                        console.log('Request more info for:', requestId)
                        setActiveScreen('create')
                      }}
                    />
                  )}
                  ListEmptyComponent={
                    isLoading.requests ? (
                      <View className="flex justify-center items-center py-10"><ActivityIndicator size="large" color="white" /></View>
                    ) : (
                      <View className="text-center py-10 text-emerald-2 00"><Text>No bounty requests</Text></View>
                    )
                  }
                  contentContainerStyle={{ paddingBottom: BOTTOM_NAV_OFFSET + Math.max(insets.bottom, 12) + 16 }}
                  showsVerticalScrollIndicator={false}
                  onScroll={(e) => {
                    const y = e.nativeEvent.contentOffset.y || 0
                    if (y > 2 && !showShadow) setShowShadow(true)
                    else if (y <= 2 && showShadow) setShowShadow(false)
                  }}
                  scrollEventThrottle={16}
                />
              ) : activeTab === "myPostings" ? (
                <FlatList
                  data={myBounties.filter(b => workTypeFilter==='all' || b.work_type === workTypeFilter)}
                  keyExtractor={(item) => item.id.toString()}
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
                  renderItem={({ item: bounty }) => (
                    <MyPostingRow
                      bounty={bounty}
                      currentUserId={currentUserId}
                      expanded={!!expandedMap[String(bounty.id)]}
                      onToggle={() => setExpandedMap((prev) => ({ ...prev, [String(bounty.id)]: !prev[String(bounty.id)] }))}
                      onEdit={() => handleEditBounty(bounty)}
                      onDelete={() => handleDeleteBounty(bounty)}
                      onGoToReview={(id: string) => router.push({ pathname: '/postings/[bountyId]/review-and-verify', params: { bountyId: id } })}
                      onGoToPayout={(id: string) => router.push({ pathname: '/postings/[bountyId]/payout', params: { bountyId: id } })}
                      variant={'owner'}
                    />
                  )}
                  ListEmptyComponent={
                    isLoading.myBounties ? (
                      <View className="flex justify-center items-center py-10"><ActivityIndicator size="large" color="white" /></View>
                    ) : (
                      <View className="text-center py-10 text-emerald-200">
                        <Text>You haven't posted any bounties yet</Text>
                        <TouchableOpacity onPress={() => setActiveTab('new')} className="mt-4 px-6 py-3 bg-emerald-500 rounded-lg text-white text-base touch-target-min">
                          <Text className="text-white text-base">Create Your First Bounty</Text>
                        </TouchableOpacity>
                      </View>
                    )
                  }
                  contentContainerStyle={{ paddingBottom: BOTTOM_NAV_OFFSET + Math.max(insets.bottom, 12) + 16 }}
                  showsVerticalScrollIndicator={false}
                  onScroll={(e) => {
                    const y = e.nativeEvent.contentOffset.y || 0
                    if (y > 2 && !showShadow) setShowShadow(true)
                    else if (y <= 2 && showShadow) setShowShadow(false)
                  }}
                  scrollEventThrottle={16}
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
