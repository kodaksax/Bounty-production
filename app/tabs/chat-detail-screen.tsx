"use client"

import { MaterialIcons } from "@expo/vector-icons"
import { Avatar, AvatarFallback, AvatarImage } from "components/ui/avatar"
import { useRouter } from "expo-router"
import { useCallback, useMemo, useRef, useState } from "react"
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native"
import { useAppThemeContext } from '../../lib/themes/AppThemeContext'
import type { AppTheme } from '../../lib/themes/types'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
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
import { generateInitials } from "../../lib/services/supabase-messaging"
import type { Conversation, Message } from "../../lib/types"
import { getValidAvatarUrl } from "../../lib/utils/avatar-utils"
 
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
  const listRef = useRef<FlatList<Message>>(null)
  const hasScrolledToBottom = useRef(false)
  const typingUsersRef = useTypingIndicator(conversation.id)
  const insets = useSafeAreaInsets()
  // Use a slightly larger offset to guarantee composer is above BottomNav
  const BOTTOM_NAV_OFFSET = Math.max(96, (insets.bottom || 0) + 12)

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
    allowsMultiple: false,
  })

  const handlePickAndSendAttachment = async () => {
    try {
      const uploaded = await pickAttachment()
      if (!uploaded || uploaded.length === 0) return
      const att = uploaded[0]
      const previousInput = inputText
      const textToSend = previousInput.trim()
      try {
        await handleSendMessage(textToSend, att.remoteUri || att.uri)
        setInputText('')
      } catch (err) {
        setInputText(previousInput)
        throw err
      }
    } catch (e) {
      // ignore; the hook shows alerts on failure
    }
  }

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
        isUser={currentUserId !== null && message.senderId === currentUserId}
        status={message.status}
        isPinned={message.isPinned}
        onLongPress={handleLongPress}
        onRetry={handleRetry}
      />
    )
  }, [handleLongPress, handleRetry, currentUserId])

  // Stable identity so ListFooterComponent isn't remounted by FlatList on
  // every render (e.g. every keystroke in the composer).
  const renderFooter = useCallback(() => {
    const isTyping = typingUsersRef.current && typingUsersRef.current.size > 0
    if (!isTyping) return null
    return <TypingIndicator userName={conversation.name} />
  }, [typingUsersRef, conversation.name])

  const getItemLayout = (_: any, index: number) => ({
    length: 80,
    offset: 80 * index,
    index,
  })

  const selectedMessage = messages.find(m => m.id === selectedMessageId)
  const trimmedInputText = inputText.trim()

  return (
    <View style={[s.container, { paddingBottom: Math.max(insets.bottom || 0, BOTTOM_NAV_OFFSET + 8) }]}>
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
        keyboardVerticalOffset={BOTTOM_NAV_OFFSET}
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
              getItemLayout={getItemLayout}
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
            <View style={[s.inputContainer, { paddingBottom: Math.max(insets.bottom || 0, 12) }]}>
              <View style={s.inputRow}>
                <TouchableOpacity
                  style={s.attachButton}
                  onPress={handlePickAndSendAttachment}
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
                <TextInput
                  style={s.inlineTextInput}
                  value={inputText}
                  onChangeText={setInputText}
                  placeholder="Type a message..."
                  placeholderTextColor={theme.textSecondary}
                  multiline
                  textAlignVertical="center"
                  accessibilityLabel="Message input field"
                  accessibilityHint="Enter your message to send"
                />
                <TouchableOpacity
                  style={[s.sendButton, !trimmedInputText && s.sendButtonDisabled]}
                  onPress={async () => {
                    if (trimmedInputText.length === 0) return
                    const previousInput = inputText
                    const textToSend = previousInput.trim()
                    try {
                      await handleSendMessage(textToSend)
                      setInputText('')
                    } catch (err) {
                      setInputText(previousInput)
                    }
                  }}
                  disabled={!trimmedInputText}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityRole="button"
                  accessibilityLabel="Send message"
                  accessibilityState={{ disabled: !trimmedInputText }}
                >
                  <MaterialIcons name="send" size={20} color={theme.primary} />
                </TouchableOpacity>
              </View>
            </View>
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
        isPinned={selectedMessage?.isPinned}
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