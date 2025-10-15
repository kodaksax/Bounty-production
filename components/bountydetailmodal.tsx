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
import type { AttachmentMeta } from '../lib/services/database.types'
import { bountyRequestService } from "../lib/services/bounty-request-service"
import { messageService } from "../lib/services/message-service"
import { reportService } from '../lib/services/report-service'
import type { Message } from '../lib/types'
import { getCurrentUserId } from "../lib/utils/data-utils"

interface BountyDetailModalProps {
  bounty: {
    id: number
    username?: string
    title: string
    price: number
    distance: number | null
    description?: string
    user_id?: string
    work_type?: 'online' | 'in_person'
    attachments?: AttachmentMeta[]
    attachments_json?: string
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
  const messagesEndRef = useRef<ScrollView>(null)
  const modalRef = useRef<View>(null)
  const currentUserId = getCurrentUserId()

  // Resolve poster identity - ONLY from bounty.user_id, never from current user
  const [displayUsername, setDisplayUsername] = useState<string>(bounty.username || 'Unknown Poster')
  const { profile: normalizedPoster } = useNormalizedProfile(bounty.user_id)
  const [actualAttachments, setActualAttachments] = useState<AttachmentMeta[]>([])

  useEffect(() => {
    // Resolution priority: bounty.username -> normalizedPoster.username -> 'Unknown Poster'
    // Never fall back to the current user's profile
    if (bounty.username) {
      setDisplayUsername(bounty.username)
      return
    }

    if (normalizedPoster?.username) {
      setDisplayUsername(normalizedPoster.username)
      return
    }

    setDisplayUsername('Unknown Poster')
  }, [bounty.username, normalizedPoster?.username])

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
    Alert.alert(
      'Report Bounty',
      'Are you sure you want to report this bounty? Our moderation team will review it.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Report',
          style: 'destructive',
          onPress: async () => {
            const result = await reportService.reportBounty(bounty.id);
            if (result.success) {
              Alert.alert('Report Submitted', 'Thank you for helping keep our community safe. We will review this bounty.');
            } else {
              Alert.alert('Error', result.error || 'Failed to submit report. Please try again.');
            }
          },
        },
      ]
    );
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
  router.push('/tabs/messenger' as any)
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
    if (bounty.user_id === currentUserId) {
      Alert.alert('Cannot Apply', 'You cannot apply to your own bounty.')
      return
    }

    setIsApplying(true)
    try {
      const request = await bountyRequestService.create({
        bounty_id: bounty.id,
        user_id: currentUserId,
        status: 'pending',
      })

      if (request) {
        setHasApplied(true)
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
                  if (bounty.user_id) {
                    router.push(`/profile/${bounty.user_id}`)
                  }
                }}
                disabled={!bounty.user_id}
              >
                <Avatar style={styles.avatar}>
                  <AvatarImage src={normalizedPoster?.avatar || "/placeholder.svg?height=40&width=40"} alt={displayUsername} />
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
                {bounty.user_id && (
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

              {/* Attachments */}
              {actualAttachments.length > 0 && (
                <View>
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
          {bounty.user_id && bounty.user_id !== currentUserId && (
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
  sectionHeader: {
    fontSize: 14,
    fontWeight: '500',
    color: '#a7f3d0', // emerald-200
    marginBottom: 4,
  },
  descriptionText: {
    color: 'white',
    fontSize: 14,
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
    padding: 12,
    paddingTop: 0,
    backgroundColor: '#047857', // emerald-700
  },
  acceptButton: {
    width: '100%',
    paddingVertical: 12,
    backgroundColor: '#10b981', // emerald-500
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
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
