"use client"

import { MaterialIcons } from "@expo/vector-icons"
import { Avatar, AvatarFallback, AvatarImage } from "components/ui/avatar"
import { useRouter } from "expo-router"
import { useCallback, useRef, useState } from "react"
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native"
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { MessageActions } from "../../components/MessageActions"
import { MessageBubble } from "../../components/MessageBubble"
import { PinnedMessageHeader } from "../../components/PinnedMessageHeader"
import { ReportModal } from "../../components/ReportModal"
import { TypingIndicator } from "../../components/TypingIndicator"
import { useMessages } from "../../hooks/useMessages"
import { useNormalizedProfile } from "../../hooks/useNormalizedProfile"
import { useTypingIndicator } from "../../hooks/useSocketStub"
import { useValidUserId } from '../../hooks/useValidUserId'
import { generateInitials } from "../../lib/services/supabase-messaging"
import type { Conversation, Message } from "../../lib/types"

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
  const typingUsersRef = useTypingIndicator(conversation.id)
  const insets = useSafeAreaInsets()
  const BOTTOM_NAV_OFFSET = 60 // height of BottomNav
  
  // Get the other participant's ID (not the current user) for 1:1 chats
  const otherUserId = !conversation.isGroup && conversation.participantIds
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
  
  // Generate initials for fallback
  const initials = generateInitials(
    otherUserProfile?.username,
    otherUserProfile?.name
  );

  const handleSendMessage = async (text: string) => {
    await sendMessage(text)
    // Scroll to bottom after sending
    setTimeout(() => {
      listRef.current?.scrollToEnd({ animated: true })
    }, 100)
  }

  const handleRetry = async (messageId: string) => {
    await retryMessage(messageId)
  }

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

  const renderFooter = () => {
    const isTyping = typingUsersRef.current && typingUsersRef.current.size > 0
    if (!isTyping) return null

    return <TypingIndicator userName={conversation.name} />
  }

  const getItemLayout = (_: any, index: number) => ({
    length: 80, // Approximate message height
    offset: 80 * index,
    index,
  })

  const selectedMessage = messages.find(m => m.id === selectedMessageId)
  const trimmedInputText = inputText.trim()

  return (
    <View className="flex flex-col min-h-screen bg-emerald-600 text-white">
      {/* Header */}
      <View
        className="p-4 pt-8 pb-2 flex-row items-center justify-between border-b"
        style={{ borderBottomColor: '#047857' }}
      >
        <View className="flex-row items-center flex-1">
          <TouchableOpacity onPress={onBack} className="mr-3">
            <MaterialIcons name="arrow-back" size={24} color="#fffef5" />
          </TouchableOpacity>
          <TouchableOpacity 
            onPress={() => {
              if (otherUserId && !conversation.isGroup) {
                router.push(`/profile/${otherUserId}`)
              }
            }}
            disabled={!otherUserId || conversation.isGroup}
            className="flex-row items-center flex-1"
          >
            <Avatar className="h-10 w-10 mr-3">
              <AvatarImage src={avatarUrl || "/placeholder.svg?height=40&width=40"} alt={displayName} />
              <AvatarFallback className="bg-emerald-700 text-emerald-200">
                {initials}
              </AvatarFallback>
            </Avatar>
            <View>
              <Text className="font-medium">{displayName}</Text>
              {conversation.isGroup && (
                <Text className="text-xs text-emerald-300">
                  {conversation.participantIds?.length || 0} members
                </Text>
              )}
            </View>
          </TouchableOpacity>
        </View>
        <View className="flex-row gap-3">
          <TouchableOpacity className="text-white">
            <MaterialIcons name="phone" size={24} color="#fffef5" />
          </TouchableOpacity>
          <TouchableOpacity className="text-white">
            <MaterialIcons name="videocam" size={24} color="#fffef5" />
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
        <View className="mx-4 mt-2 p-3 bg-red-500/20 border border-red-500 rounded">
          <Text className="text-sm text-red-100">{error}</Text>
        </View>
      )}

      {/* Messages and Input */}
      <KeyboardAvoidingView
        style={styles.keyboardAvoidingContainer}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={BOTTOM_NAV_OFFSET}
      >
        {loading ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator size="large" color="#ffffff" />
          </View>
        ) : (
          <View style={{ flex: 1 }}>
            <FlatList
              ref={listRef}
              data={messages}
              renderItem={renderMessage}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.messageList}
              inverted={false}
              ListFooterComponent={renderFooter}
              maxToRenderPerBatch={20}
              initialNumToRender={15}
              windowSize={10}
              removeClippedSubviews={true}
              getItemLayout={getItemLayout}
              onScrollToIndexFailed={(info) => {
                const wait = new Promise(resolve => setTimeout(resolve, 500))
                wait.then(() => {
                  listRef.current?.scrollToIndex({ index: info.index, animated: true })
                })
              }}
            />
            {/* Message Input */}
            <View style={[styles.inputContainer, { paddingBottom: Math.max(insets.bottom, 10) }]}>
              <View style={styles.inputRow}>
                <TextInput
                  style={styles.inlineTextInput}
                  value={inputText}
                  onChangeText={setInputText}
                  placeholder="Type a message..."
                  placeholderTextColor="rgba(209,250,229,0.5)"
                  multiline
                  accessibilityLabel="Message input field"
                  accessibilityHint="Enter your message to send"
                />
                <TouchableOpacity
                  style={[styles.sendButton, !trimmedInputText && styles.sendButtonDisabled]}
                  onPress={async () => {
                    if (trimmedInputText.length === 0) return
                    setInputText('')
                    await handleSendMessage(trimmedInputText)
                  }}
                  disabled={!trimmedInputText}
                >
                  <MaterialIcons name="send" size={20} color="#d1fae5" />
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

export default ChatDetailScreen;

const styles = StyleSheet.create({
  keyboardAvoidingContainer: {
    flex: 1,
  },
  messageList: {
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 16,
  },
  inputContainer: {
    padding: 12,
    backgroundColor: '#059669', // emerald-600
    borderTopWidth: 1,
    borderTopColor: '#047857', // emerald-700
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: 'rgba(6, 95, 70, 0.6)',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  inlineTextInput: {
    flex: 1,
    color: '#ffffff',
    fontSize: 15,
    maxHeight: 100,
    paddingTop: 4,
    paddingBottom: 4,
  },
  sendButton: {
    marginLeft: 8,
    padding: 4,
    alignSelf: 'flex-end',
  },
  sendButtonDisabled: {
    opacity: 0.4,
  },
})
