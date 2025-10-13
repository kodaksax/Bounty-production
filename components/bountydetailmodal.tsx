import MaterialIcons from "@expo/vector-icons/MaterialIcons"
import { Avatar, AvatarFallback, AvatarImage } from "components/ui/avatar"
import { useRouter } from "expo-router"
import React, { useEffect, useRef, useState } from "react"
import {
    ActivityIndicator,
    Alert,
    Dimensions,
    Modal,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View
} from "react-native"
import { bountyRequestService } from "../lib/services/bounty-request-service"
import { messageService } from "../lib/services/message-service"
import { getCurrentUserId } from "../lib/utils/data-utils"

interface BountyDetailModalProps {
  bounty: {
    id: number
    username: string
    title: string
    price: number
    distance: number
    description?: string
    user_id?: string // Add optional user_id
    attachments?: {
      id: string
      type: "image" | "document"
      name: string
      size: string
    }[]
  }
  onClose: () => void
  onNavigateToChat?: (conversationId: string) => void
}

export function BountyDetailModal({ bounty, onClose, onNavigateToChat }: BountyDetailModalProps) {
  const router = useRouter()
  const [isClosing, setIsClosing] = useState(false)
  const [isApplying, setIsApplying] = useState(false)
  const [hasApplied, setHasApplied] = useState(false)
  const [isCreatingChat, setIsCreatingChat] = useState(false)
  const messagesEndRef = useRef<ScrollView>(null)
  const modalRef = useRef<View>(null)
  const currentUserId = getCurrentUserId()

  // Sample description if not provided
  const description =
    bounty.description ||
    "I need someone to mow my lawn. The yard is approximately 1/4 acre with some slopes. I have a lawn mower you can use, or you can bring your own equipment. The grass is about 3 inches tall now. Please trim around the edges and clean up afterward. This should take about 2 hours to complete. I need this done by this weekend."

  // Sample attachments if not provided
  const attachments = bounty.attachments || [
    { id: "1", type: "image", name: "yard-front.jpg", size: "2.4 MB" },
    { id: "2", type: "document", name: "lawn-instructions.pdf", size: "1.1 MB" },
  ]

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
        bounty.username,
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
        router.push('/messenger')
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
            <TouchableOpacity style={styles.iconButton} accessibilityRole="button" accessibilityLabel="Share bounty">
              <MaterialIcons name="share" size={20} color="white" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.iconButton} accessibilityRole="button" accessibilityLabel="Report bounty">
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
                  <AvatarImage src="/placeholder.svg?height=40&width=40" alt={bounty.username} />
                  <AvatarFallback style={styles.avatarFallback}>
                    <Text style={styles.avatarText}>
                      {bounty.username.substring(1, 3).toUpperCase()}
                    </Text>
                  </AvatarFallback>
                </Avatar>
                <View style={styles.userTextInfo}>
                  <Text style={styles.username}>{bounty.username}</Text>
                  <Text style={styles.postTime}>Posted 2h ago</Text>
                </View>
                {bounty.user_id && (
                  <MaterialIcons name="chevron-right" size={20} color="#a7f3d0" style={{ marginLeft: 'auto' }} />
                )}
              </TouchableOpacity>

              {/* Title */}
              <Text style={styles.title}>{bounty.title}</Text>

              {/* Price and distance */}
              <View style={styles.priceDistanceContainer}>
                <View style={styles.priceContainer}>
                  <Text style={styles.priceText}>${bounty.price}</Text>
                </View>
                <Text style={styles.distanceText}>{bounty.distance} mi away</Text>
              </View>

              {/* Description */}
              <View style={styles.descriptionContainer}>
                <Text style={styles.sectionHeader}>Description</Text>
                <Text style={styles.descriptionText}>{description}</Text>
              </View>

              {/* Attachments */}
              {attachments.length > 0 && (
                <View>
                  <Text style={styles.sectionHeader}>Attachments</Text>
                  <View style={styles.attachmentsContainer}>
                    {attachments.map((attachment) => (
                      <View key={attachment.id} style={styles.attachmentItem}>
                        <View style={styles.attachmentIcon}>
                          {attachment.type === "image" ? (
                            <MaterialIcons name="image" size={20} color="#a7f3d0" />
                          ) : (
                            <MaterialIcons name="description" size={20} color="#a7f3d0" />
                          )}
                        </View>
                        <View style={styles.attachmentInfo}>
                          <Text style={styles.attachmentName}>{attachment.name}</Text>
                          <Text style={styles.attachmentSize}>{attachment.size}</Text>
                        </View>
                        <TouchableOpacity style={styles.downloadButton}>
                          <MaterialIcons name="arrow-forward" size={16} color="#a7f3d0" />
                        </TouchableOpacity>
                      </View>
                    ))}
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
                    <Text style={styles.messageButtonText}>Message {bounty.username}</Text>
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
