import { MaterialIcons } from '@expo/vector-icons'
import type { Attachment } from 'lib/types'
import type { Bounty } from 'lib/services/database.types'
import { messageService } from 'lib/services/message-service'
import type { Conversation } from 'lib/types'
import React, { useEffect, useMemo, useState } from 'react'
import { 
  ActivityIndicator,
  LayoutAnimation, 
  Platform, 
  StyleSheet, 
  Text, 
  TextInput,
  TouchableOpacity, 
  UIManager, 
  View 
} from 'react-native'
import { BountyCard } from './bounty-card'
import { AnimatedSection } from './ui/animated-section'
import { AttachmentsList } from './ui/attachments-list'
import { MessageBar } from './ui/message-bar'
import { RatingStars } from './ui/rating-stars'
import { Stepper } from './ui/stepper'
import { PosterReviewModal } from './poster-review-modal'
import { completionService, type CompletionSubmission } from 'lib/services/completion-service'

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
  onGoToReview?: (bountyId: string) => void
  onGoToPayout?: (bountyId: string) => void
  variant?: 'owner' | 'hunter'
}

const STAGES = [
  { id: 'apply_work', label: 'Apply & Work', icon: 'work' },
  { id: 'working_progress', label: 'Working Progress', icon: 'trending-up' },
  { id: 'review_verify', label: 'Review & Verify', icon: 'rate-review' },
  { id: 'payout', label: 'Payout', icon: 'account-balance-wallet' },
] as const

export function MyPostingExpandable({ bounty, currentUserId, expanded, onToggle, onEdit, onDelete, onGoToReview, onGoToPayout, variant }: Props) {
  const [conversation, setConversation] = useState<Conversation | null>(null)
  const [wipExpanded, setWipExpanded] = useState(false)
  const [ratingDraft, setRatingDraft] = useState(0)
  const [showReviewModal, setShowReviewModal] = useState(false)
  const [hasSubmission, setHasSubmission] = useState(false)
  const [reviewExpanded, setReviewExpanded] = useState(false)
  const [payoutExpanded, setPayoutExpanded] = useState(false)
  
  // Hunter completion submission state
  const [timeElapsed, setTimeElapsed] = useState(0)
  const [startTime] = useState(Date.now())
  const [completionMessage, setCompletionMessage] = useState('')
  const [proofItems, setProofItems] = useState<Array<{ id: string; type: 'image' | 'file'; name: string; size?: number }>>([])
  const [isSubmitting, setIsSubmitting] = useState(false)

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
          if (mounted) setHasSubmission(!!submission && submission.status === 'pending')
        }
      } catch {}
    }
    if (expanded) load()
    return () => { mounted = false }
  }, [expanded, bounty.id, bounty.status, variant])
  
  // Timer for hunter completion
  useEffect(() => {
    if (!isOwner && bounty.status === 'in_progress' && reviewExpanded) {
      const interval = setInterval(() => {
        setTimeElapsed(Math.floor((Date.now() - startTime) / 1000))
      }, 1000)
      return () => clearInterval(interval)
    }
  }, [isOwner, bounty.status, reviewExpanded, startTime])

  const currentStage: 'apply_work' | 'working_progress' | 'review_verify' | 'payout' = useMemo(() => {
    if (bounty.status === 'in_progress') return 'working_progress'
    if (bounty.status === 'completed') return 'payout'
    // We don't track 'review_verify' in status—user reaches it via flow; keep default as 'apply_work'
    return 'apply_work'
  }, [bounty.status])

  const isOwner = useMemo(() => {
    if (variant === 'owner') return true
    if (variant === 'hunter') return false
    return currentUserId === bounty.user_id
  }, [variant, currentUserId, bounty.user_id])

  const animate = () => LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)

  // Parse attachments from bounty
  const attachments: Attachment[] = useMemo(() => {
    if (!bounty.attachments_json) return []
    try {
      const parsed = JSON.parse(bounty.attachments_json)
      return Array.isArray(parsed) ? parsed : []
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
  
  const handleSubmitCompletion = async () => {
    if (proofItems.length === 0) {
      alert('Please attach at least one proof of completion')
      return
    }
    if (!completionMessage.trim()) {
      alert('Please add a message describing your completed work')
      return
    }
    
    try {
      setIsSubmitting(true)
      await completionService.submitCompletion({
        bounty_id: String(bounty.id),
        hunter_id: currentUserId || '',
        message: completionMessage.trim(),
        proof_items: proofItems,
      })
      alert('Your work has been submitted for review!')
      setReviewExpanded(false)
      setPayoutExpanded(true)
    } catch (err) {
      console.error('Error submitting completion:', err)
      alert('Failed to submit completion. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }
  
  const handleAddProof = () => {
    // Mock adding proof - in real implementation would use file picker
    const newProof = {
      id: Date.now().toString(),
      type: 'file' as const,
      name: `proof_${proofItems.length + 1}.jpg`,
      size: 1024 * 500, // 500KB
    }
    setProofItems([...proofItems, newProof])
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
    return STAGES.findIndex(s => s.id === currentStage)
  }, [currentStage])

  return (
    <View>
      <BountyCard
        bounty={bounty}
        currentUserId={currentUserId}
        onPress={() => { animate(); onToggle(); }}
        onEdit={onEdit}
        onDelete={onDelete}
      />
      {expanded && (
        <View style={styles.panel}>
          {/* Compact header row mirroring detail card */}
          <View style={styles.panelHeader}>
            <Text style={styles.panelTitle}>Progress</Text>
            {bounty.is_for_honor ? (
              <View style={styles.honorBadge}><MaterialIcons name="favorite" size={14} color="#052e1b" /><Text style={styles.honorText}>For Honor</Text></View>
            ) : (
              <Text style={styles.amount}>${bounty.amount}</Text>
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
              onToggle={() => setWipExpanded(!wipExpanded)}
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
                  <View style={styles.infoBox}>
                    <MaterialIcons name="info-outline" size={18} color="#6ee7b7" />
                    <Text style={styles.infoText}>
                      Begin work on the bounty; once complete press the next button.
                    </Text>
                  </View>
                  
                  <AttachmentsList attachments={attachments} />
                  
                  <TouchableOpacity
                    style={styles.primaryBtn}
                    onPress={() => setReviewExpanded(!reviewExpanded)}
                  >
                    <Text style={styles.primaryText}>Ready to Submit</Text>
                    <MaterialIcons name="arrow-forward" size={18} color="#fff" />
                  </TouchableOpacity>
                </View>
              )}
            </AnimatedSection>
          )}

          {/* Hunter Review & Verify Section - when ready to submit */}
          {!isOwner && bounty.status === 'in_progress' && (
            <AnimatedSection
              title="Review & Verify"
              expanded={reviewExpanded}
              onToggle={() => setReviewExpanded(!reviewExpanded)}
            >
              <View style={{ gap: 16 }}>
                {/* Timer */}
                <View style={styles.timerContainer}>
                  <Text style={styles.timerLabel}>Time Spent in Review</Text>
                  <Text style={styles.timerValue}>{formatTime(timeElapsed)}</Text>
                  <Text style={styles.timerHint}>Track your time on this task</Text>
                </View>

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
                    style={styles.addFileBtn}
                    onPress={handleAddProof}
                  >
                    <MaterialIcons name="add" size={20} color="#10b981" />
                    <Text style={styles.addFileText}>Add File</Text>
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
                      <Text style={styles.honorText}>
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

          {/* Conversation hint */}
          {!conversation && bounty.status === 'in_progress' && (
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
          hunterId={bounty.accepted_by || ''}
          hunterName="Hunter" // TODO: Get actual hunter name
          bountyAmount={bounty.amount || 0}
          isForHonor={bounty.is_for_honor || false}
          onClose={() => setShowReviewModal(false)}
          onComplete={() => {
            setShowReviewModal(false)
            setHasSubmission(false)
            // Trigger refresh
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
  infoBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(5, 46, 27, 0.35)', padding: 10, borderRadius: 8, marginBottom: 8 },
  infoText: { color: '#d1fae5', fontSize: 12 },
  actionsRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  primaryBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#10b981', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10 },
  primaryText: { color: '#fff', fontWeight: '600' },
  muted: { color: '#a7f3d0', fontSize: 12 },
  honorBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#a7f3d0', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, gap: 4 },
  honorText: { color: '#052e1b', fontWeight: '800', fontSize: 12 },
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
  honorText: {
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
})
