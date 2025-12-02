import { MaterialIcons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { bountyService } from 'lib/services/bounty-service'
import { cancellationService } from 'lib/services/cancellation-service'
import { completionService } from 'lib/services/completion-service'
import type { Bounty } from 'lib/services/database.types'
import { disputeService } from 'lib/services/dispute-service'
import { messageService } from 'lib/services/message-service'
import { staleBountyService } from 'lib/services/stale-bounty-service'
import type { Attachment, Conversation } from 'lib/types'
import React, { useEffect, useMemo, useState } from 'react'
import {
    ActivityIndicator,
    Alert,
    LayoutAnimation,
    Platform,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    UIManager,
    View
} from 'react-native'
import { useAttachmentUpload } from '../hooks/use-attachment-upload'
import { BountyCard } from './bounty-card'
import { PosterReviewModal } from './poster-review-modal'
import { StaleBountyAlert } from './stale-bounty-alert'
import { AnimatedSection } from './ui/animated-section'
import { AttachmentsList } from './ui/attachments-list'
import { MessageBar } from './ui/message-bar'
import { RatingStars } from './ui/rating-stars'
import { RevisionFeedbackBanner } from './ui/revision-feedback-banner'
import { Stepper } from './ui/stepper'

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true)
}

type Props = {
  bounty: Bounty
  currentUserId?: string
  expanded: boolean
  onToggle: () => void
  onEdit?: () => void
  onDelete?: () => void
  onWithdrawApplication?: () => void
  onGoToReview?: (bountyId: string) => void
  onGoToPayout?: (bountyId: string) => void
  variant?: 'owner' | 'hunter'
  isListScrolling?: boolean
  onExpandedLayout?: () => void
  onRefresh?: () => void
}

const STAGES = [
  { id: 'apply_work', label: 'Apply & Work', icon: 'work' },
  { id: 'working_progress', label: 'Working Progress', icon: 'trending-up' },
  { id: 'review_verify', label: 'Review & Verify', icon: 'rate-review' },
  { id: 'payout', label: 'Payout', icon: 'account-balance-wallet' },
]

export function MyPostingExpandable({ bounty, currentUserId, expanded, onToggle, onEdit, onDelete, onWithdrawApplication, onGoToReview, onGoToPayout, variant, isListScrolling, onExpandedLayout, onRefresh }: Props) {
  const router = useRouter()
  const [conversation, setConversation] = useState<Conversation | null>(null)
  const [wipExpanded, setWipExpanded] = useState(false)
  const [readyToSubmitPressed, setReadyToSubmitPressed] = useState(false)
  const [ratingDraft, setRatingDraft] = useState(0)
  const [showReviewModal, setShowReviewModal] = useState(false)
  const [hasSubmission, setHasSubmission] = useState(false)
  const [reviewExpanded, setReviewExpanded] = useState(false)
  const [payoutExpanded, setPayoutExpanded] = useState(false)
  const [readyRecord, setReadyRecord] = useState<{ bounty_id: string; hunter_id: string; ready_at: string } | null>(null)
  const [revisionFeedback, setRevisionFeedback] = useState<string | null>(null)
  const [showRevisionBanner, setShowRevisionBanner] = useState(false)
  // Persisted flag so the card-level badge remains even if the banner is dismissed
  const [hasRevisionRequested, setHasRevisionRequested] = useState(false)
  
  // Cancellation and dispute state
  const [hasCancellationRequest, setHasCancellationRequest] = useState(false)
  const [hasDispute, setHasDispute] = useState(false)
  
  // Hunter completion submission state
  const [timeElapsed, setTimeElapsed] = useState(0)
  const [startTime] = useState(Date.now())
  const [completionMessage, setCompletionMessage] = useState('')
  const [proofItems, setProofItems] = useState<Array<{ id: string; type: 'image' | 'file'; name: string; size?: number }>>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submissionPending, setSubmissionPending] = useState(false)

  useEffect(() => {
    let mounted = true
    async function load() {
      try {
        const list = await messageService.getConversations()
        const match = list.find(c => String(c.bountyId) === String(bounty.id)) || null
        if (mounted) setConversation(match)

        // Check if there's a pending submission
        if (bounty.status === 'in_progress' && variant === 'owner') {
          const submission = await completionService.getSubmission(String(bounty.id))
          const foundSubmission = !!submission && submission.status === 'pending'
          if (mounted) {
            setHasSubmission(foundSubmission)
            // Auto-expand Review & Verify section when submission is detected
            if (foundSubmission) {
              setReviewExpanded(true)
              setWipExpanded(false)
              // Move the visual stepper to Review & Verify so owner sees where action is needed
              setLocalStageOverride('review_verify')
            }
          }
        }
        // For hunters, initialize revision indicator state from latest submission
        if (bounty.status === 'in_progress' && variant === 'hunter') {
          try {
            const submission = await completionService.getSubmission(String(bounty.id))
            if (mounted && submission) {
              // Only check pending-for-hunter if currentUserId is defined
              let isPendingForHunter = false
              if (currentUserId) {
                const hunterId = String(currentUserId)
                isPendingForHunter = submission.status === 'pending' && submission.hunter_id === hunterId
              }

              if (isPendingForHunter) {
                setHasSubmission(true)
                setSubmissionPending(true)
                setReviewExpanded(false)
                setPayoutExpanded(true)
                setShowRevisionBanner(false)
                setHasRevisionRequested(false)
              } else if (submission.status === 'revision_requested') {
                setHasRevisionRequested(true)
                setRevisionFeedback(submission.poster_feedback || null)
                setShowRevisionBanner(true)
                setLocalStageOverride('working_progress')
                setWipExpanded(true)
                setReviewExpanded(false)
                setSubmissionPending(false)
                setHasSubmission(false)
              } else {
                setSubmissionPending(false)
                setHasSubmission(false)
                setShowRevisionBanner(false)
                setHasRevisionRequested(false)
              }
            }
          } catch {}
        }
        // Also check ready flag (hunter clicked Ready to Submit)
        try {
          const ready = await completionService.getReady(String(bounty.id))
          if (mounted) setReadyRecord(ready)
        } catch {}
        
        // Check for cancellation request
        try {
          const cancellation = await cancellationService.getCancellationByBountyId(String(bounty.id))
          if (mounted && cancellation && cancellation.status === 'pending') {
            setHasCancellationRequest(true)
          }
        } catch {}
        
        // Check for active dispute
        try {
          const dispute = await disputeService.getDisputeByCancellationId(String(bounty.id))
          if (mounted && dispute && (dispute.status === 'open' || dispute.status === 'under_review')) {
            setHasDispute(true)
          }
        } catch {}
      } catch {}
    }
  // Load owner-related state (submission / ready flag) earlier so posters see pending work in list view.
  // Also load for hunters even when the card is not expanded so revision-requested state
  // is available in the compact card (shows badge) without needing to open the card first.
  if (expanded || variant === 'owner' || variant === 'hunter') load()
    return () => { mounted = false }
  }, [expanded, bounty.id, bounty.status, variant])
  
  // owner detection
  const isOwner = useMemo(() => {
    if (variant === 'owner') return true
    if (variant === 'hunter') return false
    return currentUserId === bounty.user_id
  }, [variant, currentUserId, bounty.user_id])

  // Timer for hunter completion
  useEffect(() => {
    if (!isOwner && bounty.status === 'in_progress' && reviewExpanded) {
      const interval = setInterval(() => {
        setTimeElapsed(Math.floor((Date.now() - startTime) / 1000))
      }, 1000)
      return () => clearInterval(interval)
    }
  }, [isOwner, bounty.status, reviewExpanded, startTime])

  // Subscribe to ready-state realtime updates so poster's card unlocks immediately
  useEffect(() => {
    if (!bounty.id) return
    let unsub: (() => void) | undefined
    try {
      unsub = completionService.subscribeReady(String(bounty.id), (rec) => {
        setReadyRecord(rec)
        if (variant === 'owner' && rec) {
          // If owner sees a ready record, show review submission availability
          setHasSubmission(true)
        }
      })
    } catch (e) {
      // ignore
    }
    return () => { try { unsub && unsub() } catch {} }
  }, [bounty.id, variant])

  // Subscribe to submission updates so hunter gets pushed back to WIP if poster requests revision
  useEffect(() => {
    if (!bounty.id) return
    let unsub: (() => void) | undefined
    try {
      unsub = completionService.subscribeSubmission(String(bounty.id), (submission) => {
        if (!submission) {
          setHasSubmission(false)
          setRevisionFeedback(null)
          setShowRevisionBanner(false)
          setHasRevisionRequested(false)
          return
        }
        const isPending = submission.status === 'pending'
        setHasSubmission(isPending)
        
        // If poster gets a new submission, auto-expand Review & Verify section
        if (isOwner && isPending) {
          setReviewExpanded(true)
          setWipExpanded(false)
          // Show the stepper on the Review & Verify bubble for owner
          setLocalStageOverride('review_verify')
        }
        
        // If the poster requested a revision, and we're the hunter, move back to Work in Progress
        if (!isOwner && submission.status === 'revision_requested') {
          // Store feedback and show banner instead of alert
          setRevisionFeedback(submission.poster_feedback || 'The poster has requested changes to your work.')
          setShowRevisionBanner(true)
          setHasRevisionRequested(true)
          setLocalStageOverride('working_progress')
          setWipExpanded(true)
          setReviewExpanded(false)
          setSubmissionPending(false)
          setHasSubmission(false)
        }
      })
    } catch (e) {
      // ignore
    }
    return () => { try { unsub && unsub() } catch {} }
  }, [bounty.id, isOwner])

  const currentStage: 'apply_work' | 'working_progress' | 'review_verify' | 'payout' = useMemo(() => {
    if (bounty.status === 'in_progress') return 'working_progress'
    if (bounty.status === 'completed') return 'payout'
    // We don't track 'review_verify' in status—user reaches it via flow; keep default as 'apply_work'
    return 'apply_work'
  }, [bounty.status])

  // Local override to move the UI to a specific stage when user advances via buttons
  const [localStageOverride, setLocalStageOverride] = useState<null | 'apply_work' | 'working_progress' | 'review_verify' | 'payout'>(null)


  const animate = () => LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)

  // Parse attachments from bounty
  const attachments: Attachment[] = useMemo(() => {
    if (!bounty.attachments_json) return []
    try {
      const raw: any = (bounty as any).attachments_json
      if (typeof raw === 'string') {
        const parsed = JSON.parse(raw)
        return Array.isArray(parsed) ? parsed : []
      }
      if (Array.isArray(raw)) return raw as Attachment[]
      // If it's an object (unexpected shape), attempt to coerce to array
      return Array.isArray(raw) ? raw : []
    } catch {
      return []
    }
  }, [bounty.attachments_json])

  const handleSendMessage = async (text: string) => {
    if (!conversation) throw new Error('No conversation')
    await messageService.sendMessage(conversation.id, text, currentUserId)
  }
  
  const formatTime = (seconds: number): string => {
    if (seconds < 60) return `${seconds}s`
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = seconds % 60
    if (minutes < 60) return `${minutes}m ${remainingSeconds}s`
    const hours = Math.floor(minutes / 60)
    const remainingMinutes = minutes % 60
    return `${hours}h ${remainingMinutes}m`
  }

  const relativeTime = (iso?: string | null) => {
    if (!iso) return 'just now'
    try {
      const then = new Date(iso).getTime()
      const now = Date.now()
      const delta = Math.floor((now - then) / 1000)
      if (delta < 60) return `${delta}s ago`
      if (delta < 3600) return `${Math.floor(delta / 60)}m ago`
      if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`
      return `${Math.floor(delta / 86400)}d ago`
    } catch {
      return 'just now'
    }
  }
  
  const handleSubmitCompletion = async () => {
    if (!completionMessage.trim()) {
      Alert.alert('Completion Message Required', 'Please add a message describing your completed work.')
      return
    }
    
    // Helper for pluralization
    const proofCount = proofItems.length
    const proofLabel = proofCount === 1 ? '1 proof item' : `${proofCount} proof items`
    
    // Define the actual submission logic
    const performSubmission = async () => {
      try {
        setIsSubmitting(true)

        // Check for existing pending submission to avoid duplicates
        const existing = await completionService.getSubmission(String(bounty.id))
        if (existing && existing.status === 'pending' && existing.hunter_id === String(currentUserId || '')) {
          // Already have a pending submission from this hunter — avoid duplicate
          Alert.alert('Submission Pending', 'You already have a pending submission. Please wait for the poster to review or check your submission.')
          setIsSubmitting(false)
          setHasSubmission(true)
          return
        }

        const resp = await completionService.submitCompletion({
          bounty_id: String(bounty.id),
          hunter_id: currentUserId || '',
          message: completionMessage.trim(),
          proof_items: proofItems,
        })

        if (resp) {
          Alert.alert('Submission Successful', 'Your work has been submitted for review!')
          // Lock review UI and show waiting state
          setSubmissionPending(true)
          setHasSubmission(true)
          // Clear the revision badge on resubmission
          setHasRevisionRequested(false)
          setReviewExpanded(false)
          setPayoutExpanded(true)
          // Trigger parent refresh to update list
          if (onRefresh) onRefresh()
        }
      } catch (err) {
        console.error('Error submitting completion:', err)
        Alert.alert('Error', 'Failed to submit completion. Please try again.')
      } finally {
        setIsSubmitting(false)
      }
    }

    // Show different confirmation dialogs based on whether proof is attached
    if (proofItems.length === 0) {
      // No proof attached - show warning
      Alert.alert(
        'No Proof Attached',
        'You are submitting without any proof of completion. The poster may request revisions. Are you sure you want to continue?',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Submit Anyway', style: 'destructive', onPress: performSubmission },
        ]
      )
    } else {
      // Proof attached - show confirmation
      Alert.alert(
        'Confirm Submission',
        `You have attached ${proofLabel}. Are you ready to submit your work for review?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Submit', onPress: performSubmission },
        ]
      )
    }
  }
  
  // Attachment upload hook for real attachments
  const { pickAttachment, isUploading: isAttUploading, progress: attProgress } = useAttachmentUpload({
    bucket: 'bounty-attachments',
    folder: `bounties/${bounty.id}/proofs`,
    maxSizeMB: 20,
  })

  const handleAddProof = async () => {
    try {
      const uploaded = await pickAttachment()
      if (!uploaded) return

      const newProof = {
        id: uploaded.id,
        type: uploaded.mimeType?.startsWith('image/') ? 'image' as const : 'file' as const,
        name: uploaded.name,
        size: uploaded.size,
        remoteUri: uploaded.remoteUri,
        uri: uploaded.uri,
      } as any

      setProofItems((prev) => [...prev, newProof])

      // Persist to bounty attachments_json
      const success = await bountyService.addAttachmentToBounty(bounty.id, uploaded)
      if (!success) {
        Alert.alert('Attachment saved locally', 'Upload succeeded but failed to persist on the server.')
      }
      // Trigger parent refresh if provided
      if (onRefresh) onRefresh()
    } catch (err) {
      console.error('Error adding proof:', err)
      Alert.alert('Upload failed', 'Could not add proof. Please try again.')
    }
  }
  
  const handleRemoveProof = (id: string) => {
    setProofItems(proofItems.filter(item => item.id !== id))
  }

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return '0 KB'
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const currentStageIndex = useMemo(() => {
    const stageToUse = localStageOverride || currentStage
    return STAGES.findIndex(s => s.id === stageToUse)
  }, [currentStage, localStageOverride])

  const awaitingPosterAction = !isOwner && bounty.status === 'in_progress' && (submissionPending || hasSubmission)

  const handleCancelBounty = () => {
    router.push(`/bounty/${bounty.id}/cancel`)
  }

  const handleViewCancellation = () => {
    router.push(`/bounty/${bounty.id}/cancellation-response`)
  }

  const handleViewDispute = () => {
    router.push(`/bounty/${bounty.id}/dispute`)
  }

  const handleCancelStaleBounty = async (bountyId: number | string) => {
    try {
      const result = await staleBountyService.cancelStaleBounty(bountyId)
      if (result.success) {
        Alert.alert('Success', 'Bounty cancelled successfully. Your funds will be refunded.', [
          { text: 'OK', onPress: () => onRefresh?.() }
        ])
      } else {
        Alert.alert('Error', result.error || 'Failed to cancel bounty')
      }
    } catch (error) {
      Alert.alert('Error', 'An unexpected error occurred')
    }
  }

  const handleRepostStaleBounty = async (bountyId: number | string) => {
    try {
      const result = await staleBountyService.repostStaleBounty(bountyId)
      if (result.success) {
        Alert.alert('Success', 'Bounty reposted successfully. It is now open for new hunters.', [
          { text: 'OK', onPress: () => onRefresh?.() }
        ])
      } else {
        Alert.alert('Error', result.error || 'Failed to repost bounty')
      }
    } catch (error) {
      Alert.alert('Error', 'An unexpected error occurred')
    }
  }

  return (
    <View>
      <BountyCard
        bounty={bounty}
        currentUserId={currentUserId}
        onPress={() => { if (!isListScrolling) { animate(); onToggle(); } }}
        onEdit={onEdit}
        onDelete={onDelete}
        onCancel={handleCancelBounty}
        onViewCancellation={handleViewCancellation}
        onViewDispute={handleViewDispute}
        revisionRequested={hasRevisionRequested && !isOwner}
        reviewNeeded={hasSubmission && isOwner}
        revisionFeedback={revisionFeedback}
        submittedForReview={awaitingPosterAction}
        hasCancellationRequest={hasCancellationRequest}
        hasDispute={hasDispute}
      />
      {expanded && (
        <View style={styles.panel} onLayout={() => { if (typeof onExpandedLayout === 'function') onExpandedLayout() }}>
          {/* Show stale bounty alert if bounty is stale and user is the owner */}
          {bounty.is_stale && isOwner && (
            <StaleBountyAlert
              bounty={bounty}
              onCancel={handleCancelStaleBounty}
              onRepost={handleRepostStaleBounty}
            />
          )}
          
          {/* Compact header row mirroring detail card */}
          <View style={styles.panelHeader}>
            <Text style={styles.panelTitle}>Progress</Text>
            {bounty.is_for_honor ? (
              <View style={styles.honorBadge}><MaterialIcons name="favorite" size={14} color="#052e1b" /><Text style={styles.honorBadgeText}>For Honor</Text></View>
            ) : (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={styles.amount}>${bounty.amount}</Text>
                {variant === 'owner' && readyRecord && (
                  <TouchableOpacity
                    style={styles.readyBadge}
                    onPress={() => setShowReviewModal(true)}
                    accessibilityRole="button"
                    accessibilityLabel={`Hunter ready, opened review modal`}
                  >
                    <MaterialIcons name="hourglass-top" size={14} color="#052e1b" />
                    <Text style={styles.readyBadgeText}>{`Hunter Ready · ${relativeTime(readyRecord.ready_at)}`}</Text>
                  </TouchableOpacity>
                )}
                {isOwner && hasSubmission && (
                  <TouchableOpacity
                    style={styles.headerReviewBtn}
                    onPress={() => setShowReviewModal(true)}
                    accessibilityRole="button"
                    accessibilityLabel="Open review modal"
                  >
                    <MaterialIcons name="rate-review" size={14} color="#052e1b" />
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>

          {/* Timeline bubbles - using new Stepper component */}
          <Stepper stages={STAGES} activeIndex={currentStageIndex} variant="compact" />

          {/* Pre-acceptance info when open */}
          {bounty.status === 'open' && (
            <View style={styles.infoBox}>
              <MaterialIcons name="hourglass-empty" size={18} color="#6ee7b7" />
              {isOwner ? (
                <Text style={styles.infoText}>Awaiting a hunter. Review requests in the Requests tab.</Text>
              ) : (
                <Text style={styles.infoText}>Your application is pending. We’ll notify you when the poster accepts.</Text>
              )}
            </View>
          )}

          {/* Work in Progress section - only when in_progress status */}
          {bounty.status === 'in_progress' && (
            <AnimatedSection
              title="Work in progress"
              expanded={wipExpanded}
              onToggle={() => {
                // If the flow has been advanced (locked), prevent toggling WIP
                if (readyToSubmitPressed || !!readyRecord) return
                setWipExpanded(!wipExpanded)
              }}
              locked={readyToSubmitPressed || !!readyRecord}
            >
              {isOwner ? (
                <View style={{ gap: 16 }}>
                  {/* Poster view: Message bar, attachments, rating */}
                  
                  {/* Show review button if submission is pending */}
                  {hasSubmission && (
                    <TouchableOpacity
                      style={styles.reviewSubmissionBtn}
                      onPress={() => setShowReviewModal(true)}
                    >
                      <MaterialIcons name="rate-review" size={20} color="#fff" />
                      <Text style={styles.reviewSubmissionText}>Review Submission</Text>
                      <View style={styles.newBadge}>
                        <Text style={styles.newBadgeText}>NEW</Text>
                      </View>
                    </TouchableOpacity>
                  )}

                  {conversation && (
                    <MessageBar
                      conversationId={conversation.id}
                      onSendMessage={handleSendMessage}
                      placeholder="Send a quick message to the hunter..."
                    />
                  )}
                  
                  <AttachmentsList attachments={attachments} />
                  
                  <RatingStars
                    rating={ratingDraft}
                    onRatingChange={setRatingDraft}
                    label="Rate This Bounty:"
                  />
                </View>
              ) : (
                <View style={{ gap: 16 }}>
                  {/* Hunter view: Instructions, attachments, next button */}
                  
                  {/* Show revision feedback banner if present */}
                  {showRevisionBanner && revisionFeedback && (
                    <RevisionFeedbackBanner
                      feedback={revisionFeedback}
                      onDismiss={() => setShowRevisionBanner(false)}
                      showDismiss={true}
                    />
                  )}
                  
                  <View style={styles.infoBox}>
                    <MaterialIcons name="info-outline" size={18} color="#6ee7b7" />
                    <Text style={styles.infoText}>
                      Begin work on the bounty; once complete press the next button.
                    </Text>
                  </View>
                  
                  <AttachmentsList attachments={attachments} />
                  
                  <TouchableOpacity
                    style={[styles.primaryBtn, (readyToSubmitPressed || !!readyRecord) && styles.buttonDisabled]}
                    onPress={async () => {
                      // Persist ready state and advance UI
                      const ok = await completionService.markReady(String(bounty.id), String(currentUserId || ''))
                      if (ok) {
                        setReadyToSubmitPressed(true)
                        setWipExpanded(false)
                        setReviewExpanded(true)
                        setLocalStageOverride('review_verify')
                        // update local readyRecord optimistically
                        const now = new Date().toISOString()
                        const rec = { bounty_id: String(bounty.id), hunter_id: String(currentUserId || ''), ready_at: now }
                        setReadyRecord(rec)
                        // Trigger parent refresh to update list
                        if (onRefresh) onRefresh()
                      } else {
                        Alert.alert('Error', 'Failed to mark Ready. Please try again.')
                      }
                    }}
                    disabled={readyToSubmitPressed || !!readyRecord}
                  >
                    <Text style={styles.primaryText}>Ready to Submit</Text>
                    <MaterialIcons name={(readyToSubmitPressed || !!readyRecord) ? 'lock' : 'arrow-forward'} size={18} color="#fff" />
                  </TouchableOpacity>
                </View>
              )}
            </AnimatedSection>
          )}

          {/* Poster Review & Verify Section - when hunter has submitted */}
          {isOwner && bounty.status === 'in_progress' && hasSubmission && (
            <AnimatedSection
              title="Review & Verify"
              expanded={reviewExpanded}
              onToggle={() => setReviewExpanded(!reviewExpanded)}
            >
              <View style={{ gap: 16 }}>
                <View style={styles.infoBox}>
                  <MaterialIcons name="rate-review" size={18} color="#6ee7b7" />
                  <Text style={styles.infoText}>
                    The hunter has submitted their work for review. Review the submission and approve or request changes.
                  </Text>
                </View>

                <TouchableOpacity
                  style={styles.reviewSubmissionBtn}
                  onPress={() => setShowReviewModal(true)}
                >
                  <MaterialIcons name="rate-review" size={20} color="#fff" />
                  <Text style={styles.reviewSubmissionText}>Review Submission</Text>
                  <View style={styles.newBadge}>
                    <Text style={styles.newBadgeText}>NEW</Text>
                  </View>
                </TouchableOpacity>

                {/* Navigate to full review screen option */}
                {onGoToReview && (
                  <TouchableOpacity
                    style={[styles.primaryBtn, { backgroundColor: 'rgba(16, 185, 129, 0.3)' }]}
                    onPress={() => onGoToReview(String(bounty.id))}
                  >
                    <Text style={styles.primaryText}>Open Review Screen</Text>
                    <MaterialIcons name="arrow-forward" size={18} color="#fff" />
                  </TouchableOpacity>
                )}
              </View>
            </AnimatedSection>
          )}

          {/* Hunter Review & Verify Section - when ready to submit */}
          {!isOwner && bounty.status === 'in_progress' && (
            <AnimatedSection
              title="Review & Verify"
              expanded={reviewExpanded}
              onToggle={() => {
                // Prevent toggling open unless readyToSubmitPressed or a readyRecord exists or there's no pending submission
                if (!readyToSubmitPressed && !readyRecord) return
                if (submissionPending || hasSubmission) return
                setReviewExpanded(!reviewExpanded)
              }}
              locked={!readyToSubmitPressed && !readyRecord || submissionPending || hasSubmission}
            >
              <View style={{ gap: 16 }}>
                {/* If a submission is pending, show waiting state */}
                {(submissionPending || hasSubmission) ? (
                  <View style={styles.infoBox}>
                    <MaterialIcons name="hourglass-top" size={18} color="#6ee7b7" />
                    <Text style={styles.infoText}>Waiting for poster to review your submission.</Text>
                  </View>
                ) : (
                  <>
                    {/* Message Input */}
                    <View>
                      <Text style={styles.sectionTitle}>Message (cont):</Text>
                      <TextInput
                        style={styles.messageTextArea}
                        placeholder="Describe your completed work..."
                        placeholderTextColor="rgba(255,254,245,0.4)"
                        value={completionMessage}
                        onChangeText={setCompletionMessage}
                        multiline
                        numberOfLines={4}
                        maxLength={1000}
                        textAlignVertical="top"
                      />
                    </View>

                    {/* Proof Attachments */}
                    <View>
                      <Text style={styles.sectionTitle}>Proof:</Text>
                      {proofItems.map((item) => (
                        <View key={item.id} style={styles.proofItem}>
                          <View style={styles.proofIcon}>
                            <MaterialIcons
                              name={item.type === 'image' ? 'image' : 'insert-drive-file'}
                              size={24}
                              color="#6ee7b7"
                            />
                          </View>
                          <View style={styles.proofInfo}>
                            <Text style={styles.proofName}>{item.name}</Text>
                            <Text style={styles.proofSize}>{formatFileSize(item.size)}</Text>
                          </View>
                          <TouchableOpacity onPress={() => handleRemoveProof(item.id)}>
                            <MaterialIcons name="close" size={20} color="#ef4444" />
                          </TouchableOpacity>
                        </View>
                      ))}
                      <TouchableOpacity
                        style={[styles.addFileBtn, !(readyToSubmitPressed || !!readyRecord) && styles.buttonDisabled]}
                        onPress={handleAddProof}
                        disabled={!(readyToSubmitPressed || !!readyRecord)}
                      >
                        <MaterialIcons name={(readyToSubmitPressed || !!readyRecord) ? 'add' : 'lock'} size={20} color="#10b981" />
                        <Text style={styles.addFileText}>{(readyToSubmitPressed || !!readyRecord) ? 'Add File' : 'Locked'}</Text>
                      </TouchableOpacity>
                    </View>

                    {/* Submit Button */}
                    <TouchableOpacity
                      style={[styles.primaryBtn, isSubmitting && styles.buttonDisabled]}
                      onPress={handleSubmitCompletion}
                      disabled={isSubmitting}
                    >
                      {isSubmitting ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Text style={styles.primaryText}>Submit</Text>
                      )}
                    </TouchableOpacity>
                  </>
                )}
              </View>
            </AnimatedSection>
          )}

          {/* Payout Section - when completed */}
          {bounty.status === 'completed' && (
            <AnimatedSection
              title="Payout"
              expanded={payoutExpanded}
              onToggle={() => setPayoutExpanded(!payoutExpanded)}
            >
              <View style={{ gap: 16 }}>
                {/* Success Message */}
                <View style={styles.successPanel}>
                  <MaterialIcons name="check-circle" size={48} color="#10b981" />
                  <Text style={styles.successTitle}>Payout Released!</Text>
                  <Text style={styles.successText}>
                    {isOwner 
                      ? 'You have approved the work and released payment.' 
                      : 'Congratulations! The poster has approved your work and released the payment.'}
                  </Text>
                  
                  {!bounty.is_for_honor && (
                    <View style={styles.payoutAmountCard}>
                      <Text style={styles.payoutLabel}>Payout Amount</Text>
                      <Text style={styles.payoutAmount}>${bounty.amount}</Text>
                      <Text style={styles.payoutSubtext}>
                        {isOwner ? 'Released from escrow' : 'Added to your wallet balance'}
                      </Text>
                    </View>
                  )}
                  
                  {bounty.is_for_honor && (
                    <View style={styles.honorCard}>
                      <MaterialIcons name="favorite" size={32} color="#ec4899" />
                      <Text style={styles.honorTitle}>Completed for Honor</Text>
                      <Text style={styles.honorCardText}>
                        Thank you for contributing to the community!
                      </Text>
                    </View>
                  )}
                </View>

                {/* Transaction Receipt */}
                {!bounty.is_for_honor && (
                  <View style={styles.receiptCard}>
                    <View style={styles.receiptHeader}>
                      <MaterialIcons name="receipt" size={24} color="#6ee7b7" />
                      <Text style={styles.receiptTitle}>Transaction Receipt</Text>
                    </View>
                    <View style={styles.receiptDivider} />
                    <View style={styles.receiptRow}>
                      <Text style={styles.receiptLabel}>Bounty</Text>
                      <Text style={styles.receiptValue}>{bounty.title}</Text>
                    </View>
                    <View style={styles.receiptRow}>
                      <Text style={styles.receiptLabel}>Amount</Text>
                      <Text style={styles.receiptValue}>${bounty.amount}</Text>
                    </View>
                    <View style={styles.receiptRow}>
                      <Text style={styles.receiptLabel}>Date</Text>
                      <Text style={styles.receiptValue}>{new Date().toLocaleDateString()}</Text>
                    </View>
                    <View style={styles.receiptRow}>
                      <Text style={styles.receiptLabel}>Status</Text>
                      <View style={styles.statusPill}>
                        <MaterialIcons name="check-circle" size={16} color="#10b981" />
                        <Text style={styles.statusPillText}>Completed</Text>
                      </View>
                    </View>
                  </View>
                )}
              </View>
            </AnimatedSection>
          )}

          {/* Conversation hint - only show when status is 'open', not when in_progress since bounty has already been accepted */}
          {!conversation && bounty.status === 'open' && (
            <View style={styles.infoBox}>
              <MaterialIcons name="chat-bubble-outline" size={18} color="#6ee7b7" />
              <Text style={styles.infoText}>{isOwner ? 'Conversation will appear after acceptance.' : 'A chat with the poster will appear once you’re accepted.'}</Text>
            </View>
          )}
        </View>
      )}

      {/* Poster Review Modal */}
      {isOwner && (
        <PosterReviewModal
          visible={showReviewModal}
          bountyId={String(bounty.id)}
          hunterId={bounty.accepted_by || readyRecord?.hunter_id || ''}
          hunterName="Hunter" // TODO: Get actual hunter name
          bountyAmount={bounty.amount || 0}
          isForHonor={bounty.is_for_honor || false}
          onClose={() => setShowReviewModal(false)}
          onComplete={() => {
            setShowReviewModal(false)
            setHasSubmission(false)
            // Trigger refresh
            if (onRefresh) onRefresh()
          }}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: 'rgba(5, 150, 105, 0.25)',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.2)',
    marginTop: -8,
    marginBottom: 12,
  },
  panelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  panelTitle: { color: '#fff', fontWeight: '700' },
  amount: { color: '#fff', fontWeight: '800' },
  timelineRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  timelineItem: { flexDirection: 'row', alignItems: 'center' },
  bubble: { width: 12, height: 12, borderRadius: 6 },
  bubbleIdle: { backgroundColor: 'rgba(110,231,183,0.3)' },
  bubbleActive: { backgroundColor: '#10b981' },
  bubbleCompleted: { backgroundColor: '#059669' },
  connector: { width: 18, height: 2, backgroundColor: 'rgba(110,231,183,0.35)', marginHorizontal: 6 },
  infoBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: 'rgba(5, 46, 27, 0.35)', padding: 10, borderRadius: 8, marginBottom: 8 },
  infoText: { color: '#d1fae5', fontSize: 12, flex: 1 },
  actionsRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  primaryBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#10b981', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10 },
  primaryText: { color: '#fff', fontWeight: '600' },
  muted: { color: '#a7f3d0', fontSize: 12 },
  honorBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#a7f3d0', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, gap: 4 },
  honorBadgeText: { color: '#052e1b', fontWeight: '800', fontSize: 12 },
  reviewSubmissionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#fbbf24',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  reviewSubmissionText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
  },
  newBadge: {
    backgroundColor: '#ef4444',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  newBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '800',
  },
  timerContainer: {
    alignItems: 'center',
    paddingVertical: 20,
    gap: 8,
    backgroundColor: 'rgba(5, 150, 105, 0.1)',
    borderRadius: 12,
  },
  timerLabel: {
    color: '#6ee7b7',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  timerValue: {
    color: '#fff',
    fontSize: 48,
    fontWeight: '700',
  },
  timerHint: {
    color: 'rgba(255,254,245,0.6)',
    fontSize: 11,
  },
  messageTextArea: {
    backgroundColor: 'rgba(5, 150, 105, 0.2)',
    borderRadius: 12,
    padding: 12,
    color: '#fff',
    fontSize: 14,
    minHeight: 100,
    borderWidth: 1,
    borderColor: 'rgba(110, 231, 183, 0.2)',
  },
  proofItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(5, 150, 105, 0.2)',
    borderRadius: 12,
    padding: 12,
    gap: 12,
    borderWidth: 1,
    borderColor: 'rgba(110, 231, 183, 0.2)',
    marginBottom: 8,
  },
  proofIcon: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: 'rgba(5, 150, 105, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  proofInfo: {
    flex: 1,
    gap: 4,
  },
  proofName: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
  },
  proofSize: {
    color: '#6ee7b7',
    fontSize: 12,
  },
  sectionTitle: {
    color: '#a7f3d0',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 6,
  },
  addFileBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#10b981',
    borderStyle: 'dashed',
  },
  addFileText: {
    color: '#10b981',
    fontSize: 14,
    fontWeight: '600',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  successPanel: {
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderRadius: 12,
    padding: 24,
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  successTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '600',
  },
  successText: {
    color: 'rgba(255,254,245,0.8)',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  payoutAmountCard: {
    backgroundColor: 'rgba(5, 150, 105, 0.2)',
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    width: '100%',
  },
  payoutLabel: {
    color: '#6ee7b7',
    fontSize: 14,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  payoutAmount: {
    color: '#10b981',
    fontSize: 32,
    fontWeight: '700',
  },
  payoutSubtext: {
    color: 'rgba(255,254,245,0.7)',
    fontSize: 12,
  },
  honorCard: {
    backgroundColor: 'rgba(236, 72, 153, 0.15)',
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    width: '100%',
  },
  honorTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  honorCardText: {
    color: 'rgba(255,254,245,0.8)',
    fontSize: 14,
    textAlign: 'center',
  },
  receiptCard: {
    backgroundColor: 'rgba(5, 150, 105, 0.1)',
    borderRadius: 12,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: 'rgba(110, 231, 183, 0.2)',
  },
  receiptHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  receiptTitle: {
    color: '#6ee7b7',
    fontSize: 16,
    fontWeight: '600',
  },
  receiptDivider: {
    height: 1,
    backgroundColor: 'rgba(110, 231, 183, 0.2)',
  },
  receiptRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  receiptLabel: {
    color: 'rgba(255,254,245,0.7)',
    fontSize: 14,
  },
  receiptValue: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
    maxWidth: '60%',
    textAlign: 'right',
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  statusPillText: {
    color: '#10b981',
    fontSize: 12,
    fontWeight: '600',
  },
  readyBadge: {
    backgroundColor: '#d1fae5',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
    flexDirection: 'row',
    alignItems: 'center',
  },
  readyBadgeText: {
    color: '#052e1b',
    fontSize: 12,
    marginLeft: 6,
    fontWeight: '600',
  },
  headerReviewBtn: {
    marginLeft: 8,
    backgroundColor: 'rgba(167,243,208,0.9)',
    padding: 6,
    borderRadius: 8,
  },
  withdrawButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  withdrawButtonText: {
    color: '#ef4444',
    fontSize: 12,
    fontWeight: '600',
  },
})
