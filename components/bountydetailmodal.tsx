import MaterialIcons from "@expo/vector-icons/MaterialIcons"
import { Avatar, AvatarFallback, AvatarImage } from "components/ui/avatar"
import * as Linking from 'expo-linking'
import { useRouter } from "expo-router"
import React, { useEffect, useRef, useState } from "react"
import {
    ActivityIndicator,
    Alert,
    Dimensions,
    Modal,
    Platform,
    ScrollView,
    Share,
    StyleSheet,
    Text,
    TouchableOpacity,
    View
} from "react-native"
import { useAuthContext } from "../hooks/use-auth-context"
import { useNormalizedProfile } from '../hooks/useNormalizedProfile'
import { ROUTES } from '../lib/routes'
import { bountyRequestService } from "../lib/services/bounty-request-service"
import type { AttachmentMeta } from '../lib/services/database.types'
import { messageService } from "../lib/services/message-service"
import type { Message } from '../lib/types'
import { getCurrentUserId } from "../lib/utils/data-utils"
import { ReportModal } from "./ReportModal"

// Type for detail rows in Additional Details section
interface DetailRow {
  icon: 'schedule' | 'build' | 'place' | 'access-time';
  color: string;
  label: string;
  value: string;
  urgent?: boolean;
}

interface BountyDetailModalProps {
  bounty: {
    id: number
    username?: string
    title: string
    price: number
    distance: number | null
    description?: string
    user_id?: string
  poster_id?: string
    work_type?: 'online' | 'in_person'
    attachments?: AttachmentMeta[]
    attachments_json?: string
    poster_avatar?: string
    timeline?: string
    skills_required?: string
    location?: string
    is_time_sensitive?: boolean
    deadline?: string
    status?: string
  }
  onClose: () => void
  onNavigateToChat?: (conversationId: string) => void
}

export function BountyDetailModal({ bounty, onClose, onNavigateToChat }: BountyDetailModalProps) {
  const router = useRouter()
  const { isEmailVerified } = useAuthContext()
  const [messages, setMessages] = useState<Message[]>([])
  const [newMessage, setNewMessage] = useState("")
  const [isClosing, setIsClosing] = useState(false)
  const [isApplying, setIsApplying] = useState(false)
  const [hasApplied, setHasApplied] = useState(false)
  const [isCreatingChat, setIsCreatingChat] = useState(false)
  const [showReportModal, setShowReportModal] = useState(false)
  const messagesEndRef = useRef<ScrollView>(null)
  const modalRef = useRef<View>(null)
  const currentUserId = getCurrentUserId()

  // Resolve poster identity - prefer poster_id, fall back to user_id for compatibility
  const [displayUsername, setDisplayUsername] = useState<string>(bounty.username || 'Loading...')
  const posterId = bounty.poster_id || bounty.user_id
  const { profile: normalizedPoster, loading: profileLoading } = useNormalizedProfile(posterId)
  const [actualAttachments, setActualAttachments] = useState<AttachmentMeta[]>([])

  useEffect(() => {
    // Resolution priority: bounty.username -> normalizedPoster.username -> 'Loading...' -> 'Unknown Poster'
    // Never fall back to the current user's profile
    if (bounty.username) {
      setDisplayUsername(bounty.username)
      return
    }

    if (normalizedPoster?.username) {
      setDisplayUsername(normalizedPoster.username)
      return
    }

    // Show 'Unknown Poster' only if we're done loading and still no username
    if (!profileLoading) {
      // Debug: log when we can't resolve a username
      if (posterId) {
        console.log('[BountyDetailModal] Could not resolve username for poster_id:', posterId, 'Profile:', normalizedPoster)
      }
      setDisplayUsername('Unknown Poster')
    } else {
      setDisplayUsername('Loading...')
    }
  }, [bounty.username, normalizedPoster?.username, profileLoading, bounty.user_id, normalizedPoster])

  // Parse and load attachments
  useEffect(() => {
    let mounted = true
    const loadAttachments = () => {
      try {
        // Priority: explicit attachments prop, then parse from attachments_json
        if (bounty.attachments && bounty.attachments.length > 0) {
          if (mounted) setActualAttachments(bounty.attachments)
          return
        }

        if (bounty.attachments_json) {
          const parsed = JSON.parse(bounty.attachments_json) as AttachmentMeta[]
          if (mounted) setActualAttachments(parsed || [])
          return
        }

        // No attachments
        if (mounted) setActualAttachments([])
      } catch (error) {
        console.error('Error parsing attachments:', error)
        if (mounted) setActualAttachments([])
      }
    }

    loadAttachments()
    return () => { mounted = false }
  }, [bounty.attachments, bounty.attachments_json])

  // Sample description if not provided
  const description =
    bounty.description ||
    "I need someone to mow my lawn. The yard is approximately 1/4 acre with some slopes. I have a lawn mower you can use, or you can bring your own equipment. The grass is about 3 inches tall now. Please trim around the edges and clean up afterward. This should take about 2 hours to complete. I need this done by this weekend."

  // Handle Share button
  const handleShare = async () => {
    try {
      const shareMessage = `Check out this bounty: ${bounty.title}\nAmount: $${bounty.price}\n\nView on BountyExpo: bountyexpo://bounties/${bounty.id}`;
      
      if (Platform.OS === 'web') {
        // On web, copy to clipboard
        const link = `https://bountyexpo.app/bounties/${bounty.id}`;
        if (typeof navigator !== 'undefined' && navigator.clipboard) {
          await navigator.clipboard.writeText(link);
          Alert.alert('Link Copied', 'Bounty link copied to clipboard!');
        } else {
          // Fallback: show link in alert
          Alert.alert('Share Link', link);
        }
      } else {
        // On mobile, use native share
        await Share.share({
          message: shareMessage,
          title: bounty.title,
        });
      }
    } catch (error) {
      console.error('Error sharing bounty:', error);
      Alert.alert('Error', 'Failed to share bounty. Please try again.');
    }
  };

  // Handle Report button
  const handleReport = () => {
    setShowReportModal(true);
  };

  // Handle attachment open
  const handleAttachmentOpen = async (attachment: AttachmentMeta) => {
    try {
      const uri = attachment.remoteUri || attachment.uri;
      if (!uri) {
        Alert.alert('Error', 'Attachment not available');
        return;
      }

      const canOpen = await Linking.canOpenURL(uri);
      if (canOpen) {
        await Linking.openURL(uri);
      } else {
        Alert.alert('Error', 'Cannot open this attachment');
      }
    } catch (error) {
      console.error('Error opening attachment:', error);
      Alert.alert('Error', 'Failed to open attachment');
    }
  };

  // Handle close animation
  const handleClose = () => {
    setIsClosing(true)
    setTimeout(() => {
      onClose()
    }, 300)
  }

  // Handle message poster button
  const handleMessagePoster = async () => {
    if (!bounty.user_id || !currentUserId) {
      Alert.alert('Error', 'Unable to start conversation.')
      return
    }

    // Check if trying to message yourself
    if (bounty.user_id === currentUserId) {
      Alert.alert('Cannot Message', 'You cannot message yourself.')
      return
    }

    setIsCreatingChat(true)
    try {
      // Create or get existing conversation
      const conversation = await messageService.getOrCreateConversation(
        [bounty.user_id],
        displayUsername,
        bounty.id.toString()
      )

      console.log('✅ Conversation created/retrieved:', conversation.id)
      
      // Close the modal and navigate to chat
      handleClose()
      
      // Use the callback if provided, otherwise navigate directly
      if (onNavigateToChat) {
        onNavigateToChat(conversation.id)
      } else {
    // Fallback: navigate to messenger (the parent will need to handle showing the conversation)
  router.push(ROUTES.TABS.MESSENGER as any)
      }
    } catch (error) {
      console.error('Error creating conversation:', error)
      Alert.alert('Error', 'Failed to start conversation. Please try again.')
    } finally {
      setIsCreatingChat(false)
    }
  }

  // Check if user has already applied
  useEffect(() => {
    const checkApplicationStatus = async () => {
      if (!currentUserId || !bounty.id) return
      
      try {
        const requests = await bountyRequestService.getAll({
          bountyId: bounty.id,
          userId: currentUserId,
        })
        setHasApplied(requests.length > 0)
      } catch (error) {
        console.error('Error checking application status:', error)
      }
    }
    
    checkApplicationStatus()
  }, [bounty.id, currentUserId])

  // Handle apply for bounty
  const handleApplyForBounty = async () => {
    // Email verification gate: Block applying if email is not verified
    if (!isEmailVerified) {
      Alert.alert(
        'Email verification required',
        "Please verify your email to apply for bounties. We've sent a verification link to your inbox.",
        [
          { text: 'OK', style: 'default' }
        ]
      )
      return
    }
    
    if (!currentUserId || !bounty.id) {
      Alert.alert('Error', 'Unable to apply. Please try again.')
      return
    }

    // Check if user is trying to apply to their own bounty
    if (posterId === currentUserId) {
      Alert.alert('Cannot Apply', 'You cannot apply to your own bounty.')
      return
    }

    // Check if bounty is already taken
    if (bounty.status === 'in_progress' || bounty.status === 'completed') {
      Alert.alert('Bounty Already Taken', 'This bounty has already been accepted by another hunter.')
      return
    }

    setIsApplying(true)
    try {
      const request = await bountyRequestService.create({
        bounty_id: bounty.id,
        hunter_id: currentUserId,
        status: 'pending',
        poster_id: posterId,
      })

      if (request) {
        setHasApplied(true)
        
        // Send notification to poster about the application
        try {
          const API_BASE = process.env.EXPO_PUBLIC_API_BASE_URL || 'http://localhost:3001'
          await fetch(`${API_BASE}/api/notifications`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              user_id: posterId,
              type: 'application',
              title: 'New Bounty Application',
              body: `Someone applied for your bounty: ${bounty.title}`,
              data: {
                bountyId: bounty.id,
                hunterId: currentUserId,
              }
            })
          })
        } catch (notifError) {
          console.error('Failed to send application notification:', notifError)
          // Don't block the flow if notification fails
        }
        
        Alert.alert(
          'Application Submitted',
          'Your application has been submitted. The bounty poster will review it soon.',
          [
            {
              text: 'View In Progress',
              onPress: () => {
                handleClose()
                router.push(`/in-progress/${bounty.id}/hunter`)
              },
            },
            { text: 'OK' },
          ]
        )
      } else {
        Alert.alert('Error', 'Failed to submit application. Please try again.')
      }
    } catch (error) {
      console.error('Error applying for bounty:', error)
      Alert.alert('Error', 'An error occurred while submitting your application.')
    } finally {
      setIsApplying(false)
    }
  }

  const { width, height } = Dimensions.get('window')

  return (
    <Modal
      visible={true}
      animationType="slide"
      presentationStyle="overFullScreen"
      transparent
      onRequestClose={handleClose}
    >
      <View style={styles.overlay}>
        {/* Shadow wrapper (no overflow) */}
        <View
          style={[
            styles.cardShadow,
            { width: width - 35, maxWidth: 560, height: Math.min(height * 0.9, 760) }
          ]}
        >
          {/* Rounded card (clips children) */}
          <View style={styles.card}>
        {/* Header - iPhone optimized */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <MaterialIcons name="place" size={20} color="white" />
            <Text style={styles.headerTitle}>BOUNTY</Text>
          </View>
          <View style={styles.headerActions}>
            <TouchableOpacity onPress={handleShare} style={styles.iconButton} accessibilityRole="button" accessibilityLabel="Share bounty">
              <MaterialIcons name="share" size={20} color="white" />
            </TouchableOpacity>
            <TouchableOpacity onPress={handleReport} style={styles.iconButton} accessibilityRole="button" accessibilityLabel="Report bounty">
              <MaterialIcons name="report" size={20} color="white" />
            </TouchableOpacity>
            <TouchableOpacity onPress={handleClose} style={styles.closeButton} accessibilityRole="button" accessibilityLabel="Close">
              <MaterialIcons name="close" size={20} color="white" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Bounty Details - Scrollable content */}
        <ScrollView
          ref={messagesEndRef}
          style={styles.scrollContainer}
          contentContainerStyle={styles.scrollContent}
        >
          <View style={styles.bountyCard}>
            <View style={styles.cardContent}>
              {/* User info - Clickable to navigate to profile */}
              <TouchableOpacity 
                style={styles.userInfo}
                onPress={() => {
                  if (posterId) {
                    router.push(`/profile/${posterId}`)
                  }
                }}
                disabled={!posterId}
              >
                <Avatar style={styles.avatar}>
                  <AvatarImage src={bounty.poster_avatar || normalizedPoster?.avatar || "/placeholder.svg?height=40&width=40"} alt={displayUsername} />
                  <AvatarFallback style={styles.avatarFallback}>
                    <Text style={styles.avatarText}>
                      {displayUsername.substring(0, 2).toUpperCase()}
                    </Text>
                  </AvatarFallback>
                </Avatar>
                <View style={styles.userTextInfo}>
                  <Text style={styles.username}>{displayUsername}</Text>
                  <Text style={styles.postTime}>Posted 2h ago</Text>
                </View>
                {posterId && (
                  <MaterialIcons name="chevron-right" size={20} color="#a7f3d0" style={{ marginLeft: 'auto' }} />
                )}
              </TouchableOpacity>

              {/* Title */}
              <Text style={styles.title}>{bounty.title}</Text>

              {/* Price and distance / Online badge */}
              <View style={styles.priceDistanceContainer}>
                <View style={styles.priceContainer}>
                  <Text style={styles.priceText}>${bounty.price}</Text>
                </View>
                {bounty.work_type === 'online' ? (
                  <View style={styles.onlineBadge}>
                    <MaterialIcons name="wifi" size={14} color="#10b981" />
                    <Text style={styles.onlineText}>Online</Text>
                  </View>
                ) : bounty.distance === null ? (
                  <Text style={styles.distanceText}>Location TBD</Text>
                ) : (
                  <Text style={styles.distanceText}>{bounty.distance} mi away</Text>
                )}
              </View>

              {/* Description */}
              <View style={styles.descriptionContainer}>
                <Text style={styles.sectionHeader}>Description</Text>
                <Text style={styles.descriptionText}>{description}</Text>
              </View>

              {/* Additional Details - Timeline, Skills, Location, Deadline */}
              {(bounty.timeline || bounty.skills_required || bounty.location || bounty.deadline) && (
                <View style={styles.additionalDetailsContainer}>
                  <Text style={styles.sectionHeader}>Additional Details</Text>
                  
                  {([
                    bounty.timeline && {
                      icon: 'schedule' as const,
                      color: '#a7f3d0',
                      label: 'Timeline',
                      value: bounty.timeline,
                    },
                    bounty.skills_required && {
                      icon: 'build' as const,
                      color: '#a7f3d0',
                      label: 'Skills Required',
                      value: bounty.skills_required,
                    },
                    bounty.location && bounty.work_type !== 'online' && {
                      icon: 'place' as const,
                      color: '#a7f3d0',
                      label: 'Location',
                      value: bounty.location,
                    },
                    bounty.is_time_sensitive && bounty.deadline && {
                      icon: 'access-time' as const,
                      color: '#fbbf24',
                      label: '⚡ Deadline',
                      value: bounty.deadline,
                      urgent: true,
                    },
                  ].filter(Boolean) as DetailRow[]).map((detail, index, array) => (
                    <View key={index} style={[styles.detailRow, index === array.length - 1 && { marginBottom: 0 }]}>
                      <MaterialIcons name={detail.icon} size={16} color={detail.color} />
                      <View style={styles.detailContent}>
                        <Text style={[styles.detailLabel, detail.urgent && { color: '#fbbf24' }]}>
                          {detail.label}
                        </Text>
                        <Text style={[styles.detailValue, detail.urgent && { color: '#fbbf24', fontWeight: '600' }]}>
                          {detail.value}
                        </Text>
                      </View>
                    </View>
                  ))}
                </View>
              )}

              {/* Attachments */}
              {actualAttachments.length > 0 && (
                <View style={styles.attachmentsSection}>
                  <Text style={styles.sectionHeader}>Attachments</Text>
                  <View style={styles.attachmentsContainer}>
                    {actualAttachments.map((attachment) => {
                      const isImage = attachment.mimeType?.startsWith('image/') || attachment.name.match(/\.(jpg|jpeg|png|gif|webp)$/i);
                      const sizeInMB = attachment.size ? (attachment.size / (1024 * 1024)).toFixed(1) : 'Unknown';
                      
                      return (
                        <TouchableOpacity
                          key={attachment.id}
                          style={styles.attachmentItem}
                          onPress={() => handleAttachmentOpen(attachment)}
                        >
                          <View style={styles.attachmentIcon}>
                            {isImage ? (
                              <MaterialIcons name="image" size={20} color="#a7f3d0" />
                            ) : (
                              <MaterialIcons name="description" size={20} color="#a7f3d0" />
                            )}
                          </View>
                          <View style={styles.attachmentInfo}>
                            <Text style={styles.attachmentName}>{attachment.name}</Text>
                            <Text style={styles.attachmentSize}>
                              {attachment.size ? `${sizeInMB} MB` : 'Unknown size'}
                            </Text>
                          </View>
                          <View style={styles.downloadButton}>
                            <MaterialIcons name="arrow-forward" size={16} color="#a7f3d0" />
                          </View>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              )}
            </View>
          </View>

          {/* Contact Section */}
          {posterId && posterId !== currentUserId && (
            <View style={styles.contactContainer}>
              <Text style={styles.sectionHeader}>Contact</Text>
              <TouchableOpacity 
                style={styles.messageButton}
                onPress={handleMessagePoster}
                disabled={isCreatingChat}
              >
                {isCreatingChat ? (
                  <ActivityIndicator size="small" color="#065f46" />
                ) : (
                  <>
                    <MaterialIcons name="chat" size={20} color="#065f46" />
                    <Text style={styles.messageButtonText}>Message {displayUsername}</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>

        {/* Accept Bounty Button - With safe area inset */}
        <View style={styles.actionContainer}>
          <TouchableOpacity 
            style={[
              styles.acceptButton,
              (hasApplied || isApplying) && styles.acceptButtonDisabled
            ]}
            onPress={handleApplyForBounty}
            disabled={hasApplied || isApplying}
          >
            {isApplying ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.acceptButtonText}>
                {hasApplied ? 'Application Submitted' : 'Apply for Bounty'}
              </Text>
            )}
          </TouchableOpacity>
        </View>
          </View>
        </View>
      </View>

      {/* Report Modal */}
      <ReportModal
        visible={showReportModal}
        onClose={() => setShowReportModal(false)}
        contentType="bounty"
        contentId={String(bounty.id)}
        contentTitle={bounty.title}
      />
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  // Outer shadow wrapper (no overflow so shadow isn't clipped)
  cardShadow: {
    borderRadius: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 12,
    backgroundColor: 'transparent',
  },
  // Inner rounded card
  card: {
    flex: 1,
    backgroundColor: '#059669', // emerald-600
    borderRadius: 24,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: '#047857', // emerald-700
    // Optional: ensure the darker header follows the rounded top
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconButton: {
    padding: 8,
    marginRight: 4,
  },
  headerTitle: {
    marginLeft: 8,
    fontSize: 18,
    fontWeight: 'bold',
    letterSpacing: 1.6,
    color: 'white',
  },
  closeButton: {
    padding: 8,
  },
  scrollContainer: {
    flex: 1,
    backgroundColor: '#059669', // emerald-600
  },
  scrollContent: {
    padding: 16,
  },
  bountyCard: {
    backgroundColor: '#047857cc', // emerald-700/80
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 16,
  },
  cardContent: {
    padding: 16,
  },
  userInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  userTextInfo: {
    flex: 1,
  },
  avatar: {
    width: 40,
    height: 40,
    borderWidth: 1,
    borderColor: '#6ee7b780', // emerald-400/30
  },
  avatarFallback: {
    backgroundColor: '#064e3b', // emerald-900
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: '#a7f3d0', // emerald-200
    fontSize: 12,
  },
  username: {
    fontSize: 14,
    color: '#d1fae5', // emerald-100
  },
  postTime: {
    fontSize: 12,
    color: '#a7f3d0', // emerald-300
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: 'white',
    marginBottom: 12,
  },
  priceDistanceContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  priceContainer: {
    backgroundColor: '#064e3b80', // emerald-900/50
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  priceText: {
    color: '#6ee7b7', // emerald-400
    fontWeight: 'bold',
  },
  distanceText: {
    fontSize: 14,
    color: '#a7f3d0', // emerald-200
  },
  onlineBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#d1fae5', // emerald-100
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  onlineText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#065f46', // emerald-800
  },
  descriptionContainer: {
    marginBottom: 16,
  },
  additionalDetailsContainer: {
    marginBottom: 16,
    backgroundColor: '#05543280', // emerald-800/50
    padding: 12,
    borderRadius: 8,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 8,
    gap: 10,
  },
  detailContent: {
    flex: 1,
  },
  detailLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#a7f3d0', // emerald-300
    marginBottom: 2,
  },
  detailValue: {
    fontSize: 14,
    color: '#d1fae5', // emerald-100
    lineHeight: 18,
  },
  attachmentsSection: {
    marginBottom: 16,
  },
  sectionHeader: {
    fontSize: 14,
    fontWeight: '500',
    color: '#a7f3d0', // emerald-200
    marginBottom: 8,
  },
  descriptionText: {
    color: 'white',
    fontSize: 14,
    lineHeight: 20,
  },
  attachmentsContainer: {
    gap: 8,
  },
  attachmentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#05543280', // emerald-800/50
    padding: 12,
    borderRadius: 8,
  },
  attachmentIcon: {
    width: 40,
    height: 40,
    borderRadius: 6,
    backgroundColor: '#064e3b', // emerald-900
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  attachmentInfo: {
    flex: 1,
  },
  attachmentName: {
    fontSize: 14,
    color: 'white',
  },
  attachmentSize: {
    fontSize: 12,
    color: '#a7f3d0', // emerald-300
  },
  downloadButton: {
    padding: 8,
  },
  contactContainer: {
    marginBottom: 16,
  },
  messageButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#a7f3d0', // emerald-200
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 12,
    gap: 8,
  },
  messageButtonText: {
    color: '#065f46', // emerald-800
    fontSize: 16,
    fontWeight: '600',
  },
  actionContainer: {
    padding: 16,
    paddingTop: 16,
    backgroundColor: '#047857', // emerald-700
    borderTopWidth: 1,
    borderTopColor: '#05966920', // emerald-600/20
  },
  acceptButton: {
    width: '100%',
    paddingVertical: 16,
    backgroundColor: '#10b981', // emerald-500
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  acceptButtonDisabled: {
    backgroundColor: '#059669', // emerald-600 (darker)
    opacity: 0.6,
  },
  acceptButtonText: {
    color: 'white',
    fontWeight: '500',
    fontSize: 16,
  },
});
