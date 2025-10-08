"use client"

import { MaterialIcons } from "@expo/vector-icons"
import { Avatar, AvatarFallback, AvatarImage } from "components/ui/avatar"
import React, { useState, useRef, useCallback } from "react"
import { ActivityIndicator, FlatList, Text, TouchableOpacity, View, StyleSheet, Alert } from "react-native"
import { useMessages } from "../../hooks/useMessages"
import type { Conversation, Message } from "../../lib/types"
import { useWallet } from '../../lib/wallet-context'
import { MessageBubble } from "../../components/MessageBubble"
import { MessageActions } from "../../components/MessageActions"
import { PinnedMessageHeader } from "../../components/PinnedMessageHeader"
import { TypingIndicator } from "../../components/TypingIndicator"
import { useTypingIndicator, socketStub } from "../../hooks/useSocketStub"

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
  const listRef = useRef<FlatList<Message>>(null)
  const typingUsersRef = useTypingIndicator(conversation.id)

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
    Alert.alert(
      'Report Message',
      'Are you sure you want to report this message?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Report',
          style: 'destructive',
          onPress: async () => {
            await reportMessage(selectedMessageId)
            Alert.alert('Reported', 'Message has been reported')
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
        isUser={message.senderId === 'current-user'}
        status={message.status}
        isPinned={message.isPinned}
        onLongPress={handleLongPress}
      />
    )
  }, [handleLongPress])

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
      <View className="p-4 pt-8 pb-2 flex-row items-center justify-between border-b border-emerald-500">
        <View className="flex-row items-center flex-1">
          <TouchableOpacity onPress={onBack} className="mr-3">
            <MaterialIcons name="arrow-back" size={24} color="#fffef5" />
          </TouchableOpacity>
          <Avatar className="h-10 w-10 mr-3">
            <AvatarImage src={conversation.avatar} alt={conversation.name} />
            <AvatarFallback className="bg-emerald-700 text-emerald-200">
              {conversation.name.substring(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <View>
            <Text className="font-medium">{conversation.name}</Text>
            {conversation.isGroup && (
              <Text className="text-xs text-emerald-300">
                {conversation.participantIds?.length || 0} members
              </Text>
            )}
          </View>
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
            <View style={styles.inputContainer}>
              <TouchableOpacity 
                style={styles.inputButton}
                onPress={() => {
                  Alert.prompt(
                    'Send Message',
                    'Type your message:',
                    [
                      { text: 'Cancel', style: 'cancel' },
                      { 
                        text: 'Send', 
                        onPress: (text) => {
                          if (text?.trim()) {
                            handleSendMessage(text.trim())
                          }
                        }
                      },
                    ],
                    'plain-text'
                  )
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
    </View>
  )
}

const styles = StyleSheet.create({
  messageList: {
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 80, // Space for input
  },
  inputContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 12,
    backgroundColor: '#047857', // emerald-700
    borderTopWidth: 1,
    borderTopColor: '#059669',
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
})
