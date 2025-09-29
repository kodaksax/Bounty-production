"use client"

import { MaterialIcons } from "@expo/vector-icons"
import { Avatar, AvatarFallback, AvatarImage } from "components/ui/avatar"
import { cn } from "lib/utils"
import React, { useState } from "react"
import { ScrollView, Text, TouchableOpacity, View } from "react-native"
import { useWallet } from '../../lib/wallet-context'
import { ChatDetailScreen } from "./chat-detail-screen"


export interface Conversation {
  id: string
  name: string
  avatar?: string
  lastMessage: string
  time: string
  unread: number
  isTyping?: boolean
  isGroup?: boolean
  isRead?: boolean
  status?: string
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
  const [conversations, setConversations] = useState<Conversation[]>([
    {
      id: "1",
      name: "Olivia Grant",
      avatar: undefined,
      lastMessage: "Olivia is typing...",
      time: "12:30",
      unread: 3,
      isTyping: true,
      status: "Online now",
    },
    {
      id: "2",
      name: "Product design",
      lastMessage: "When is the meeting scheduled ?",
      time: "12:34",
      unread: 2,
      isGroup: true,
      status: "5 members",
    },
    {
      id: "3",
      name: "John Alfaro",
      avatar: undefined,
      lastMessage: "Nice work, I love it 👍",
      time: "12:30",
      unread: 0,
      isRead: true,
      status: "Last seen today",
    },
  ])

  const [activeConversation, setActiveConversation] = useState<string | null>(null)
  const { balance } = useWallet()
  // activeScreen is received from props (lifted state)
  const handleConversationClick = (id: string) => {
    setConversations((prev) => prev.map((conv) => (conv.id === id ? { ...conv, unread: 0, isRead: true } : conv)))
    setActiveConversation(id)
    onConversationModeChange?.(true)
  }

  const handleBackToInbox = () => {
    setActiveConversation(null)
    onConversationModeChange?.(false)
  }

// Removed unused StyleSheet (styles)

  if (activeConversation) {
    const conversation = conversations.find((c) => c.id === activeConversation)
    if (conversation) return <ChatDetailScreen conversation={conversation} onBack={handleBackToInbox} />
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
          <TouchableOpacity>
            <Text className="text-sm">Edit</Text>
          </TouchableOpacity>
          <TouchableOpacity>
            <Text className="text-sm">New Group</Text>
          </TouchableOpacity>
        </View>
      </View>
    
      <ScrollView className="flex-1 px-2 pb-24">
         {conversations.map((conversation) => (
           <ConversationItem key={conversation.id} conversation={conversation} onPress={() => handleConversationClick(conversation.id)} />
         ))}
       </ScrollView>

      {/* Bottom navigation is provided by the app container (BountyApp) */}
    </View>
  )
}
      
        
  

interface ConversationItemProps {
  conversation: Conversation
  onPress: () => void
}

function ConversationItem({ conversation, onPress }: ConversationItemProps) {
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
          <Text className="text-xs text-emerald-300">{conversation.time}</Text>
        </View>
        <View className="flex-row justify-between items-center mt-1">
          <Text className={cn("text-sm truncate max-w-[200px]", conversation.isTyping ? "text-emerald-300" : "text-emerald-200")}>{conversation.lastMessage}</Text>
          {conversation.unread > 0 ? (
            <View className="bg-blue-500 rounded-full h-5 w-5 flex items-center justify-center">
              <Text className="text-white text-xs">{conversation.unread}</Text>
            </View>
          ) : conversation.isRead ? (
            <MaterialIcons name="check" size={16} color="#10b981" />
          ) : null}
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

