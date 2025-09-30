"use client"

import { MaterialIcons } from "@expo/vector-icons"
import { Avatar, AvatarFallback, AvatarImage } from "components/ui/avatar"
import { StickyMessageInterface } from "components/sticky-message-interface"
import React from "react"
import { ActivityIndicator, FlatList, Text, TouchableOpacity, View } from "react-native"
import { useMessages } from "../../hooks/useMessages"
import type { Conversation, Message } from "../../lib/types"
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
  const { messages, loading, error, sendMessage, retryMessage } = useMessages(conversation.id)
  const { balance } = useWallet()

  const handleSendMessage = async (text: string) => {
    await sendMessage(text)
  }

  const handleRetry = async (messageId: string) => {
    await retryMessage(messageId)
  }

  const renderMessage = ({ item: message }: { item: Message }) => {
    const time = formatMessageTime(message.createdAt);
    const isFailed = message.status === 'failed';
    const isSending = message.status === 'sending';

    return (
      <View
        className={`flex-row mb-3 ${
          message.senderId === 'current-user' ? "justify-end" : "justify-start"
        }`}
      >
        <View
          className={`max-w-[75%] rounded-2xl px-4 py-2 ${
            message.senderId === 'current-user'
              ? "bg-emerald-500"
              : "bg-emerald-700"
          } ${isFailed ? 'opacity-50' : ''}`}
        >
          <Text className="text-white">{message.text}</Text>
          <View className="flex-row items-center justify-end mt-1 gap-1">
            <Text className="text-xs text-emerald-200">{time}</Text>
            {message.senderId === 'current-user' && (
              <>
                {isSending && (
                  <ActivityIndicator size="small" color="#d1fae5" />
                )}
                {isFailed && (
                  <TouchableOpacity onPress={() => handleRetry(message.id)}>
                    <MaterialIcons name="error" size={14} color="#ef4444" />
                  </TouchableOpacity>
                )}
                {message.status === 'sent' && (
                  <MaterialIcons name="check" size={14} color="#d1fae5" />
                )}
              </>
            )}
          </View>
        </View>
      </View>
    );
  };

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

      {/* Error banner */}
      {error && (
        <View className="mx-4 mt-2 p-3 bg-red-500/20 border border-red-500 rounded">
          <Text className="text-sm text-red-100">{error}</Text>
        </View>
      )}

      {/* Messages */}
      <View className="flex-1">
        {loading ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator size="large" color="#ffffff" />
          </View>
        ) : (
          <StickyMessageInterface
            messages={messages.map(m => ({ 
              id: m.id, 
              text: m.text, 
              isUser: m.senderId === 'current-user', 
              createdAt: new Date(m.createdAt).getTime() 
            }))}
            onSend={handleSendMessage}
            topInset={120}
            bottomInset={0}
            placeholder="Message"
          />
        )}
      </View>
    </View>
  )
}
