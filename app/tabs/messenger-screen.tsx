"use client"

import { MaterialIcons } from "@expo/vector-icons"
import { Avatar, AvatarFallback, AvatarImage } from "components/ui/avatar"
import { cn } from "lib/utils"
import React, { useState } from "react"
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from "react-native"
import { useConversations } from "../../hooks/useConversations"
import type { Conversation } from "../../lib/types"
import { useWallet } from '../../lib/wallet-context'
import { ChatDetailScreen } from "./chat-detail-screen"

// Helper to format conversation time
function formatConversationTime(updatedAt?: string): string {
  if (!updatedAt) return '';
  
  const date = new Date(updatedAt);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffHrs = Math.floor(diffMs / (1000 * 60 * 60));
  
  if (diffHrs < 1) {
    const diffMins = Math.floor(diffMs / (1000 * 60));
    if (diffMins < 1) return 'Just now';
    return `${diffMins}m ago`;
  }
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export function MessengerScreen({
  activeScreen,
  onNavigate,
  onConversationModeChange,
}: {
  activeScreen: string
  onNavigate: (screen: string) => void
  onConversationModeChange?: (inConversation: boolean) => void
}) {
  const { conversations, loading, error, markAsRead, refresh } = useConversations()
  const [activeConversation, setActiveConversation] = useState<string | null>(null)
  const { balance } = useWallet()

  const handleConversationClick = async (id: string) => {
    await markAsRead(id)
    setActiveConversation(id)
    onConversationModeChange?.(true)
  }

  const handleBackToInbox = () => {
    setActiveConversation(null)
    onConversationModeChange?.(false)
    refresh() // Refresh conversation list when returning
  }

  if (activeConversation) {
    const conversation = conversations.find((c) => c.id === activeConversation)
    if (conversation) {
      return <ChatDetailScreen conversation={conversation} onBack={handleBackToInbox} />
    }
  }

  return (
    <View className="flex flex-col min-h-screen bg-emerald-600 text-white">
      <View className="p-4 pt-8 pb-2">
        <View className="flex-row justify-between items-center">
          <View className="flex-row items-center">
            <MaterialIcons name="my-location" size={20} color="white" style={{ marginRight: 8 }} />
            <Text className="text-lg font-bold tracking-wider">BOUNTY</Text>
          </View>
          <Text className="text-lg font-bold">$ {balance.toFixed(2)}</Text>
        </View>
      </View>

      <View className="px-4 py-2 flex-row justify-between items-center">
        <Text className="text-xl font-bold">INBOX</Text>
        <View className="flex-row gap-4">
          <TouchableOpacity onPress={refresh}>
            <MaterialIcons name="refresh" size={20} color="white" />
          </TouchableOpacity>
          <TouchableOpacity>
            <Text className="text-sm">New Group</Text>
          </TouchableOpacity>
        </View>
      </View>

      {error && (
        <View className="mx-4 mb-2 p-3 bg-red-500/20 border border-red-500 rounded">
          <Text className="text-sm text-red-100">{error}</Text>
        </View>
      )}
    
      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#ffffff" />
        </View>
      ) : conversations.length === 0 ? (
        <View className="flex-1 items-center justify-center px-4">
          <MaterialIcons name="chat-bubble-outline" size={64} color="rgba(255,255,255,0.3)" />
          <Text className="text-lg mt-4 text-center text-emerald-200">No conversations yet</Text>
          <Text className="text-sm mt-2 text-center text-emerald-300">
            Start a conversation from a bounty posting
          </Text>
        </View>
      ) : (
        <ScrollView className="flex-1 px-2 pb-24">
          {conversations.map((conversation) => (
            <ConversationItem 
              key={conversation.id} 
              conversation={conversation} 
              onPress={() => handleConversationClick(conversation.id)} 
            />
          ))}
        </ScrollView>
      )}

      {/* Bottom navigation is provided by the app container (BountyApp) */}
    </View>
  )
}
      
        
  

interface ConversationItemProps {
  conversation: Conversation
  onPress: () => void
}

function ConversationItem({ conversation, onPress }: ConversationItemProps) {
  const time = formatConversationTime(conversation.updatedAt);
  
  return (
    <TouchableOpacity className="flex-row items-center p-3 rounded-lg" onPress={onPress}>
      <View className="relative">
        {conversation.isGroup ? (
          <GroupAvatar />
        ) : (
          <Avatar className="h-12 w-12">
            <AvatarImage src={conversation.avatar} alt={conversation.name} />
            <AvatarFallback className="bg-emerald-700 text-emerald-200">
              {conversation.name.substring(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
        )}
      </View>

      <View className="ml-3 flex-1 min-w-0">
        <View className="flex-row justify-between items-center">
          <Text className="font-medium">{conversation.name}</Text>
          <Text className="text-xs text-emerald-300">{time}</Text>
        </View>
        <View className="flex-row justify-between items-center mt-1">
          <Text className={cn("text-sm truncate max-w-[200px]", "text-emerald-200")}>
            {conversation.lastMessage || 'No messages yet'}
          </Text>
          {(conversation.unread ?? 0) > 0 && (
            <View className="bg-blue-500 rounded-full h-5 w-5 flex items-center justify-center">
              <Text className="text-white text-xs">{conversation.unread}</Text>
            </View>
          )}
        </View>
      </View>
    </TouchableOpacity>
  )
}

function GroupAvatar() {
  return (
    <View className="relative h-12 w-12">
      <View className="absolute top-0 left-0 h-8 w-8 rounded-full bg-emerald-700 border-2 border-emerald-600 flex items-center justify-center overflow-hidden">
        <Avatar className="h-full w-full">
          <AvatarImage src="/placeholder.svg?height=32&width=32" alt="Member 1" />
          <AvatarFallback className="bg-emerald-800 text-emerald-200 text-xs">M1</AvatarFallback>
        </Avatar>
      </View>
      <View className="absolute top-1 right-0 h-8 w-8 rounded-full bg-emerald-700 border-2 border-emerald-600 flex items-center justify-center overflow-hidden">
        <Avatar className="h-full w-full">
          <AvatarImage src="/placeholder.svg?height=32&width=32" alt="Member 2" />
          <AvatarFallback className="bg-emerald-800 text-emerald-200 text-xs">M2</AvatarFallback>
        </Avatar>
      </View>
      <View className="absolute bottom-0 left-1 h-8 w-8 rounded-full bg-emerald-700 border-2 border-emerald-600 flex items-center justify-center overflow-hidden">
        <Avatar className="h-full w-full">
          <AvatarImage src="/placeholder.svg?height=32&width=32" alt="Member 3" />
          <AvatarFallback className="bg-emerald-800 text-emerald-200 text-xs">M3</AvatarFallback>
        </Avatar>
      </View>
    </View>
  )
}

