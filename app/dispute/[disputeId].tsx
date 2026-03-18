import { MaterialIcons } from '@expo/vector-icons'
import { useLocalSearchParams, useRouter } from 'expo-router'
import React, { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useAttachmentUpload } from '../../hooks/use-attachment-upload'
import { disputeService } from '../../lib/services/dispute-service'
import { userProfileService } from '../../lib/services/userProfile'
import type { BountyDispute } from '../../lib/types'
import { getCurrentUserId } from '../../lib/utils/data-utils'
import { getDisputeStatusColor, getDisputeStatusIcon } from '../../lib/utils/dispute-helpers'

type CommentItem = {
  id: string
  userId: string
  username?: string
  comment: string
  isInternal: boolean
  createdAt: string
}

type EvidenceItem = {
  id: string
  uploadedBy: string
  uploaderName?: string
  type: string
  content: string
  description?: string
  createdAt: string
}

export default function DisputeDetailScreen() {
  const { disputeId } = useLocalSearchParams<{ disputeId: string }>()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const currentUserId = getCurrentUserId()

  const [dispute, setDispute] = useState<BountyDispute | null>(null)
  const [comments, setComments] = useState<CommentItem[]>([])
  const [evidence, setEvidence] = useState<EvidenceItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [newComment, setNewComment] = useState('')
  const [isSendingComment, setIsSendingComment] = useState(false)
  const [activeTab, setActiveTab] = useState<'comments' | 'evidence'>('comments')
  const [textEvidence, setTextEvidence] = useState('')

  const { pickAttachment } = useAttachmentUpload({
    bucket: 'bounty-attachments',
    folder: `disputes/${disputeId}`,
    maxSizeMB: 10,
    allowsMultiple: false,
    onUploaded: async (attachment) => {
      if (!disputeId || !currentUserId) return
      const success = await disputeService.uploadEvidence(disputeId, currentUserId, {
        type: attachment.mimeType?.startsWith('image/') ? 'image' : 'document',
        content: attachment.remoteUri || attachment.uri,
        description: attachment.name,
        mimeType: attachment.mimeType,
        fileSize: attachment.size,
      })
      if (success) {
        loadEvidence()
        Alert.alert('Evidence Added', 'Your evidence has been uploaded.')
      }
    },
    onError: (error) => {
      Alert.alert('Upload Error', error.message)
    },
  })

  const loadDispute = useCallback(async () => {
    if (!disputeId) return
    try {
      const d = await disputeService.getDisputeById(disputeId)
      setDispute(d)
    } catch (err) {
      console.error('Error loading dispute:', err)
    }
  }, [disputeId])

  const loadComments = useCallback(async () => {
    if (!disputeId) return
    try {
      const rawComments = await disputeService.getDisputeComments(disputeId)
      // Enrich with usernames
      const enriched: CommentItem[] = await Promise.all(
        (rawComments || []).map(async (c: any) => {
          let username = 'User'
          try {
            const profile = await userProfileService.getProfile(c.user_id)
            username = profile?.username || 'User'
          } catch { }
          return {
            id: c.id,
            userId: c.user_id,
            username,
            comment: c.comment,
            isInternal: c.is_internal,
            createdAt: c.created_at,
          }
        })
      )
      setComments(enriched)
    } catch (err) {
      console.error('Error loading comments:', err)
    }
  }, [disputeId])

  const loadEvidence = useCallback(async () => {
    if (!disputeId) return
    try {
      const rawEvidence = await disputeService.getDisputeEvidence(disputeId)
      const enriched: EvidenceItem[] = await Promise.all(
        (rawEvidence || []).map(async (e: any) => {
          let uploaderName = 'User'
          try {
            const profile = await userProfileService.getProfile(e.uploaded_by)
            uploaderName = profile?.username || 'User'
          } catch { }
          return {
            id: e.id,
            uploadedBy: e.uploaded_by,
            uploaderName,
            type: e.type,
            content: e.content,
            description: e.description,
            createdAt: e.created_at,
          }
        })
      )
      setEvidence(enriched)
    } catch (err) {
      console.error('Error loading evidence:', err)
    }
  }, [disputeId])

  useEffect(() => {
    async function load() {
      setIsLoading(true)
      await Promise.all([loadDispute(), loadComments(), loadEvidence()])
      setIsLoading(false)
    }
    load()
  }, [loadDispute, loadComments, loadEvidence])

  const handleSendComment = async () => {
    if (!newComment.trim() || !disputeId || !currentUserId) return
    try {
      setIsSendingComment(true)
      const success = await disputeService.addComment(
        disputeId,
        currentUserId,
        newComment.trim(),
        false
      )
      if (success) {
        setNewComment('')
        await loadComments()
      } else {
        Alert.alert('Error', 'Failed to send comment.')
      }
    } catch (err) {
      Alert.alert('Error', 'Failed to send comment.')
    } finally {
      setIsSendingComment(false)
    }
  }

  const handleAddTextEvidence = async () => {
    if (!textEvidence.trim() || !disputeId || !currentUserId) return
    try {
      const success = await disputeService.uploadEvidence(disputeId, currentUserId, {
        type: 'text',
        content: textEvidence.trim(),
        description: 'Written statement',
      })
      if (success) {
        setTextEvidence('')
        await loadEvidence()
        Alert.alert('Evidence Added', 'Your written statement has been submitted.')
      }
    } catch (err) {
      Alert.alert('Error', 'Failed to add evidence.')
    }
  }

  const handleEscalate = async () => {
    if (!disputeId) return
    Alert.alert(
      'Request Escalation',
      'This will flag the dispute for priority admin review. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Escalate',
          onPress: async () => {
            try {
              await disputeService.updateDisputeStatus(disputeId, 'under_review')
              await loadDispute()
              Alert.alert('Escalated', 'Your dispute has been flagged for priority review.')
            } catch (err) {
              Alert.alert('Error', 'Failed to escalate.')
            }
          },
        },
      ]
    )
  }

  const relativeTime = (iso: string) => {
    try {
      const delta = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
      if (delta < 60) return 'just now'
      if (delta < 3600) return `${Math.floor(delta / 60)}m ago`
      if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`
      return `${Math.floor(delta / 86400)}d ago`
    } catch {
      return ''
    }
  }

  // Check if dispute has been open long enough to escalate (3+ days)
  const canEscalate = dispute && !dispute.escalated &&
    dispute.status === 'open' &&
    (Date.now() - new Date(dispute.createdAt).getTime()) > 3 * 24 * 60 * 60 * 1000

  if (isLoading) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#6ee7b7" />
          <Text style={styles.loadingText}>Loading dispute...</Text>
        </View>
      </View>
    )
  }

  if (!dispute) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.errorContainer}>
          <MaterialIcons name="error-outline" size={48} color="#ef4444" />
          <Text style={styles.errorText}>Dispute not found</Text>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <Text style={styles.backBtnText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    )
  }

  const isResolved = dispute.status === 'resolved' || dispute.status === 'closed'
  const statusColor = getDisputeStatusColor(dispute.status)
  const statusIcon = getDisputeStatusIcon(dispute.status)
  const stageLabel = dispute.disputeStage === 'in_progress' ? 'Work In Progress' :
    dispute.disputeStage === 'review_verify' ? 'Review & Verify' : 'Cancellation'
  const isParticipant = currentUserId === dispute.initiatorId || currentUserId === dispute.respondentId

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={{ padding: 4 }}>
          <MaterialIcons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Dispute Details</Text>
        <View style={[styles.statusBadge, { backgroundColor: statusColor + '30' }]}>
          <MaterialIcons name={statusIcon as any} size={14} color={statusColor} />
          <Text style={[styles.statusText, { color: statusColor }]}>{dispute.status.replace('_', ' ')}</Text>
        </View>
      </View>

      {/* Dispute info */}
      <View style={styles.disputeInfo}>
        <View style={styles.stageTag}>
          <MaterialIcons name="label" size={14} color="#f59e0b" />
          <Text style={styles.stageTagText}>Stage: {stageLabel}</Text>
        </View>
        <Text style={styles.reasonLabel}>Reason</Text>
        <Text style={styles.reasonText}>{dispute.reason}</Text>
        <Text style={styles.timeText}>Opened {relativeTime(dispute.createdAt)}</Text>
      </View>

      {/* Resolution banner */}
      {isResolved && dispute.resolution && (
        <View style={styles.resolutionBanner}>
          <MaterialIcons name="check-circle" size={20} color="#10b981" />
          <View style={{ flex: 1 }}>
            <Text style={styles.resolutionTitle}>Resolution</Text>
            <Text style={styles.resolutionText}>{dispute.resolution}</Text>
            {dispute.winner && (
              <Text style={styles.resolutionWinner}>
                Decided in favor of: {dispute.winner}
              </Text>
            )}
          </View>
        </View>
      )}

      {/* Escalation option */}
      {canEscalate && isParticipant && (
        <TouchableOpacity style={styles.escalateBtn} onPress={handleEscalate}>
          <MaterialIcons name="priority-high" size={18} color="#f59e0b" />
          <Text style={styles.escalateBtnText}>Request Escalation</Text>
        </TouchableOpacity>
      )}

      {/* Tabs */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'comments' && styles.tabActive]}
          onPress={() => setActiveTab('comments')}
        >
          <MaterialIcons name="chat" size={18} color={activeTab === 'comments' ? '#10b981' : '#6ee7b7'} />
          <Text style={[styles.tabText, activeTab === 'comments' && styles.tabTextActive]}>
            Messages ({comments.length})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'evidence' && styles.tabActive]}
          onPress={() => setActiveTab('evidence')}
        >
          <MaterialIcons name="folder" size={18} color={activeTab === 'evidence' ? '#10b981' : '#6ee7b7'} />
          <Text style={[styles.tabText, activeTab === 'evidence' && styles.tabTextActive]}>
            Evidence ({evidence.length})
          </Text>
        </TouchableOpacity>
      </View>

      {/* Content */}
      {activeTab === 'comments' ? (
        <>
          <FlatList
            data={comments}
            keyExtractor={(item) => item.id}
            style={styles.list}
            contentContainerStyle={{ paddingBottom: 16, paddingHorizontal: 16 }}
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <MaterialIcons name="chat-bubble-outline" size={40} color="rgba(110,231,183,0.3)" />
                <Text style={styles.emptyText}>No messages yet. Start the conversation.</Text>
              </View>
            }
            renderItem={({ item }) => {
              const isMe = item.userId === currentUserId
              return (
                <View style={[styles.commentBubble, isMe && styles.commentBubbleMine]}>
                  <View style={styles.commentHeader}>
                    <Text style={styles.commentUsername}>
                      {isMe ? 'You' : item.username}
                    </Text>
                    <Text style={styles.commentTime}>{relativeTime(item.createdAt)}</Text>
                  </View>
                  <Text style={styles.commentText}>{item.comment}</Text>
                </View>
              )
            }}
          />
          {/* Comment input */}
          {!isResolved && isParticipant && (
            <View style={[styles.commentInputBar, { paddingBottom: insets.bottom + 8 }]}>
              <TextInput
                style={styles.commentInput}
                placeholder="Type a message..."
                placeholderTextColor="rgba(255,254,245,0.4)"
                value={newComment}
                onChangeText={setNewComment}
                multiline
                maxLength={2000}
              />
              <TouchableOpacity
                style={[styles.sendBtn, (!newComment.trim() || isSendingComment) && styles.sendBtnDisabled]}
                onPress={handleSendComment}
                disabled={!newComment.trim() || isSendingComment}
              >
                {isSendingComment ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <MaterialIcons name="send" size={20} color="#fff" />
                )}
              </TouchableOpacity>
            </View>
          )}
        </>
      ) : (
        <>
          <FlatList
            data={evidence}
            keyExtractor={(item) => item.id}
            style={styles.list}
            contentContainerStyle={{ paddingBottom: 16, paddingHorizontal: 16 }}
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <MaterialIcons name="folder-open" size={40} color="rgba(110,231,183,0.3)" />
                <Text style={styles.emptyText}>No evidence submitted yet.</Text>
              </View>
            }
            ListFooterComponent={
              !isResolved && isParticipant ? (
                <View style={styles.addEvidenceSection}>
                  <Text style={styles.addEvidenceTitle}>Add Evidence</Text>
                  <View style={styles.evidenceInputRow}>
                    <TextInput
                      style={[styles.commentInput, { flex: 1 }]}
                      placeholder="Written statement..."
                      placeholderTextColor="rgba(255,254,245,0.4)"
                      value={textEvidence}
                      onChangeText={setTextEvidence}
                    />
                    <TouchableOpacity
                      style={[styles.sendBtn, !textEvidence.trim() && styles.sendBtnDisabled]}
                      onPress={handleAddTextEvidence}
                      disabled={!textEvidence.trim()}
                    >
                      <MaterialIcons name="add" size={20} color="#fff" />
                    </TouchableOpacity>
                  </View>
                  <TouchableOpacity style={styles.uploadBtn} onPress={() => pickAttachment()}>
                    <MaterialIcons name="attach-file" size={18} color="#6ee7b7" />
                    <Text style={styles.uploadBtnText}>Upload File</Text>
                  </TouchableOpacity>
                </View>
              ) : null
            }
            renderItem={({ item }) => (
              <View style={styles.evidenceCard}>
                <View style={styles.evidenceHeader}>
                  <MaterialIcons
                    name={
                      item.type === 'text' ? 'text-snippet' :
                      item.type === 'link' ? 'link' :
                      item.type === 'image' ? 'image' : 'insert-drive-file'
                    }
                    size={20}
                    color="#6ee7b7"
                  />
                  <Text style={styles.evidenceUploader}>{item.uploaderName}</Text>
                  <Text style={styles.evidenceTime}>{relativeTime(item.createdAt)}</Text>
                </View>
                <Text style={styles.evidenceContent} numberOfLines={4}>
                  {item.type === 'text' ? item.content : item.description || item.content}
                </Text>
              </View>
            )}
          />
        </>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a3d2e',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    color: '#6ee7b7',
    fontSize: 14,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  errorText: {
    color: '#ef4444',
    fontSize: 16,
  },
  backBtn: {
    backgroundColor: '#10b981',
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
  },
  backBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(110, 231, 183, 0.1)',
  },
  headerTitle: {
    flex: 1,
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  disputeInfo: {
    padding: 16,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(110, 231, 183, 0.1)',
  },
  stageTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  stageTagText: {
    color: '#f59e0b',
    fontSize: 11,
    fontWeight: '600',
  },
  reasonLabel: {
    color: '#6ee7b7',
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  reasonText: {
    color: '#fff',
    fontSize: 14,
    lineHeight: 20,
  },
  timeText: {
    color: 'rgba(255,254,245,0.5)',
    fontSize: 12,
  },
  resolutionBanner: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    margin: 16,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  resolutionTitle: {
    color: '#10b981',
    fontSize: 13,
    fontWeight: '700',
  },
  resolutionText: {
    color: 'rgba(255,254,245,0.8)',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
  },
  resolutionWinner: {
    color: '#6ee7b7',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 6,
  },
  escalateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 10,
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.3)',
  },
  escalateBtnText: {
    color: '#f59e0b',
    fontSize: 13,
    fontWeight: '600',
  },
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(110, 231, 183, 0.1)',
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
  },
  tabActive: {
    borderBottomWidth: 2,
    borderBottomColor: '#10b981',
  },
  tabText: {
    color: '#6ee7b7',
    fontSize: 13,
    fontWeight: '500',
  },
  tabTextActive: {
    color: '#10b981',
    fontWeight: '700',
  },
  list: {
    flex: 1,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 48,
    gap: 12,
  },
  emptyText: {
    color: 'rgba(255,254,245,0.5)',
    fontSize: 14,
  },
  commentBubble: {
    backgroundColor: 'rgba(5, 150, 105, 0.15)',
    borderRadius: 12,
    padding: 12,
    marginTop: 8,
    borderWidth: 1,
    borderColor: 'rgba(110, 231, 183, 0.1)',
  },
  commentBubbleMine: {
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  commentHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  commentUsername: {
    color: '#6ee7b7',
    fontSize: 12,
    fontWeight: '600',
  },
  commentTime: {
    color: 'rgba(255,254,245,0.4)',
    fontSize: 11,
  },
  commentText: {
    color: '#fff',
    fontSize: 14,
    lineHeight: 20,
  },
  commentInputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(110, 231, 183, 0.1)',
    backgroundColor: '#1a3d2e',
  },
  commentInput: {
    flex: 1,
    backgroundColor: 'rgba(5, 150, 105, 0.2)',
    borderRadius: 10,
    padding: 10,
    color: '#fff',
    fontSize: 14,
    maxHeight: 100,
    borderWidth: 1,
    borderColor: 'rgba(110, 231, 183, 0.2)',
  },
  sendBtn: {
    backgroundColor: '#10b981',
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendBtnDisabled: {
    backgroundColor: 'rgba(16, 185, 129, 0.3)',
  },
  addEvidenceSection: {
    gap: 10,
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(110, 231, 183, 0.1)',
  },
  addEvidenceTitle: {
    color: '#6ee7b7',
    fontSize: 13,
    fontWeight: '600',
  },
  evidenceInputRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  uploadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: 10,
    backgroundColor: 'rgba(5, 150, 105, 0.2)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(110, 231, 183, 0.2)',
    borderStyle: 'dashed',
  },
  uploadBtnText: {
    color: '#6ee7b7',
    fontSize: 13,
  },
  evidenceCard: {
    backgroundColor: 'rgba(5, 150, 105, 0.15)',
    borderRadius: 10,
    padding: 12,
    marginTop: 8,
    gap: 6,
    borderWidth: 1,
    borderColor: 'rgba(110, 231, 183, 0.1)',
  },
  evidenceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  evidenceUploader: {
    flex: 1,
    color: '#6ee7b7',
    fontSize: 12,
    fontWeight: '600',
  },
  evidenceTime: {
    color: 'rgba(255,254,245,0.4)',
    fontSize: 11,
  },
  evidenceContent: {
    color: 'rgba(255,254,245,0.8)',
    fontSize: 13,
    lineHeight: 18,
  },
})
