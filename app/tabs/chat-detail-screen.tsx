"use client"

import { MaterialIcons } from "@expo/vector-icons"
import { Avatar, AvatarFallback, AvatarImage } from "components/ui/avatar"
import { useRouter } from "expo-router"
import { useCallback, useMemo, useRef, useState } from "react"
import { Image } from "expo-image"
import { ActivityIndicator, Alert, FlatList, Keyboard, KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native"
import { useAppThemeContext } from '../../lib/themes/AppThemeContext'
import type { AppTheme } from '../../lib/themes/types'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { AttachmentViewerModal } from "../../components/attachment-viewer-modal"
import { EmojiPicker } from "../../components/EmojiPicker"
import { MessageActions } from "../../components/MessageActions"
import { MessageBubble } from "../../components/MessageBubble"
import { PinnedMessageHeader } from "../../components/PinnedMessageHeader"
import { ReportModal } from "../../components/ReportModal"
import { TypingIndicator } from "../../components/TypingIndicator"
import { useAttachmentUpload } from '../../hooks/use-attachment-upload'
import { useMessages } from "../../hooks/useMessages"
import { useNormalizedProfile } from "../../hooks/useNormalizedProfile"
import { useTypingIndicator } from "../../hooks/useSocketStub"
import { useValidUserId } from '../../hooks/useValidUserId'
import { getBottomNavKeyboardOffset } from "../../lib/constants/navigation"
import { blockingService } from "../../lib/services/blocking-service"
import { generateInitials } from "../../lib/services/supabase-messaging"
import type { Attachment, Conversation, Message } from "../../lib/types"
import { getValidAvatarUrl } from "../../lib/utils/avatar-utils"
import { getMediaKind, getMediaMimeType, mediaFileName } from "../../lib/utils/message-media"
 
interface ChatDetailScreenProps {
  conversation: Conversation
  onBack?: () => void
  onNavigate?: (screen?: string) => void
}

export function ChatDetailScreen({
  conversation,
  onBack,
  onNavigate,
}: ChatDetailScreenProps) {
  const router = useRouter()
  const { theme } = useAppThemeContext()
  const s = useMemo(() => makeStyles(theme), [theme])
  const currentUserId = useValidUserId()
  const { 
    messages, 
    loading, 
    error, 
    pinnedMessage,
    sendMessage, 
    retryMessage,
    pinMessage,
    unpinMessage,
    copyMessage,
  } = useMessages(conversation.id)
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null)
  const [showActions, setShowActions] = useState(false)
  const [showReportModal, setShowReportModal] = useState(false)
  const [inputText, setInputText] = useState('')
  // Attachment staged in the composer: already uploaded, not yet sent, so the
  // user can add a caption (or back out) before it goes to the thread.
  const [pendingAttachment, setPendingAttachment] = useState<Attachment | null>(null)
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [viewerAttachment, setViewerAttachment] = useState<Attachment | null>(null)
  const listRef = useRef<FlatList<Message>>(null)
  const hasScrolledToBottom = useRef(false)
  const typingUsersRef = useTypingIndicator(conversation.id)
  const insets = useSafeAreaInsets()
  const bottomNavOffset = getBottomNavKeyboardOffset(insets.bottom)

  // Get the other participant's ID (not the current user) for 1:1 chats.
  // Wait for currentUserId to resolve before picking a participant — while
  // auth is still loading, currentUserId is null and `!== null` matches every
  // id, which could resolve to the current user's own id and briefly show
  // their profile instead of the recipient's.
  const otherUserId = !conversation.isGroup && conversation.participantIds && currentUserId
    ? conversation.participantIds.find(id => id !== currentUserId)
    : null

  // Fetch the other user's profile for 1:1 chats
  const { profile: otherUserProfile } = useNormalizedProfile(otherUserId || undefined)

  // Use profile data if available for 1:1 chats
  const displayName = !conversation.isGroup && otherUserProfile?.username
    ? otherUserProfile.username
    : conversation.name
  const avatarUrl = !conversation.isGroup && otherUserProfile?.avatar
    ? otherUserProfile.avatar
    : conversation.avatar
  const validAvatarUrl = getValidAvatarUrl(avatarUrl)

  // Generate initials for fallback
  const initials = generateInitials(
    otherUserProfile?.username,
    otherUserProfile?.name
  )

  const handleSendMessage = async (text: string, mediaUrl?: string | null) => {
    await sendMessage(text, mediaUrl)
    setTimeout(() => {
      listRef.current?.scrollToEnd({ animated: true })
    }, 100)
  }

  const { pickAttachment, isPicking, isUploading } = useAttachmentUpload({
    bucket: 'bounty-attachments',
    folder: 'messages',
    allowsMultiple: false,
    // A device-local cache key can't be opened by the recipient, so never send
    // one as an attachment.
    requireRemote: true,
  })

  const handlePickAttachment = async () => {
    setShowEmojiPicker(false)
    const uploaded = await pickAttachment()
    if (!uploaded || uploaded.length === 0) return
    // Stage it in the composer rather than firing it off immediately, so a
    // caption can be attached and the wrong photo can be removed.
    setPendingAttachment(uploaded[0])
  }

  const handleSend = async () => {
    const textToSend = inputText.trim()
    const attachment = pendingAttachment
    // Only ever send the remote URL — `requireRemote` guarantees one exists on
    // a staged attachment, and a local file:// path would be a dead link for
    // the recipient.
    const mediaUrl = attachment?.remoteUri ?? null
    if (!textToSend && !mediaUrl) return

    setInputText('')
    setPendingAttachment(null)
    setShowEmojiPicker(false)
    try {
      await handleSendMessage(textToSend, mediaUrl)
    } catch {
      // Restore the composer so nothing the user typed or picked is lost.
      setInputText(inputText)
      setPendingAttachment(attachment)
    }
  }

  const handleInsertEmoji = useCallback((emoji: string) => {
    setInputText(prev => prev + emoji)
  }, [])

  const handleToggleEmojiPicker = useCallback(() => {
    setShowEmojiPicker(prev => {
      // Close the system keyboard first; otherwise it and the picker stack and
      // push the composer off-screen.
      if (!prev) Keyboard.dismiss()
      return !prev
    })
  }, [])

  const handleMediaPress = useCallback((mediaUrl: string) => {
    setViewerAttachment({
      id: mediaUrl,
      name: mediaFileName(mediaUrl),
      uri: mediaUrl,
      remoteUri: mediaUrl,
      mimeType: getMediaMimeType(mediaUrl),
    })
  }, [])

  // Stable identity: this is a dependency of the memoized `renderMessage`
  // below, which in turn is passed as `onRetry` to every memoized
  // MessageBubble row. An unstable handleRetry busts that memo on every
  // render (e.g. every keystroke while composing), forcing every visible
  // message bubble to re-render.
  const handleRetry = useCallback(async (messageId: string) => {
    await retryMessage(messageId)
  }, [retryMessage])

  const handleLongPress = useCallback((messageId: string) => {
    setSelectedMessageId(messageId)
    setShowActions(true)
  }, [])

  const handlePin = async () => {
    if (!selectedMessageId) return
    const message = messages.find(m => m.id === selectedMessageId)
    if (message?.isPinned) {
      await unpinMessage(selectedMessageId)
    } else {
      await pinMessage(selectedMessageId)
    }
  }

  const handleCopy = async () => {
    if (!selectedMessageId) return
    await copyMessage(selectedMessageId)
    Alert.alert('Copied', 'Message copied to clipboard')
  }

  const handleReport = async () => {
    if (!selectedMessageId) return
    setShowActions(false)
    setShowReportModal(true)
  }

  const handleBlockUser = () => {
    setShowActions(false)
    if (!otherUserId || conversation.isGroup) return
    Alert.alert(
      'Block User',
      `Block ${displayName}? They won't be able to message you again.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Block',
          style: 'destructive',
          onPress: async () => {
            const result = await blockingService.blockUser(otherUserId)
            if (result.success) {
              Alert.alert('User Blocked', `${displayName} has been blocked.`)
              onBack?.()
            } else {
              Alert.alert('Error', result.error || 'Failed to block user')
            }
          },
        },
      ]
    )
  }

  const handlePinnedMessagePress = () => {
    if (!pinnedMessage) return
    const index = messages.findIndex(m => m.id === pinnedMessage.id)
    if (index !== -1) {
      listRef.current?.scrollToIndex({ index, animated: true })
    }
  }

  const renderMessage = useCallback(({ item: message }: { item: Message }) => {
    return (
      <MessageBubble
        id={message.id}
        text={message.text}
        mediaUrl={message.mediaUrl}
        isUser={currentUserId !== null && message.senderId === currentUserId}
        status={message.status}
        isPinned={message.isPinned}
        onLongPress={handleLongPress}
        onRetry={handleRetry}
        onMediaPress={handleMediaPress}
      />
    )
  }, [handleLongPress, handleRetry, handleMediaPress, currentUserId])

  // Stable identity so ListFooterComponent isn't remounted by FlatList on
  // every render (e.g. every keystroke in the composer).
  const renderFooter = useCallback(() => {
    const isTyping = typingUsersRef.current && typingUsersRef.current.size > 0
    if (!isTyping) return null
    return <TypingIndicator userName={conversation.name} />
  }, [typingUsersRef, conversation.name])

  const selectedMessage = messages.find(m => m.id === selectedMessageId)
  // A staged attachment is enough on its own — an image with no caption is a
  // perfectly valid message.
  const canSend = inputText.trim().length > 0 || !!pendingAttachment?.remoteUri

  return (
    <View style={[s.container, { paddingBottom: Math.max(insets.bottom || 0, bottomNavOffset + 8) }]}>
      {/* Header */}
      <View style={s.header}>
        <View style={s.headerInner}>
          <TouchableOpacity
            onPress={onBack}
            style={s.backButton}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel="Back to conversations"
          >
            <MaterialIcons name="arrow-back" size={24} color={theme.text} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => {
              if (otherUserId && !conversation.isGroup) {
                router.push(`/profile/${otherUserId}`)
              }
            }}
            disabled={!otherUserId || conversation.isGroup}
            style={s.headerProfile}
            accessibilityRole={!otherUserId || conversation.isGroup ? undefined : "button"}
            accessibilityLabel={!otherUserId || conversation.isGroup ? undefined : `View ${displayName}'s profile`}
          >
            <Avatar style={s.headerAvatar}>
              <AvatarImage src={validAvatarUrl} alt={displayName} />
              <AvatarFallback style={s.avatarFallback}>
                <Text style={s.avatarFallbackText}>{initials}</Text>
              </AvatarFallback>
            </Avatar>
            <View>
              <Text style={s.headerName} numberOfLines={1}>{displayName}</Text>
              {conversation.isGroup && (
                <Text style={s.headerSubtext}>
                  {conversation.participantIds?.length || 0} members
                </Text>
              )}
            </View>
          </TouchableOpacity>
        </View>
      </View>

      {/* Pinned Message Header */}
      {pinnedMessage && (
        <PinnedMessageHeader
          text={pinnedMessage.text}
          onPress={handlePinnedMessagePress}
          onDismiss={() => unpinMessage(pinnedMessage.id)}
        />
      )}

      {/* Error banner */}
      {error && (
        <View style={s.errorBanner}>
          <Text style={s.errorText}>{error}</Text>
        </View>
      )}

      {/* Messages and Input */}
      <KeyboardAvoidingView
        style={s.keyboardAvoidingContainer}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={bottomNavOffset}
      >
        {loading ? (
          <View style={s.loadingContainer}>
            <ActivityIndicator size="large" color={theme.primary} />
          </View>
        ) : (
          <View style={{ flex: 1 }}>
            <FlatList
              ref={listRef}
              data={messages}
              renderItem={renderMessage}
              keyExtractor={(item) => item.id}
              contentContainerStyle={s.messageList}
              inverted={false}
              ListFooterComponent={renderFooter}
              maxToRenderPerBatch={20}
              initialNumToRender={15}
              windowSize={10}
              removeClippedSubviews={true}
              /* No getItemLayout: rows are variable height (multi-line text and
                 image attachments), so a fixed estimate mis-positions
                 scrollToIndex. onScrollToIndexFailed handles the retry. */
              onLayout={() => {
                if (!hasScrolledToBottom.current) {
                  listRef.current?.scrollToEnd({ animated: false })
                  hasScrolledToBottom.current = true
                }
              }}
              onContentSizeChange={() => {
                if (!hasScrolledToBottom.current) {
                  listRef.current?.scrollToEnd({ animated: false })
                  hasScrolledToBottom.current = true
                }
              }}
              onScrollToIndexFailed={(info) => {
                const wait = new Promise(resolve => setTimeout(resolve, 500))
                wait.then(() => {
                  listRef.current?.scrollToIndex({ index: info.index, animated: true })
                })
              }}
            />
            {/* Message Input */}
            <View style={[s.inputContainer, { paddingBottom: showEmojiPicker ? 12 : Math.max(insets.bottom || 0, 12) }]}>
              {/* Staged attachment preview */}
              {pendingAttachment && (
                <View style={s.pendingRow}>
                  <View style={s.pendingPreview}>
                    {isPreviewableImage(pendingAttachment) ? (
                      <Image
                        source={{ uri: pendingAttachment.uri || pendingAttachment.remoteUri }}
                        style={s.pendingImage}
                        contentFit="cover"
                        accessibilityIgnoresInvertColors
                      />
                    ) : (
                      <View style={s.pendingFileIcon}>
                        <MaterialIcons name="insert-drive-file" size={22} color={theme.textSecondary} />
                      </View>
                    )}
                  </View>
                  <Text style={s.pendingName} numberOfLines={1}>
                    {pendingAttachment.name}
                  </Text>
                  <TouchableOpacity
                    onPress={() => setPendingAttachment(null)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityRole="button"
                    accessibilityLabel="Remove attachment"
                  >
                    <MaterialIcons name="close" size={20} color={theme.textSecondary} />
                  </TouchableOpacity>
                </View>
              )}
              <View style={s.inputRow}>
                <TouchableOpacity
                  style={s.attachButton}
                  onPress={handlePickAttachment}
                  disabled={isPicking || isUploading}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityRole="button"
                  accessibilityLabel="Add attachment"
                >
                  {isPicking || isUploading ? (
                    <ActivityIndicator size="small" color={theme.primary} />
                  ) : (
                    <MaterialIcons name="attach-file" size={20} color={theme.textDisabled} />
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  style={s.emojiButton}
                  onPress={handleToggleEmojiPicker}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityRole="button"
                  accessibilityLabel={showEmojiPicker ? 'Hide emoji picker' : 'Add emoji'}
                  accessibilityState={{ expanded: showEmojiPicker }}
                >
                  <MaterialIcons
                    name={showEmojiPicker ? 'keyboard' : 'emoji-emotions'}
                    size={20}
                    color={showEmojiPicker ? theme.primary : theme.textDisabled}
                  />
                </TouchableOpacity>
                <TextInput
                  style={s.inlineTextInput}
                  value={inputText}
                  onChangeText={setInputText}
                  onFocus={() => setShowEmojiPicker(false)}
                  placeholder={pendingAttachment ? 'Add a caption...' : 'Type a message...'}
                  placeholderTextColor={theme.textSecondary}
                  multiline
                  textAlignVertical="center"
                  accessibilityLabel="Message input field"
                  accessibilityHint="Enter your message to send"
                />
                <TouchableOpacity
                  style={[s.sendButton, !canSend && s.sendButtonDisabled]}
                  onPress={handleSend}
                  disabled={!canSend}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityRole="button"
                  accessibilityLabel="Send message"
                  accessibilityState={{ disabled: !canSend }}
                >
                  <MaterialIcons name="send" size={20} color={theme.primary} />
                </TouchableOpacity>
              </View>
            </View>
            {/* Rendered outside the composer so it spans the full width. */}
            <EmojiPicker
              visible={showEmojiPicker}
              onSelect={handleInsertEmoji}
              onClose={() => setShowEmojiPicker(false)}
              bottomInset={insets.bottom || 0}
            />
          </View>
        )}
      </KeyboardAvoidingView>

      {/* Message Actions Modal */}
      <MessageActions
        visible={showActions}
        onClose={() => setShowActions(false)}
        onPin={handlePin}
        onCopy={handleCopy}
        onReport={handleReport}
        onBlockUser={handleBlockUser}
        showBlockOption={!conversation.isGroup && !!otherUserId}
        isPinned={selectedMessage?.isPinned}
      />

      {/* Attachment viewer */}
      <AttachmentViewerModal
        visible={viewerAttachment !== null}
        attachment={viewerAttachment}
        onClose={() => setViewerAttachment(null)}
      />

      {/* Report Modal */}
      <ReportModal
        visible={showReportModal}
        onClose={() => {
          setShowReportModal(false)
          setSelectedMessageId(null)
        }}
        contentType="message"
        contentId={selectedMessageId || ''}
        contentTitle="Message"
      />
    </View>
  )
}

export default ChatDetailScreen

/** True when the staged attachment can be shown as a thumbnail in the composer. */
function isPreviewableImage(attachment: Attachment): boolean {
  const mime = attachment.mimeType || attachment.mime
  if (mime) return mime.startsWith('image/')
  return getMediaKind(attachment.remoteUri || attachment.uri) === 'image'
}

function makeStyles(t: AppTheme) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: t.background,
    },
    header: {
      backgroundColor: t.background,
      paddingTop: 48,
      paddingBottom: 12,
      paddingHorizontal: 16,
      borderBottomWidth: 1,
      borderBottomColor: t.border,
    },
    headerInner: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    backButton: {
      marginRight: 12,
    },
    headerProfile: {
      flexDirection: 'row',
      alignItems: 'center',
      flex: 1,
    },
    headerAvatar: {
      width: 40,
      height: 40,
      borderRadius: 20,
      marginRight: 12,
    },
    avatarFallback: {
      backgroundColor: t.surfaceSecondary,
      width: 40,
      height: 40,
      borderRadius: 20,
      justifyContent: 'center',
      alignItems: 'center',
    },
    avatarFallbackText: {
      color: t.primaryLight,
      fontWeight: '600',
      fontSize: 14,
    },
    headerName: {
      fontSize: 16,
      fontWeight: '600',
      color: t.text,
    },
    headerSubtext: {
      fontSize: 12,
      color: t.textDisabled,
      marginTop: 1,
    },
    // Semantic red — preserved across themes
    errorBanner: {
      marginHorizontal: 16,
      marginTop: 8,
      padding: 12,
      backgroundColor: '#FEE2E2',
      borderWidth: 1,
      borderColor: '#FCA5A5',
      borderRadius: 8,
    },
    errorText: {
      fontSize: 13,
      color: '#991B1B',
    },
    keyboardAvoidingContainer: {
      flex: 1,
    },
    loadingContainer: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    messageList: {
      paddingHorizontal: 12,
      paddingTop: 8,
      paddingBottom: 16,
    },
    inputContainer: {
      paddingHorizontal: 12,
      paddingTop: 10,
      backgroundColor: t.background,
      borderTopWidth: 1,
      borderTopColor: t.border,
    },
    inputRow: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      backgroundColor: t.surfaceSecondary,
      borderRadius: 22,
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderWidth: 1,
      borderColor: t.border,
      minHeight: 48,
    },
    attachButton: {
      marginRight: 8,
      marginBottom: 2,
      alignSelf: 'flex-end',
    },
    emojiButton: {
      marginRight: 8,
      marginBottom: 2,
      alignSelf: 'flex-end',
    },
    pendingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginBottom: 8,
      padding: 8,
      borderRadius: 12,
      backgroundColor: t.surfaceSecondary,
      borderWidth: 1,
      borderColor: t.border,
    },
    pendingPreview: {
      width: 44,
      height: 44,
      borderRadius: 8,
      overflow: 'hidden',
      backgroundColor: t.background,
    },
    pendingImage: {
      width: '100%',
      height: '100%',
    },
    pendingFileIcon: {
      width: '100%',
      height: '100%',
      alignItems: 'center',
      justifyContent: 'center',
    },
    pendingName: {
      flex: 1,
      fontSize: 13,
      color: t.text,
    },
    inlineTextInput: {
      flex: 1,
      color: t.text,
      fontSize: 15,
      lineHeight: 20,
      minHeight: 28,
      maxHeight: 120,
      paddingTop: 4,
      paddingBottom: 4,
    },
    sendButton: {
      marginLeft: 8,
      marginBottom: 2,
      padding: 6,
      alignSelf: 'flex-end',
    },
    sendButtonDisabled: {
      opacity: 0.4,
    },
  })
}