"use client"

import { MaterialIcons } from "@expo/vector-icons"
import { Avatar, AvatarFallback, AvatarImage } from "components/ui/avatar"
import { useRouter } from "expo-router"
import React, { useCallback, useRef, useState } from "react"
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Modal, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native"
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { MessageActions } from "../../components/MessageActions"
import { MessageBubble } from "../../components/MessageBubble"
import { PinnedMessageHeader } from "../../components/PinnedMessageHeader"
import { ReportModal } from "../../components/ReportModal"
import { TypingIndicator } from "../../components/TypingIndicator"
import { useMessages } from "../../hooks/useMessages"
import { useNormalizedProfile } from "../../hooks/useNormalizedProfile"
import { useTypingIndicator } from "../../hooks/useSocketStub"
import { generateInitials } from "../../lib/services/supabase-messaging"
import type { Conversation, Message } from "../../lib/types"
import { getCurrentUserId } from "../../lib/utils/data-utils"
import { useWallet } from '../../lib/wallet-context'

interface ChatDetailScreenProps {
  conversation: Conversation
  onBack?: () => void
  onNavigate?: (screen?: string) => void
}

// Format message time
function formatMessageTime(createdAt: string): string {
  const date = new Date(createdAt);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function ChatDetailScreen({
  conversation,
  onBack,
  onNavigate,
}: ChatDetailScreenProps) {
  const router = useRouter()
  const currentUserId = getCurrentUserId()
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
    reportMessage,
  } = useMessages(conversation.id)
  const { balance } = useWallet()
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null)
  const [showActions, setShowActions] = useState(false)
  const [showReportModal, setShowReportModal] = useState(false)
  const [showComposer, setShowComposer] = useState(false)
  const [composerText, setComposerText] = useState('')
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
        isUser={message.senderId === currentUserId}
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
      <View className="flex-1">
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
            <View style={[styles.inputContainer, { paddingBottom: Math.max(insets.bottom, 10), bottom: BOTTOM_NAV_OFFSET }] }>
              <TouchableOpacity 
                style={styles.inputButton}
                onPress={() => {
                  setComposerText('')
                  setShowComposer(true)
                }}
              >
                <Text style={styles.inputPlaceholder}>Type a message...</Text>
                <MaterialIcons name="send" size={20} color="#d1fae5" />
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>

      {/* Message Actions Modal */}
      <MessageActions
        visible={showActions}
        onClose={() => setShowActions(false)}
        onPin={handlePin}
        onCopy={handleCopy}
        onReport={handleReport}
        isPinned={selectedMessage?.isPinned}
      />

      {/* Composer Modal raised above BottomNav and keyboard */}
      <Modal
        visible={showComposer}
        transparent
        animationType="fade"
        onRequestClose={() => setShowComposer(false)}
      >
        <View style={styles.modalOverlay}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setShowComposer(false)} />
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            keyboardVerticalOffset={BOTTOM_NAV_OFFSET}
            style={{ width: '100%' }}
          >
            <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 12), marginBottom: BOTTOM_NAV_OFFSET }] }>
              <Text style={styles.sheetTitle}>Send Message</Text>
              <View style={styles.inputWrapper}>
                <TextInput
                  value={composerText}
                  onChangeText={setComposerText}
                  placeholder="Type your message..."
                  placeholderTextColor="rgba(209,250,229,0.5)"
                  multiline
                  autoFocus
                  style={styles.textArea}
                />
              </View>
              <View style={styles.sheetButtons}>
                <TouchableOpacity style={[styles.sheetBtn, styles.cancelBtn]} onPress={() => setShowComposer(false)}>
                  <Text style={styles.cancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.sheetBtn, styles.sendBtn]}
                  onPress={async () => {
                    const t = composerText.trim()
                    if (t.length === 0) return
                    setShowComposer(false)
                    setComposerText('')
                    await handleSendMessage(t)
                  }}
                >
                  <MaterialIcons name="send" size={18} color="#052e1b" />
                  <Text style={styles.sendText}>Send</Text>
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

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

const styles = StyleSheet.create({
  messageList: {
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 80 + 60, // Space for input + BottomNav
  },
  inputContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 12,
    // Make the area outside the rounded message box match the main screen
    // (use emerald-600 to match `bg-emerald-600` on the root View)
    backgroundColor: '#059669', // emerald-600
    borderTopWidth: 1,
    // use a slightly darker border so the input area still reads as separate
    borderTopColor: '#047857', // emerald-700
  },
  inputButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(6, 95, 70, 0.6)',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  inputPlaceholder: {
    color: '#d1fae5',
    fontSize: 15,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#065f46',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 16,
    paddingTop: 14,
  },
  sheetTitle: {
    color: '#e5fff7',
    fontWeight: '600',
    fontSize: 16,
    marginBottom: 8,
  },
  inputWrapper: {
    backgroundColor: 'rgba(4,120,87,0.6)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(16,185,129,0.35)',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  textArea: {
    color: '#ffffff',
    minHeight: 80,
    fontSize: 15,
  },
  sheetButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  sheetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
  },
  cancelBtn: {
    backgroundColor: 'rgba(6,95,70,0.5)',
    marginRight: 8,
    borderWidth: 1,
    borderColor: 'rgba(16,185,129,0.25)'
  },
  cancelText: {
    color: '#d1fae5',
    fontWeight: '600',
  },
  sendBtn: {
    backgroundColor: '#a7f3d0',
    marginLeft: 8,
  },
  sendText: {
    color: '#052e1b',
    fontWeight: '700',
    marginLeft: 6,
  },
})
