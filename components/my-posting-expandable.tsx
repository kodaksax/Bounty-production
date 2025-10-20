import { MaterialIcons } from '@expo/vector-icons'
import type { Attachment } from 'lib/types'
import type { Bounty } from 'lib/services/database.types'
import { messageService } from 'lib/services/message-service'
import type { Conversation } from 'lib/types'
import React, { useEffect, useMemo, useState } from 'react'
import { LayoutAnimation, Platform, StyleSheet, Text, TouchableOpacity, UIManager, View } from 'react-native'
import { BountyCard } from './bounty-card'
import { AnimatedSection } from './ui/animated-section'
import { AttachmentsList } from './ui/attachments-list'
import { MessageBar } from './ui/message-bar'
import { RatingStars } from './ui/rating-stars'
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

  useEffect(() => {
    let mounted = true
    async function load() {
      try {
        const list = await messageService.getConversations()
        const match = list.find(c => String(c.bountyId) === String(bounty.id)) || null
        if (mounted) setConversation(match)
      } catch {}
    }
    if (expanded) load()
    return () => { mounted = false }
  }, [expanded, bounty.id])

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
                    onPress={() => onGoToReview?.(String(bounty.id))}
                  >
                    <Text style={styles.primaryText}>Next</Text>
                    <MaterialIcons name="arrow-forward" size={18} color="#fff" />
                  </TouchableOpacity>
                </View>
              )}
            </AnimatedSection>
          )}

          {/* Quick actions */}
          <View style={styles.actionsRow}>
            {bounty.status === 'in_progress' ? (
              <TouchableOpacity style={styles.primaryBtn} onPress={() => onGoToReview?.(String(bounty.id))}>
                <Text style={styles.primaryText}>{isOwner ? 'Go to Review & Verify' : 'Open Work In Progress'}</Text>
                <MaterialIcons name="arrow-forward" size={18} color="#fff" />
              </TouchableOpacity>
            ) : bounty.status === 'completed' ? (
              <TouchableOpacity style={styles.primaryBtn} onPress={() => onGoToPayout?.(String(bounty.id))}>
                <Text style={styles.primaryText}>{isOwner ? 'Go to Payout' : 'View Payout Status'}</Text>
                <MaterialIcons name="arrow-forward" size={18} color="#fff" />
              </TouchableOpacity>
            ) : (
              <Text style={styles.muted}>{isOwner ? 'No actions until a request is accepted.' : 'No actions yet. You can start once the poster accepts.'}</Text>
            )}
          </View>

          {/* Conversation hint */}
          {!conversation && (
            <View style={styles.infoBox}>
              <MaterialIcons name="chat-bubble-outline" size={18} color="#6ee7b7" />
              <Text style={styles.infoText}>{isOwner ? 'Conversation will appear after acceptance.' : 'A chat with the poster will appear once you’re accepted.'}</Text>
            </View>
          )}
        </View>
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
})
