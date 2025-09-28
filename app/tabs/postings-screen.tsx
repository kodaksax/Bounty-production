"use client"

import { MaterialIcons } from "@expo/vector-icons"
// DateTimePicker removed from inline usage; dedicated screen handles picking
import { BinaryToggle } from 'components/ui/binary-toggle'
import { attachmentService } from 'lib/services/attachment-service'
import type { BountyRequestWithDetails } from "lib/services/bounty-request-service"
import { bountyRequestService } from "lib/services/bounty-request-service"
import { bountyService } from "lib/services/bounty-service"
import type { Bounty } from "lib/services/database.types"
import { cn } from "lib/utils"
import { CURRENT_USER_ID } from "lib/utils/data-utils"
import * as React from "react"
import { useEffect, useRef, useState } from "react"
import { ActivityIndicator, Keyboard, ScrollView, Text, TextInput, TouchableOpacity, TouchableWithoutFeedback, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { AddBountyAmountScreen } from "../../components/add-bounty-amount-screen"
import { AddMoneyScreen } from "../../components/add-money-screen"
import { ArchivedBountiesScreen } from "../../components/archived-bounties-screen"
import { BountyConfirmationCard } from "../../components/bounty-confirmation-card"
import { BountyRequestItem } from "../../components/bounty-request-item"
import { InProgressBountyItem } from "../../components/in-progress-bounty-item"
import { useWallet } from '../../lib/wallet-context'

// Removed unused StyleSheet (styles) to satisfy eslint no-unused-vars



interface PostingsScreenProps {
  onBack?: () => void
  activeScreen: string
  setActiveScreen: (screen: string) => void
}

export function PostingsScreen({ onBack, activeScreen, setActiveScreen }: PostingsScreenProps) {
  const [activeTab, setActiveTab] = useState("new")
  const [showArchivedBounties, setShowArchivedBounties] = useState(false)
  const [showAddBountyAmount, setShowAddBountyAmount] = useState(false)
  const [showConfirmationCard, setShowConfirmationCard] = useState(false)
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
  const { balance, deposit } = useWallet()
  const [showAddMoney, setShowAddMoney] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [workTypeFilter, setWorkTypeFilter] = useState<'all' | 'online' | 'in_person'>('all')
  // Deadline now simple text entry; dedicated screen removed

  // Navigate to amount screen (replaces sticky bottom amount selection)
  const handleProceedToAmount = () => {
    // Validate basic required fields first
    const baseMissing = !formData.title || !formData.description
    const locationMissing = formData.workType === 'in_person' && !formData.location
    
    if (baseMissing || locationMissing) {
      let msg = 'Please complete required fields:'
      if (baseMissing) msg += ' Title, Description;'
      if (locationMissing) msg += ' Location;'
      setValidationError(msg.trim())
      return
    }
    
    setValidationError(null)
    setShowAddBountyAmount(true)
  }

  const tabs = [
    { id: "new", label: "New" },
    { id: "inProgress", label: "In Progress" },
    { id: "myPostings", label: "My Postings" },
    { id: "requests", label: "Requests" },
  ]

  // Fetch data from the API
  useEffect(() => {
    const fetchData = async () => {
      setError(null)

      try {
        // Fetch my bounties
        setIsLoading((prev) => ({ ...prev, myBounties: true }))
        const myBountiesData = await bountyService.getByUserId(CURRENT_USER_ID)
        setMyBounties(myBountiesData)
        setIsLoading((prev) => ({ ...prev, myBounties: false }))

        // Fetch bounty requests for the bounties I own
        if (myBountiesData.length > 0) {
          setIsLoading((prev) => ({ ...prev, requests: true }))
          // ANNOTATION: This fetches requests for each of your bounties.
          // For performance, your API could support fetching all requests for a given owner ID in one call.
          // e.g., GET /api/bounty-requests?bountyOwnerId=${CURRENT_USER_ID}
          const requestsPromises = myBountiesData.map((b) => bountyRequestService.getAllWithDetails({ bountyId: b.id }))
          const requestsArrays = await Promise.all(requestsPromises)
          const allRequests = requestsArrays.flat()
          setBountyRequests(allRequests)
          setIsLoading((prev) => ({ ...prev, requests: false }))
        } else {
          setBountyRequests([])
          setIsLoading((prev) => ({ ...prev, requests: false }))
        }
      } catch (err: any) {
        console.error("Error fetching my bounties:", err)
        setError("Failed to load your bounties")
        setIsLoading((prev) => ({ ...prev, myBounties: false }))
      }

      try {
        // Fetch in-progress bounties
        setIsLoading((prev) => ({ ...prev, inProgress: true }))
        // ANNOTATION: This fetches all in-progress bounties.
        // If this should only be bounties assigned to the current user,
        // your API will need to support that query.
        const inProgressData = await bountyService.getAll({ status: "in_progress" })
        setInProgressBounties(inProgressData)
      } catch (err: any) {
        console.error("Error fetching in-progress bounties:", err)
        setError("Failed to load in-progress bounties")
      } finally {
        setIsLoading((prev) => ({ ...prev, inProgress: false }))
      }
    }

    fetchData()
  }, [postSuccess]) // Re-fetch after a successful post

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
  }

  // Navigate from amount screen to confirmation
  const handleProceedToConfirmation = () => {
    setShowAddBountyAmount(false)
    
    // Final validation including deadline if time sensitive
    const deadlineMissing = formData.isTimeSensitive && !formData.deadline
    if (deadlineMissing) {
      setValidationError('Enter a deadline to mark this as time sensitive.')
      return
    }
    
    setValidationError(null)
    setShowConfirmationCard(true)
  }

  // Show confirmation card instead of directly posting
  const handleShowConfirmation = () => {
    setShowConfirmationCard(true)
  }

  // Handle the actual bounty posting after confirmation
  const handlePostBounty = async () => {
    try {
      setIsSubmitting(true)
      setError(null)

      // Check balance before proceeding
      const lowBalance = !formData.isForHonor && formData.amount > balance
      if (lowBalance) {
        setShowConfirmationCard(false)
        setShowAddMoney(true)
        setIsSubmitting(false)
        return
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
  user_id: CURRENT_USER_ID, // Make sure this is set correctly from your auth state
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

        // Switch to My Postings tab AFTER updating state
        setTimeout(() => {
          setActiveTab("myPostings")
        }, 100)

        // Reset success state after a delay
        setTimeout(() => {
          setPostSuccess(false)
        }, 3000)
      }
    } catch (err: any) {
      console.error("Error posting bounty:", err)
      setError(err.message || "Failed to post bounty")
      setShowConfirmationCard(false)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleAcceptRequest = async (requestId: number) => {
    try {
      // ANNOTATION: This API call should be transactional on your backend.
      const result = await bountyRequestService.acceptRequest(requestId)

      if (!result || !result.request) {
        throw new Error("Failed to accept request")
      }

      // Update local state
      setBountyRequests((prev) => prev.map((req) => (req.id === requestId ? { ...req, status: "accepted" } : req)))
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

  if (showArchivedBounties) {
    return <ArchivedBountiesScreen onBack={() => setShowArchivedBounties(false)} />
  }

  if (showAddBountyAmount) {
    return (
      <AddBountyAmountScreen
        onBack={() => setShowAddBountyAmount(false)}
        onAddAmount={handleAddBountyAmount}
        onProceedToConfirmation={handleProceedToConfirmation}
        initialAmount={formData.amount}
        showProceedButton={true}
      />
    )
  }
  if (showAddMoney) {
    return <AddMoneyScreen onBack={() => setShowAddMoney(false)} onAddMoney={(amt: number)=>{ deposit(amt); setShowAddMoney(false) }} />
  }

  // Calculate distance (mock function - in a real app, this would use geolocation)
  const calculateDistance = (location: string) => {
    // Simple mock distance calculation
    return Math.floor(Math.random() * 20) + 1
  }

  // Format timestamp to relative time
  const formatTimeAgo = (timestamp: string) => {
    const date = new Date(timestamp)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffHrs = Math.floor(diffMs / (1000 * 60 * 60))

    if (diffHrs < 1) return "Just now"
    if (diffHrs < 24) return `${diffHrs}h AGO`
    return `${Math.floor(diffHrs / 24)}d AGO`
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
            {/* Left: icon + title aligned like messenger (no back icon) */}
            <View className="flex-row items-center gap-3">
              <MaterialIcons name="gps-fixed" size={24} color="#000000" />
              <Text className="text-lg font-bold tracking-wider text-white">BOUNTY</Text>
            </View>

            {/* Right: $40 placeholder and bookmark below it */}
            <View className="flex items-end">
              <Text className="text-white font-medium">$ {balance.toFixed(2)}</Text>
              <TouchableOpacity className="mt-1 text-white p-2 touch-target-min" onPress={() => setShowArchivedBounties(true)}>
                <MaterialIcons name="bookmark" size={20} color="#ffffff" />
              </TouchableOpacity>
            </View>
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


          {/* Tabs - Scrollable for iPhone */}
          <View className="px-4 mb-3 bg-emerald-600">
            <View className="flex space-x-6 overflow-x-auto ios-scroll no-scrollbar">
              {tabs.map((tab) => (
                <TouchableOpacity
                  key={tab.id}
                  onPress={() => setActiveTab(tab.id)}
                  className={cn(
                    "py-2 px-1 text-base font-medium transition-colors whitespace-nowrap touch-target-min",
                    activeTab === tab.id ? "text-white border-b-2 border-white" : "text-emerald-200/70",
                  )}
                >
                  <Text className={cn(
                    "text-base font-medium",
                    activeTab === tab.id ? "text-white" : "text-emerald-200/70",
                  )}>
                    {tab.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>

  {/* Scrollable Content Area - starts under visible bottom of header */}
  <View className="flex-1" style={{ paddingTop: Math.max(0, headerHeight - HEADER_TOP_OFFSET) }}>
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
              // 2) Make the wrapper fill space and let the ScrollView expand
              <View className="flex-1">
                <ScrollView
                  keyboardShouldPersistTaps="handled"
                  keyboardDismissMode="on-drag"
                  className="flex-1 px-2"
                  // 3) Ensure the last inputs won’t be hidden by the sticky bar
                  contentContainerStyle={{
                    paddingBottom: insets.bottom + (BOTTOM_ACTIONS_HEIGHT + STICKY_BOTTOM_EXTRA) + 12,
                  }}
                  onScroll={(e) => {
                    const y = e.nativeEvent.contentOffset.y || 0
                    if (y > 2 && !showShadow) setShowShadow(true)
                    else if (y <= 2 && showShadow) setShowShadow(false)
                  }}
                  scrollEventThrottle={16}
                  showsVerticalScrollIndicator={false}
                >
                  <View className="space-y-4">
                    {/* Progress Indicator */}
                    <View className="bg-emerald-700/30 rounded-lg p-4 mb-2">
                      <View className="flex-row items-center justify-between">
                        <Text className="text-emerald-200 text-sm">Step 1 of 2: Basic Details</Text>
                        <View className="flex-row space-x-2">
                          <View className="w-2 h-2 rounded-full bg-emerald-400"></View>
                          <View className="w-2 h-2 rounded-full bg-emerald-700"></View>
                        </View>
                      </View>
                    </View>

                    <View className="space-y-3">
                    <Text className="text-emerald-100/90 text-base">Title</Text>
                    <TextInput
                      value={formData.title}
                      onChangeText={(text) => handleInputChange({ target: { name: 'title', value: text } })}
                      placeholder="A brief description of the job you need done"
                      className="w-full bg-emerald-700/50 rounded-lg p-4 text-white border-none focus:ring-1 focus:ring-white text-base touch-target-min"
                      placeholderTextColor="#6ee7b7"
                    />
                  </View>

                  <View className="space-y-3">
                    <Text className="text-emerald-100/90 text-base">Bounty description</Text>
                    <TextInput
                      value={formData.description}
                      onChangeText={(text) => handleInputChange({ target: { name: 'description', value: text } })}
                      placeholder="This is the long form description of the task and this can be anything from commissioning an art design to having something delivered to hunting down your fathers killer"
                      className="w-full bg-emerald-700/50 rounded-lg p-4 text-white border-none focus:ring-1 focus:ring-white text-base min-h-[150px] touch-target-min"
                      placeholderTextColor="#6ee7b7"
                      multiline
                      numberOfLines={6}
                    />
                  </View>

                  {/* Work Type Toggle */}
                  <View className="space-y-3">
                    <Text className="text-emerald-100/90 text-base">Work Type</Text>
                    <BinaryToggle
                      value={formData.workType}
                      onChange={(v) => setFormData(prev => ({ ...prev, workType: v }))}
                      options={[
                        { id: 'online', label: 'Online' },
                        { id: 'in_person', label: 'In Person' },
                      ] as const}
                    />
                  </View>

                  {formData.workType === 'in_person' && (
                    <View className="space-y-3">
                      <View className="flex-row items-center justify-between">
                        <Text className="text-emerald-100/90 text-base">Location <Text className="text-red-300">*</Text></Text>
                        <Text className="text-xs text-emerald-300">Required for in-person</Text>
                      </View>
                      <TextInput
                        value={formData.location}
                        onChangeText={(text) => handleInputChange({ target: { name: 'location', value: text } })}
                        placeholder="Where will this task occur?"
                        className="w-full bg-emerald-700/50 rounded-lg p-4 text-white border-none focus:ring-1 focus:ring-white text-base touch-target-min"
                        placeholderTextColor="#6ee7b7"
                      />
                    </View>
                  )}

                  {/* Bounty Amount moved to sticky bottom action bar */}

                  <View className="space-y-3">
                    <Text className="text-emerald-100/90 text-base">Timeline</Text>
                    <TextInput
                      value={formData.timeline}
                      onChangeText={(text) => handleInputChange({ target: { name: 'timeline', value: text } })}
                      placeholder="When does this need to be completed by?"
                      className="w-full bg-emerald-700/50 rounded-lg p-4 text-white border-none focus:ring-1 focus:ring-white text-base touch-target-min"
                      placeholderTextColor="#6ee7b7"
                    />
                  </View>

                  <View className="space-y-3">

                    <Text className="text-emerald-100/90 text-base">Skills Required</Text>
                    <TextInput
                      value={formData.skills}
                      onChangeText={(text) => handleInputChange({ target: { name: 'skills', value: text } })}
                      placeholder="What skills are needed for this bounty?"
                      className="w-full bg-emerald-700/50 rounded-lg p-4 text-white border-none focus:ring-1 focus:ring-white text-base touch-target-min"
                      placeholderTextColor="#6ee7b7"
                    />
                  </View>

                  {/* Time Sensitive Toggle */}
                  <View className="space-y-3">
                    <Text className="text-emerald-100/90 text-base">Is the bounty time sensitive?</Text>
                    <BinaryToggle
                      value={formData.isTimeSensitive ? 'yes' : 'no'}
                      onChange={(v) => {
                        if (v === 'yes') {
                          setFormData(prev => ({ ...prev, isTimeSensitive: true }))
                        } else {
                          setFormData(prev => ({ ...prev, isTimeSensitive: false, deadline: '' }))
                        }
                      }}
                      options={[
                        { id: 'no', label: 'No' },
                        { id: 'yes', label: 'Yes' },
                      ] as const}
                      className="max-w-[200px]"
                    />
                    {formData.isTimeSensitive && (
                      <View className="mt-2 bg-emerald-900/40 border border-emerald-600/60 rounded-lg p-3">
                        <Text className="text-emerald-200 text-xs leading-5">
                          Time sensitive bounties show an urgency badge and may be prioritized in feeds. Make sure the
                          deadline is realistic. Hunters will see a countdown so choose carefully.
                        </Text>
                      </View>
                    )}
                  </View>

                  {formData.isTimeSensitive && (
                    <View className="space-y-3">
                      <View className="flex-row items-center justify-between mb-1">
                        <Text className="text-emerald-100/90 text-base">Deadline <Text className="text-red-300">*</Text></Text>
                        {formData.deadline ? (
                          <View className="bg-red-500/20 px-2 py-0.5 rounded-full border border-red-400/30">
                            <Text className="text-red-300 text-[10px] font-semibold tracking-wide">URGENCY</Text>
                          </View>
                        ) : null}
                      </View>
                      <TextInput
                        value={formData.deadline}
                        onChangeText={(text) => setFormData(prev => ({ ...prev, deadline: text }))}
                        placeholder="e.g. 2025-10-12 5:00 PM or 'End of week'"
                        className="w-full bg-emerald-700/50 rounded-lg p-4 text-white border-none focus:ring-1 focus:ring-white text-base"
                        placeholderTextColor="#6ee7b7"
                      />
                    </View>
                  )}

                  {/* Attachments */}
                  <View className="space-y-3 mb-4">
                    <Text className="text-emerald-100/90 text-base">Attachments</Text>
                    <TouchableOpacity
                      onPress={async () => {
                        try {
                          const picker = await import('expo-document-picker')
                          const result = await picker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true, type: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/*'] })
                          if (result.assets && result.assets.length) {
                            const mapped = result.assets.map(a => ({
                              id: (a.uri + a.name + a.size).replace(/[^a-zA-Z0-9]/g,'').slice(0,24) || Math.random().toString(36).slice(2),
                              name: a.name || 'file',
                              uri: a.uri,
                              mimeType: a.mimeType,
                              size: a.size,
                              status: 'pending' as const,
                              progress: 0,
                            }))
                            setFormData(prev => ({ ...prev, attachments: [...prev.attachments, ...mapped] }))
                            for (const att of mapped) {
                              setFormData(prev => ({ ...prev, attachments: prev.attachments.map(a => a.id === att.id ? { ...a, status: 'uploading', progress: 0 } : a) }))
                              try {
                                const uploaded = await attachmentService.upload(att, { onProgress: (p) => {
                                  setFormData(prev => ({ ...prev, attachments: prev.attachments.map(a => a.id === att.id ? { ...a, progress: p } : a) }))
                                } })
                                setFormData(prev => ({ ...prev, attachments: prev.attachments.map(a => a.id === att.id ? { ...a, ...uploaded } : a) }))
                              } catch (e) {
                                setFormData(prev => ({ ...prev, attachments: prev.attachments.map(a => a.id === att.id ? { ...a, status: 'failed' } : a) }))
                              }
                            }
                          }
                        } catch (e) {
                          console.warn('Attachment pick failed', e)
                        }
                      }}
                      className="px-4 py-3 rounded-lg border border-emerald-500/40 bg-emerald-800/40"
                    >
                      <Text className="text-emerald-100">Add File</Text>
                    </TouchableOpacity>
                    {formData.attachments.length > 0 && (
                      <View className="space-y-2">
                        {formData.attachments.map(att => (
                          <View key={att.id} className="flex-row items-center gap-2 bg-emerald-900/40 rounded-md px-3 py-2">
                            <View className="flex-1">
                              <Text className="text-emerald-100 text-sm" numberOfLines={1}>{att.name}</Text>
                              <View className="h-1 bg-emerald-800 rounded mt-1 overflow-hidden">
                                <View style={{ width: `${Math.round((att.progress || (att.status==='uploaded'?1:0))*100)}%` }} className={cn('h-full', att.status==='failed' ? 'bg-red-400' : 'bg-emerald-400')} />
                              </View>
                              <Text className="text-[10px] text-emerald-300 mt-0.5">{att.status === 'uploaded' ? 'Uploaded' : att.status === 'failed' ? 'Failed' : att.status === 'uploading' ? `Uploading ${(Math.round((att.progress||0)*100))}%` : 'Pending'}</Text>
                            </View>
                            {att.status !== 'uploading' && (
                              <TouchableOpacity onPress={() => setFormData(prev => ({ ...prev, attachments: prev.attachments.filter(a => a.id !== att.id) }))}>
                                <Text className="text-red-300 text-xs px-2">Remove</Text>
                              </TouchableOpacity>
                            )}
                          </View>
                        ))}
                      </View>
                    )}
                  </View>
                  </View>
                </ScrollView>
              </View>
            ) : (
              activeTab === "inProgress" ? (
                <View className="space-y-3">
                  {/* Work Type Filter */}
                  <View className="flex-row gap-2 mb-1">
                    {(['all','online','in_person'] as const).map(f => {
                      const label = f === 'all' ? 'All' : f === 'online' ? 'Online' : 'In Person'
                      const selected = workTypeFilter === f
                      return (
                        <TouchableOpacity key={f} onPress={() => setWorkTypeFilter(f)} className={cn('px-3 py-1.5 rounded-full border', selected ? 'bg-emerald-400/30 border-emerald-300' : 'bg-emerald-800/40 border-emerald-600')}>
                          <Text className={cn('text-xs', selected ? 'text-white font-medium' : 'text-emerald-200')}>{label}</Text>
                        </TouchableOpacity>
                      )
                    })}
                  </View>
                  {isLoading.inProgress ? (
                    <View className="flex justify-center items-center py-10">
                      <ActivityIndicator size="large" color="white" />
                    </View>
                  ) : inProgressBounties.filter(b => workTypeFilter==='all' || b.work_type === workTypeFilter).length === 0 ? (
                    <View className="text-center py-10 text-emerald-200">
                      <Text>No bounties in progress</Text>
                    </View>
                  ) : (
                    inProgressBounties.filter(b => workTypeFilter==='all' || b.work_type === workTypeFilter).map((bounty) => (
                      <InProgressBountyItem
                        key={bounty.id}
                        username={bounty.user_id === CURRENT_USER_ID ? "@Jon_Doe" : "@User"}
                        title={bounty.title}
                        amount={Number(bounty.amount)}
                        distance={calculateDistance(bounty.location || "")}
                        timeAgo={formatTimeAgo(bounty.created_at)}
                        workType={bounty.work_type}
                      />
                    ))
                  )}
                </View>
              ) : activeTab === "requests" ? (
                <View className="space-y-3">
                  {isLoading.requests ? (
                    <View className="flex justify-center items-center py-10">
                      <ActivityIndicator size="large" color="white" />
                    </View>
                  ) : bountyRequests.length === 0 ? (
                    <View className="text-center py-10 text-emerald-200">
                      <Text>No bounty requests</Text>
                    </View>
                  ) : (
                    bountyRequests.map((request) =>
                        <BountyRequestItem
                          key={request.id}
                          username={request.profile.username}
                          title={request.bounty.title}
                          amount={Number(request.bounty.amount)}
                          distance={calculateDistance(request.bounty.location || "")}
                          timeAgo={formatTimeAgo(request.created_at)}
                          avatarSrc={request.profile.avatar_url || undefined}
                          onMenuClick={() => console.log(`Menu clicked for request ${request.id}`)}
                          onAccept={() => handleAcceptRequest(request.id)}
                          onReject={() => handleRejectRequest(request.id)}
                          status={request.status}
                          workType={request.bounty.work_type}
                          deadline={request.bounty.deadline}
                        />
                    )
                  )}
                </View>
              ) : activeTab === "myPostings" ? (
                <View className="space-y-3">
                  {/* Work Type Filter */}
                  <View className="flex-row gap-2 mb-1">
                    {(['all','online','in_person'] as const).map(f => {
                      const label = f === 'all' ? 'All' : f === 'online' ? 'Online' : 'In Person'
                      const selected = workTypeFilter === f
                      return (
                        <TouchableOpacity key={f} onPress={() => setWorkTypeFilter(f)} className={cn('px-3 py-1.5 rounded-full border', selected ? 'bg-emerald-400/30 border-emerald-300' : 'bg-emerald-800/40 border-emerald-600')}>
                          <Text className={cn('text-xs', selected ? 'text-white font-medium' : 'text-emerald-200')}>{label}</Text>
                        </TouchableOpacity>
                      )
                    })}
                  </View>
                  {isLoading.myBounties ? (
                    <View className="flex justify-center items-center py-10">
                      <ActivityIndicator size="large" color="white" />
                    </View>
                  ) : myBounties.filter(b => workTypeFilter==='all' || b.work_type === workTypeFilter).length === 0 ? (
                    <View className="text-center py-10 text-emerald-200">
                      <Text>You haven't posted any bounties yet</Text>
                      <TouchableOpacity
                        onPress={() => setActiveTab("new")}
                        className="mt-4 px-6 py-3 bg-emerald-500 rounded-lg text-white text-base touch-target-min"
                      >
                        <Text className="text-white text-base">Create Your First Bounty</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    myBounties.filter(b => workTypeFilter==='all' || b.work_type === workTypeFilter).map((bounty) => (
                      <View
                        key={bounty.id}
                        className="bg-emerald-800/50 backdrop-blur-sm rounded-lg overflow-hidden mb-3 shadow-md"
                      >
                        <View className="p-4">
                          <View className="flex justify-between items-center mb-2">
                            <Text className="text-base font-medium text-emerald-100">
                              Bounty #{bounty.id}
                              {bounty.status !== "open" && (
                                <Text className="ml-2 px-2 py-0.5 bg-emerald-700 rounded-full text-xs">
                                  {bounty.status}
                                </Text>
                              )}
                              {bounty.work_type && (
                                <Text className="ml-2 px-2 py-0.5 bg-emerald-900/70 rounded-full text-xs text-emerald-300">
                                  {bounty.work_type === 'online' ? 'Online' : 'In Person'}
                                </Text>
                              )}
                            </Text>
                            <Text className="text-sm text-emerald-300">{formatTimeAgo(bounty.created_at)}</Text>
                          </View>
                          <Text className="text-white font-medium mt-0.5 text-base">{bounty.title}</Text>
                          <View className="flex justify-between items-center mt-3">
                            <View className="bg-emerald-900/50 px-3 py-1.5 rounded text-emerald-400 font-bold text-base">
                              {bounty.is_for_honor ? "For Honor" : `$${Number(bounty.amount).toLocaleString()}`}
                            </View>
                            <View className="text-base text-emerald-200">{calculateDistance(bounty.location || "")} mi</View>
                          </View>
                        </View>
                      </View>
                    ))
                  )}
                </View>
              ) : (
                <View className="flex items-center justify-center h-full">
                  <Text className="text-emerald-200 text-center">Content will appear here</Text>
                </View>
              ))}
          </View>
        </View>

        {/* Sticky Bottom Actions - Simplified "Next" button */}
        {activeTab === "new" && (
          <View
            className="absolute left-0 right-0 bottom-0 bg-emerald-600/95 border-t border-emerald-500/30"
            style={{
              paddingHorizontal: 16,
              paddingTop: 12,
              paddingBottom: insets.bottom + 8,
              minHeight: BOTTOM_ACTIONS_HEIGHT,
              bottom: -50,
            }}
          >
            {validationError && (
              <View className="mb-3 p-3 bg-red-500/70 rounded-lg">
                <Text className="text-white text-sm">{validationError}</Text>
              </View>
            )}
            
            {formData.isTimeSensitive && !formData.deadline && !validationError && (
              <View className="mb-3 p-3 bg-amber-500/20 border border-amber-400/40 rounded-lg">
                <Text className="text-amber-200 text-sm">Enter a deadline to mark this as urgent.</Text>
              </View>
            )}
            
            <TouchableOpacity
              ref={postButtonRef}
              onPress={handleProceedToAmount}
              className="w-full px-8 py-4 rounded-2xl border border-emerald-300/50 bg-emerald-700/30"
              activeOpacity={0.85}
            >
              <View className="flex-row items-center justify-center gap-2">
                <Text className="font-semibold text-white text-lg">Next</Text>
                <MaterialIcons name="arrow-forward" size={20} color="white" />
              </View>
            </TouchableOpacity>
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
    </View>
    </TouchableWithoutFeedback>
  )
}
