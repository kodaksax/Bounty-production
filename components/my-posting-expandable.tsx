import { MaterialIcons } from '@expo/vector-icons'
import type { Bounty } from 'lib/services/database.types'
import { messageService } from 'lib/services/message-service'
import type { Conversation } from 'lib/types'
import React, { useEffect, useMemo, useState } from 'react'
import { LayoutAnimation, Platform, StyleSheet, Text, TouchableOpacity, UIManager, View } from 'react-native'
import { BountyCard } from './bounty-card'

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
}

const STAGES = [
  { id: 'apply_work', label: 'Apply & Work', icon: 'work' },
  { id: 'working_progress', label: 'Working Progress', icon: 'trending-up' },
  { id: 'review_verify', label: 'Review & Verify', icon: 'rate-review' },
  { id: 'payout', label: 'Payout', icon: 'account-balance-wallet' },
] as const

export function MyPostingExpandable({ bounty, currentUserId, expanded, onToggle, onEdit, onDelete, onGoToReview, onGoToPayout }: Props) {
  const [conversation, setConversation] = useState<Conversation | null>(null)

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

  const animate = () => LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)

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

          {/* Timeline bubbles */}
          <View style={styles.timelineRow}>
            {STAGES.map((s, idx) => {
              const isActive = s.id === currentStage
              const isCompleted = STAGES.findIndex(x => x.id === s.id) < STAGES.findIndex(x => x.id === currentStage)
              return (
                <View key={s.id} style={styles.timelineItem}>
                  <View style={[styles.bubble, isCompleted ? styles.bubbleCompleted : isActive ? styles.bubbleActive : styles.bubbleIdle]} />
                  {idx < STAGES.length - 1 && <View style={styles.connector} />}
                </View>
              )
            })}
          </View>

          {/* Pre-acceptance info when open */}
          {bounty.status === 'open' && (
            <View style={styles.infoBox}>
              <MaterialIcons name="hourglass-empty" size={18} color="#6ee7b7" />
              <Text style={styles.infoText}>Awaiting a hunter. Review requests in the Requests tab.</Text>
            </View>
          )}

          {/* Quick actions */}
          <View style={styles.actionsRow}>
            {bounty.status === 'in_progress' ? (
              <TouchableOpacity style={styles.primaryBtn} onPress={() => onGoToReview?.(String(bounty.id))}>
                <Text style={styles.primaryText}>Go to Review & Verify</Text>
                <MaterialIcons name="arrow-forward" size={18} color="#fff" />
              </TouchableOpacity>
            ) : bounty.status === 'completed' ? (
              <TouchableOpacity style={styles.primaryBtn} onPress={() => onGoToPayout?.(String(bounty.id))}>
                <Text style={styles.primaryText}>Go to Payout</Text>
                <MaterialIcons name="arrow-forward" size={18} color="#fff" />
              </TouchableOpacity>
            ) : (
              <Text style={styles.muted}>No actions until a request is accepted.</Text>
            )}
          </View>

          {/* Conversation hint */}
          {!conversation && (
            <View style={styles.infoBox}>
              <MaterialIcons name="chat-bubble-outline" size={18} color="#6ee7b7" />
              <Text style={styles.infoText}>Conversation will appear after acceptance.</Text>
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
