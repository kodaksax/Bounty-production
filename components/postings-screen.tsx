"use client"

import type React from "react"
import { View, Text, TouchableOpacity, TextInput, ScrollView } from "react-native"

import { motion } from "framer-motion"
import type { BountyRequestWithDetails } from "lib/services/bounty-request-service"
import { bountyRequestService } from "lib/services/bounty-request-service"
import { bountyService } from "lib/services/bounty-service"
import type { Bounty } from "lib/services/database.types"
import { cn } from "lib/utils"
import { CURRENT_USER_ID } from "lib/utils/data-utils"
import { ArrowLeft, Bookmark, Loader2, Share2, Target } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { View, Text, TouchableOpacity, TextInput, ScrollView } from "react-native"
import { AddBountyAmountScreen } from "./add-bounty-amount-screen"
import { ArchivedBountiesScreen } from "./archived-bounties-screen"
import { BountyConfirmationCard } from "./bounty-confirmation-card"
import { BountyRequestItem } from "./bounty-request-item"
import { InProgressBountyItem } from "./in-progress-bounty-item"

interface PostingsScreenProps {
  onBack?: () => void
}

export function PostingsScreen({ onBack }: PostingsScreenProps = {}) {
  const [activeTab, setActiveTab] = useState("new")
  const [showArchivedBounties, setShowArchivedBounties] = useState(false)
  const [showAddBountyAmount, setShowAddBountyAmount] = useState(false)
  const [showConfirmationCard, setShowConfirmationCard] = useState(false)
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    location: "",
    amount: 0,
    timeline: "",
    skills: "",
    isForHonor: false,
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
  const postButtonRef = useRef<HTMLButtonElement>(null)

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

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
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
    setShowConfirmationCard(true)
  }

  // Handle the actual bounty posting after confirmation
  const handlePostBounty = async () => {
    try {
      setIsSubmitting(true)
      setError(null)

      // Prepare bounty data
      const bountyData: Omit<Bounty, "id" | "created_at"> = {
  title: formData.title,
  description: formData.description,
  amount: formData.isForHonor ? 0 : formData.amount,
  is_for_honor: formData.isForHonor,
  location: formData.location,
  timeline: formData.timeline,
  skills_required: formData.skills,
  user_id: CURRENT_USER_ID, // Make sure this is set correctly from your auth state
  status: "open", // Ensure this matches the expected type

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
        initialAmount={formData.amount}
      />
    )
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
    <View className="flex flex-col min-h-screen bg-emerald-600">
      {/* Fixed Header - iPhone optimized with safe area inset */}
      <View className="sticky top-0 z-10 bg-emerald-600">
        {/* Header */}
        <View className="flex justify-between items-center p-4 pt-safe">
          <View className="flex items-center gap-3">
            {onBack && (
              <TouchableOpacity onPress={onBack} className="mr-1 p-2 touch-target-min">
                <ArrowLeft className="h-5 w-5 text-white" />
              </TouchableOpacity>
            )}
            <Target className="h-5 w-5 text-white" />
            <Text className="text-lg font-bold tracking-wider text-white">BOUNTY</Text>
          </View>
          <View className="flex items-center gap-4">
            <Text className="text-white font-medium">$ 40.00</Text>
          </View>
        </View>

        {/* Title and Bookmark */}
        <View className="px-4 py-2 flex justify-between items-center">
          <Text className="text-white text-xl font-bold tracking-wide uppercase text-center w-full">
            {activeTab === "inProgress"
              ? "In Progress"
              : activeTab === "requests"
                ? "Bounty Requests"
                : activeTab === "myPostings"
                  ? "My Postings"
                  : "Bounty Posting"}
          </Text>
          <TouchableOpacity className="text-white p-2 touch-target-min" onPress={() => setShowArchivedBounties(true)}>
            <Bookmark className="h-5 w-5" />
          </TouchableOpacity>
        </View>

        {/* Tabs - Scrollable for iPhone */}
        <View className="px-4 mb-4 bg-emerald-600">
          <View className="flex space-x-6 overflow-x-auto ios-scroll no-scrollbar">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onPress={() => setActiveTab(tab.id)}
                className={cn(
                  "py-2 px-1 text-base font-medium transition-colors whitespace-nowrap touch-target-min",
                  activeTab === tab.id ? "text-white border-b-2 border-white" : "text-emerald-200/70",
                )}
              >
                {tab.label}
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </View>

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
        <motion.div
          className="mx-4 mb-4 p-3 bg-emerald-500/70 rounded-lg text-white text-sm"
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
        >
          Bounty posted successfully!
        </motion.div>
      )}

      {/* Scrollable Content Area - iPhone optimized */}
      <View className="flex-1 overflow-y-auto ios-scroll pb-28">
        <View className="px-4">
          {activeTab === "inProgress" ? (
            <View className="space-y-3">
              {isLoading.inProgress ? (
                <View className="flex justify-center items-center py-10">
                  <Loader2 className="h-8 w-8 text-white animate-spin" />
                </View>
              ) : inProgressBounties.length === 0 ? (
                <View className="text-center py-10 text-emerald-200">
                  <Text>No bounties in progress</Text>
                </View>
              ) : (
                inProgressBounties.map((bounty) => (
                  <InProgressBountyItem
                    key={bounty.id}
                    username={bounty.user_id === CURRENT_USER_ID ? "@Jon_Doe" : "@User"}
                    title={bounty.title}
                    amount={Number(bounty.amount)}
                    distance={calculateDistance(bounty.location || "")}
                    timeAgo={formatTimeAgo(bounty.created_at)}
                  />
                ))
              )}
            </View>
          ) : activeTab === "requests" ? (
            <View className="space-y-3">
              {isLoading.requests ? (
                <View className="flex justify-center items-center py-10">
                  <Loader2 className="h-8 w-8 text-white animate-spin" />
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
                    />
                )
              )}
            </View>
          ) : activeTab === "new" ? (
            <View className="space-y-6">
              {/* New bounty form - iPhone optimized */}
              <View className="space-y-3">
                <label className="text-emerald-100/90 text-base block">Title</label>
                <input
                  type="text"
                  name="title"
                  value={formData.title}
                  onChange={handleInputChange}
                  placeholder="A brief description of the job you need done"
                  className="w-full bg-emerald-700/50 rounded-lg p-4 text-white placeholder:text-emerald-300 border-none focus:ring-1 focus:ring-white text-base touch-target-min"
                />
              </View>

              <View className="space-y-3">
                <label className="text-emerald-100/90 text-base block">Bounty description</label>
                <textarea
                  name="description"
                  value={formData.description}
                  onChange={handleInputChange}
                  placeholder="This is the long form description of the task and this can be anything from commissioning an art design to having something delivered to hunting down your fathers killer"
                  className="w-full bg-emerald-700/50 rounded-lg p-4 text-white placeholder:text-emerald-300 border-none focus:ring-1 focus:ring-white text-base min-h-[150px] resize-none touch-target-min"
                />
              </View>

              <View className="space-y-3">
                <label className="text-emerald-100/90 text-base block">Location</label>
                <input
                  type="text"
                  name="location"
                  value={formData.location}
                  onChange={handleInputChange}
                  placeholder="A location where the task can begin"
                  className="w-full bg-emerald-700/50 rounded-lg p-4 text-white placeholder:text-emerald-300 border-none focus:ring-1 focus:ring-white text-base touch-target-min"
                />
              </View>

              <View className="space-y-3">
                <label className="text-emerald-100/90 text-base block">Bounty Amount</label>
                <button
                  onPress={() => setShowAddBountyAmount(true)}
                  className="w-full bg-emerald-700/50 rounded-lg p-4 text-left text-white focus:ring-1 focus:ring-white text-base flex justify-between items-center touch-target-min"
                >
                  <Text>
                    {formData.isForHonor
                      ? "For Honor (No monetary reward)"
                      : formData.amount > 0
                        ? `$${formData.amount.toLocaleString()}`
                        : "Tap to set amount"}
                  </Text>
                  <Text className="text-emerald-300 text-sm">Tap to change</Text>
                </TouchableOpacity>
              </View>

              <View className="space-y-3">
                <label className="text-emerald-100/90 text-base block">Timeline</label>
                <input
                  type="text"
                  name="timeline"
                  value={formData.timeline}
                  onChange={handleInputChange}
                  placeholder="When does this need to be completed by?"
                  className="w-full bg-emerald-700/50 rounded-lg p-4 text-white placeholder:text-emerald-300 border-none focus:ring-1 focus:ring-white text-base touch-target-min"
                />
              </View>

              <View className="space-y-3">
                <label className="text-emerald-100/90 text-base block">Skills Required</label>
                <input
                  type="text"
                  name="skills"
                  value={formData.skills}
                  onChange={handleInputChange}
                  placeholder="What skills are needed for this bounty?"
                  className="w-full bg-emerald-700/50 rounded-lg p-4 text-white placeholder:text-emerald-300 border-none focus:ring-1 focus:ring-white text-base touch-target-min"
                />
              </View>
            </View>
          ) : activeTab === "myPostings" ? (
            <View className="space-y-3">
              {isLoading.myBounties ? (
                <View className="flex justify-center items-center py-10">
                  <Loader2 className="h-8 w-8 text-white animate-spin" />
                </View>
              ) : myBounties.length === 0 ? (
                <View className="text-center py-10 text-emerald-200">
                  <Text>You haven't posted any bounties yet</Text>
                  <button
                    onPress={() => setActiveTab("new")}
                    className="mt-4 px-6 py-3 bg-emerald-500 rounded-lg text-white text-base touch-target-min"
                  >
                    Create Your First Bounty
                  </TouchableOpacity>
                </View>
              ) : (
                myBounties.map((bounty) => (
                  <div
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
          )}
        </View>
      </View>

      {/* Sticky Bottom Actions - iPhone optimized with safe area inset */}
      {activeTab === "new" && (
        <View className="fixed bottom-16 left-0 right-0 p-4 flex justify-between items-center bg-emerald-600 border-t border-emerald-500/30 pb-safe">
          <TouchableOpacity className="rounded-full p-3 bg-emerald-700/50 touch-target-min">
            <Share2 className="h-6 w-6 text-white" />
          </TouchableOpacity>
          <motion.button
            ref={postButtonRef}
            onPress={handleShowConfirmation}
            disabled={
              isSubmitting || !formData.title || !formData.description || (!formData.amount && !formData.isForHonor)
            }
            className={cn(
              "px-8 py-3 rounded-full text-white font-medium shadow-lg flex items-center touch-target-min",
              formData.title && formData.description && (formData.amount > 0 || formData.isForHonor) && !isSubmitting
                ? "bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600"
                : "bg-emerald-500/50 cursor-not-allowed",
            )}
            whileTap={{ scale: 0.95 }}
            whileHover={{ scale: 1.02 }}
            initial={{ scale: 1 }}
            animate={
              postSuccess
                ? {
                    scale: [1, 1.1, 1],
                    transition: {
                      duration: 0.5,
                      times: [0, 0.5, 1],
                      ease: "easeInOut",
                    },
                  }
                : { scale: 1 }
            }
          >
            {isSubmitting && <Loader2 className="h-5 w-5 mr-2 animate-spin" />}
            Post Bounty
          </motion.button>
        </View>
      )}

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
            }}
            onConfirm={handlePostBounty}
            onCancel={() => setShowConfirmationCard(false)}
          />
        </View>
      )}
    </View>
  )
}
